'use strict';

const { CompletionClient } = require('./completion-client');
const { loadAiConfig } = require('./config');
const { QuoteAiService } = require('./quote-service');
const { QuoteResearchHarness } = require('./research-harness');
const { createAiRouter } = require('./router');
const { InternetSearchHarness } = require('./search-harness');
const { WikiquoteSearchHarness } = require('./wikiquote-search');

function createAiService({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const config = loadAiConfig(env);
  const completionClient = new CompletionClient({
    url: config.completionUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
    jsonMode: config.jsonMode,
    fetchImpl,
  });
  const webSearchHarness = new InternetSearchHarness({
    url: config.searchUrl,
    apiKey: config.searchApiKey,
    timeoutMs: config.searchTimeoutMs,
    fetchImpl,
  });
  const wikiquoteHarness = config.wikiquoteEnabled ? new WikiquoteSearchHarness({
    language: config.wikiquoteLanguage,
    timeoutMs: config.wikiquoteTimeoutMs,
    maxResults: config.wikiquoteMaxResults,
    fetchImpl,
  }) : null;
  const searchHarness = new QuoteResearchHarness({ wikiquoteHarness, webSearchHarness, logger });
  return new QuoteAiService({ completionClient, searchHarness, logger });
}

function createConfiguredAiRouter(options = {}) {
  const service = options.service || createAiService(options);
  return createAiRouter({ service, logger: options.logger });
}

module.exports = {
  CompletionClient,
  InternetSearchHarness,
  QuoteResearchHarness,
  QuoteAiService,
  WikiquoteSearchHarness,
  createAiRouter: createConfiguredAiRouter,
  createAiService,
  loadAiConfig,
};
