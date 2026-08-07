'use strict';

const { AiError } = require('./errors');

function plainText(value, maximum) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function safeEvidenceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 2_048) : '';
  } catch (_) {
    return '';
  }
}

function sanitizeEvidence(item) {
  return {
    provider: plainText(item?.provider || 'Web', 50),
    title: plainText(item?.title, 300),
    url: safeEvidenceUrl(item?.url),
    snippet: plainText(item?.snippet, 1_200),
  };
}

class QuoteResearchHarness {
  constructor({ wikiquoteHarness, webSearchHarness, logger = console, maxEvidence = 8 } = {}) {
    this.wikiquoteHarness = wikiquoteHarness;
    this.webSearchHarness = webSearchHarness;
    this.logger = logger;
    this.maxEvidence = Math.min(Math.max(Number(maxEvidence) || 8, 1), 10);
  }

  async search(query, options = {}) {
    const providers = [
      ['Wikiquote', this.wikiquoteHarness],
      ['web search', this.webSearchHarness],
    ].filter(([, harness]) => harness);
    if (!providers.length) return [];

    const settled = await Promise.allSettled(providers.map(([, harness]) => harness.search(query, options)));
    const evidence = [];
    let failureCount = 0;
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        evidence.push(...result.value.map(sanitizeEvidence).filter((item) => item.title || item.snippet));
      } else {
        failureCount += 1;
        this.logger?.warn?.(`${providers[index][0]} lookup failed.`, { code: result.reason?.code });
      }
    });
    if (failureCount === providers.length) {
      throw new AiError('SEARCH_UNAVAILABLE', 'Online quote research is temporarily unavailable.', { status: 502 });
    }
    const unique = new Map();
    for (const item of evidence) {
      const key = item.url || `${item.provider}\u0000${item.title}\u0000${item.snippet}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].slice(0, this.maxEvidence);
  }
}

module.exports = { QuoteResearchHarness, sanitizeEvidence };
