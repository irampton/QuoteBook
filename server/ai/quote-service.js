'use strict';

const { ZodError } = require('zod');
const { AiError } = require('./errors');
const { parseJsonObject } = require('./json');
const { PARSE_SYSTEM, SPLIT_SYSTEM, buildParsePrompt, buildSplitPrompt } = require('./prompts');
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
  constructor({ completionClient, searchHarness, logger = console }) {
    if (!completionClient) throw new TypeError('QuoteAiService requires a completion client.');
    this.completionClient = completionClient;
    this.searchHarness = searchHarness;
    this.logger = logger;
  }

  async parseQuote(text, { searchOnline = true, signal } = {}) {
    let searchResults = [];
    let searchWarning = null;
    if (searchOnline && this.searchHarness) {
      try {
        searchResults = await this.searchHarness.search(text, { signal });
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
        user: buildParsePrompt(text, searchResults, searchWarning),
        signal,
      });
      const quote = normalizeQuote(parseJsonObject(raw));
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

  async processBatch(text, { searchOnline = true, signal, onProgress } = {}) {
    const inputs = await this.splitQuotes(text, { signal });
    const output = [];
    for (let index = 0; index < inputs.length; index += 1) {
      if (signal?.aborted) throw new AiError('REQUEST_ABORTED', 'Quote processing was cancelled.', { status: 499 });
      const quote = await this.parseQuote(inputs[index], { searchOnline, signal });
      output.push(quote);
      await onProgress?.({ index, total: inputs.length, input: inputs[index], quote });
    }
    return output;
  }
}

module.exports = { QuoteAiService };
