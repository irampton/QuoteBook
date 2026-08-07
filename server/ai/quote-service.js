'use strict';

const { ZodError } = require('zod');
const { AiError } = require('./errors');
const { parseJsonObject } = require('./json');
const { PARSE_SYSTEM, SPLIT_SYSTEM, buildParsePrompt, buildSplitPrompt } = require('./prompts');
const { mergeEvidence } = require('./research-harness');
const { normalizeQuote, splitSchema } = require('./schemas');

function invalidStructuredData(error) {
  if (error instanceof AiError) return error;
  if (error instanceof ZodError) {
    return new AiError('INVALID_AI_RESPONSE', 'The AI returned incomplete quote information.', {
      status: 502,
      details: { fields: error.issues.map((issue) => issue.path.join('.')).filter(Boolean) },
      cause: error,
    });
  }
  return error;
}

class QuoteAiService {
  constructor({ completionClient, queryRepairer, searchHarness, logger = console }) {
    if (!completionClient) throw new TypeError('QuoteAiService requires a completion client.');
    this.completionClient = completionClient;
    this.queryRepairer = queryRepairer;
    this.searchHarness = searchHarness;
    this.logger = logger;
  }

  async parseQuote(text, { searchOnline = true, availableCategories = [], signal } = {}) {
    let searchResults = [];
    let searchWarning = null;
    if (searchOnline && this.searchHarness) {
      const queries = [text];
      const settleSearch = (query) => this.searchHarness.search(query, { signal }).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      );
      // Start the original lookup immediately so query repair does not add to its latency.
      const originalSearch = settleSearch(text);
      if (this.queryRepairer) {
        try {
          const repair = await this.queryRepairer.repair(text, { signal });
          if (repair.correctedQuery) queries.push(repair.correctedQuery);
          else if (repair.distinctiveFragment) queries.push(repair.distinctiveFragment);
        } catch (error) {
          if (signal?.aborted) throw error;
          this.logger?.warn?.('Quote lookup query repair failed; using the original query.', { code: error.code });
        }
      }
      try {
        const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 2);
        const settled = await Promise.all([
          originalSearch,
          ...uniqueQueries.slice(1).map(settleSearch),
        ]);
        if (signal?.aborted) {
          const rejected = settled.find((result) => result.status === 'rejected');
          throw rejected?.reason || new AiError('REQUEST_ABORTED', 'Quote processing was cancelled.', { status: 499 });
        }
        const fulfilled = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
        if (!fulfilled.length) throw settled.find((result) => result.status === 'rejected').reason;
        searchResults = mergeEvidence(fulfilled, 8);
        if (!searchResults.length) searchWarning = 'No online search results were found.';
      } catch (error) {
        if (signal?.aborted) throw error;
        searchWarning = 'Online research was unavailable; unverified fields were left unknown.';
        this.logger?.warn?.('Quote search failed; continuing with local parsing.', { code: error.code });
      }
    }

    try {
      const raw = await this.completionClient.completeJson({
        system: PARSE_SYSTEM,
        user: buildParsePrompt(text, searchResults, searchWarning, availableCategories),
        signal,
      });
      const quote = normalizeQuote(parseJsonObject(raw), availableCategories);
      if (searchWarning && !quote.researchNotes) quote.researchNotes = searchWarning;
      return quote;
    } catch (error) {
      throw invalidStructuredData(error);
    }
  }

  async splitQuotes(text, { signal } = {}) {
    try {
      const raw = await this.completionClient.completeJson({
        system: SPLIT_SYSTEM,
        user: buildSplitPrompt(text),
        signal,
      });
      const parsed = splitSchema.parse(parseJsonObject(raw));
      return parsed.quotes.map((quote) => quote.trim()).filter(Boolean);
    } catch (error) {
      throw invalidStructuredData(error);
    }
  }

  async processBatch(text, { searchOnline = true, availableCategories = [], signal, onProgress } = {}) {
    const inputs = await this.splitQuotes(text, { signal });
    const output = [];
    for (let index = 0; index < inputs.length; index += 1) {
      if (signal?.aborted) throw new AiError('REQUEST_ABORTED', 'Quote processing was cancelled.', { status: 499 });
      const quote = await this.parseQuote(inputs[index], { searchOnline, availableCategories, signal });
      output.push(quote);
      await onProgress?.({ index, total: inputs.length, input: inputs[index], quote });
    }
    return output;
  }
}

module.exports = { QuoteAiService };
