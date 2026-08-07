'use strict';

const { readBoundedText } = require('./bounded-response');
const { AiError } = require('./errors');

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_QUERY_CHARS = 500;
const MAX_SNIPPET_CHARS = 1_200;

function decodeEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const hexadecimal = entity[1].toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match;
  });
}

function sanitizeWikiquoteText(value, maxChars = MAX_SNIPPET_CHARS) {
  return decodeEntities(String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()).slice(0, maxChars);
}

function wikiquoteApiUrl(language = 'en') {
  const normalized = String(language).trim().toLowerCase();
  if (!/^[a-z]{2,12}(?:-[a-z0-9]{1,12})*$/.test(normalized)) {
    throw new TypeError('WIKIQUOTE_LANGUAGE must be a safe language subdomain such as en or pt-br.');
  }
  return `https://${normalized}.wikiquote.org/w/api.php`;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

class WikiquoteSearchHarness {
  constructor({ language = 'en', timeoutMs = 8_000, maxResults = 4, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    this.apiUrl = wikiquoteApiUrl(language);
    this.language = new URL(this.apiUrl).hostname.split('.')[0];
    this.timeoutMs = clampInteger(timeoutMs, 8_000, 1_000, 15_000);
    this.maxResults = clampInteger(maxResults, 4, 1, 5);
    this.fetch = fetchImpl;
  }

  async search(query, { signal } = {}) {
    const trimmedQuery = String(query || '').trim().slice(0, MAX_QUERY_CHARS);
    if (!trimmedQuery) return [];

    const target = new URL(this.apiUrl);
    target.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      list: 'search',
      srnamespace: '0',
      srlimit: String(this.maxResults),
      srprop: 'snippet|sectiontitle',
      srsearch: trimmedQuery,
      utf8: '1',
    }).toString();

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetch(target, {
        headers: {
          accept: 'application/json',
          'user-agent': 'QuoteBook/1.0 (quote attribution research; MediaWiki API)',
        },
        signal: combinedSignal,
      });
    } catch (error) {
      throw new AiError('WIKIQUOTE_UNAVAILABLE', 'Wikiquote research is temporarily unavailable.', {
        status: timeout.aborted ? 504 : 502,
        cause: error,
      });
    }
    if (!response.ok) {
      throw new AiError('WIKIQUOTE_UNAVAILABLE', 'Wikiquote research is temporarily unavailable.', {
        status: 502,
        details: { providerStatus: response.status },
      });
    }

    let payload;
    try {
      payload = JSON.parse(await readBoundedText(response, MAX_RESPONSE_BYTES, 'WIKIQUOTE_RESPONSE_TOO_LARGE'));
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError('WIKIQUOTE_INVALID_RESPONSE', 'Wikiquote returned an unreadable response.', { status: 502, cause: error });
    }

    const results = Array.isArray(payload?.query?.search) ? payload.query.search : [];
    return results.slice(0, this.maxResults).map((item) => {
      const title = sanitizeWikiquoteText(item.title, 300);
      const section = sanitizeWikiquoteText(item.sectiontitle, 300);
      const snippet = sanitizeWikiquoteText(item.snippet);
      const pageUrl = new URL('/wiki/' + encodeURIComponent(title.replace(/ /g, '_')), `https://${this.language}.wikiquote.org`);
      return {
        provider: 'Wikiquote',
        title: section ? `${title} — ${section}` : title,
        url: pageUrl.toString(),
        snippet,
      };
    }).filter((item) => item.title && (item.snippet || item.url));
  }
}

module.exports = { WikiquoteSearchHarness, sanitizeWikiquoteText, wikiquoteApiUrl };
