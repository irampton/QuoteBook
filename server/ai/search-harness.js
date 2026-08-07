'use strict';

const { AiError } = require('./errors');
const { readBoundedText } = require('./bounded-response');

const MAX_RESPONSE_BYTES = 512 * 1024;

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const radix = entity[1].toLowerCase() === 'x' ? 16 : 10;
      const digits = entity.slice(radix === 16 ? 2 : 1);
      const codePoint = Number.parseInt(digits, radix);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function cleanHtml(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseDuckDuckGoResults(html, limit = 5) {
  const results = [];
  const blockPattern = /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*result|$)/gi;
  for (const blockMatch of html.matchAll(blockPattern)) {
    const block = blockMatch[1];
    const link = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const snippet = /<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(block);
    let url = decodeHtml(link[1]);
    try {
      const redirect = new URL(url, 'https://duckduckgo.com');
      url = redirect.searchParams.get('uddg') || redirect.href;
    } catch (_) {
      // Retain the result URL as supplied if it is not parseable.
    }
    results.push({ title: cleanHtml(link[2]), url, snippet: snippet ? cleanHtml(snippet[1]) : '' });
    if (results.length >= limit) break;
  }
  return results;
}

function normalizeJsonResults(payload, limit = 5) {
  const candidates = Array.isArray(payload)
    ? payload
    : payload.results || payload.items || payload.organic_results || payload.web?.results || [];
  return candidates.slice(0, limit).map((item) => ({
    title: String(item.title || item.name || '').trim(),
    url: String(item.url || item.link || item.href || '').trim(),
    snippet: String(item.snippet || item.description || item.body || '').trim(),
  })).filter((item) => item.title || item.url || item.snippet);
}

class InternetSearchHarness {
  constructor({ url, apiKey = '', timeoutMs = 10_000, fetchImpl = globalThis.fetch, maxResults = 5 }) {
    if (!url) throw new TypeError('InternetSearchHarness requires a URL.');
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.maxResults = maxResults;
  }

  async search(query, { signal } = {}) {
    const target = new URL(this.url);
    target.searchParams.set('q', `"${query.slice(0, 500)}" quote author source`);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetch(target, {
        headers: {
          accept: 'application/json, text/html',
          'user-agent': 'QuoteBook/1.0 (quote attribution research)',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}`, 'x-api-key': this.apiKey } : {}),
        },
        signal: combinedSignal,
      });
    } catch (error) {
      throw new AiError('SEARCH_UNAVAILABLE', 'Online quote research is temporarily unavailable.', {
        status: timeout.aborted ? 504 : 502,
        cause: error,
      });
    }
    if (!response.ok) {
      throw new AiError('SEARCH_UNAVAILABLE', 'Online quote research is temporarily unavailable.', {
        status: 502,
        details: { searchStatus: response.status },
      });
    }
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) {
      return normalizeJsonResults(JSON.parse(await readBoundedText(response, MAX_RESPONSE_BYTES, 'SEARCH_RESPONSE_TOO_LARGE')), this.maxResults);
    }
    return parseDuckDuckGoResults(await readBoundedText(response, MAX_RESPONSE_BYTES, 'SEARCH_RESPONSE_TOO_LARGE'), this.maxResults);
  }
}

module.exports = { InternetSearchHarness, normalizeJsonResults, parseDuckDuckGoResults };
