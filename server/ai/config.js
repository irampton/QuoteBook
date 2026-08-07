'use strict';

const DEFAULT_BASE_URL = 'https://dev.aqanta.com/';

function resolveCompletionUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(value);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1/chat/completions';
  return url.toString();
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function loadAiConfig(env = process.env) {
  return {
    apiKey: env.COMPLETION_API_KEY || env.AI_API_KEY || '',
    completionUrl: resolveCompletionUrl(env.COMPLETION_URL || DEFAULT_BASE_URL),
    model: env.COMPLETION_MODEL || 'gpt-4.1-mini',
    timeoutMs: boundedInteger(env.COMPLETION_TIMEOUT_MS, 30_000, 1_000, 120_000),
    jsonMode: env.COMPLETION_JSON_MODE !== 'false',
    searchUrl: env.SEARCH_API_URL || env.QUOTE_SEARCH_URL || 'https://html.duckduckgo.com/html/',
    searchApiKey: env.SEARCH_API_KEY || '',
    searchTimeoutMs: boundedInteger(env.QUOTE_SEARCH_TIMEOUT_MS, 10_000, 1_000, 30_000),
    wikiquoteEnabled: env.WIKIQUOTE_ENABLED !== 'false',
    wikiquoteLanguage: env.WIKIQUOTE_LANGUAGE || 'en',
    wikiquoteTimeoutMs: boundedInteger(env.WIKIQUOTE_TIMEOUT_MS, 8_000, 1_000, 15_000),
    wikiquoteMaxResults: boundedInteger(env.WIKIQUOTE_MAX_RESULTS, 4, 1, 5),
  };
}

module.exports = { DEFAULT_BASE_URL, boundedInteger, loadAiConfig, resolveCompletionUrl };
