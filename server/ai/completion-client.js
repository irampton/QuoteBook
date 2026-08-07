'use strict';

const { AiError } = require('./errors');
const { readBoundedText } = require('./bounded-response');

const MAX_COMPLETION_RESPONSE_BYTES = 2 * 1024 * 1024;

class CompletionClient {
  constructor({ url, apiKey, model, timeoutMs = 30_000, jsonMode = true, fetchImpl = globalThis.fetch }) {
    if (!url) throw new TypeError('CompletionClient requires a URL.');
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    this.url = url;
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.jsonMode = jsonMode;
    this.fetch = fetchImpl;
  }

  async completeJson({ system, user, signal }) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const body = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    if (this.jsonMode) body.response_format = { type: 'json_object' };

    let response;
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    } catch (error) {
      const timedOut = timeout.aborted && !(signal && signal.aborted);
      throw new AiError(
        timedOut ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
        timedOut ? 'The quote service timed out. Please try again.' : 'The quote service is unavailable. Please try again.',
        { status: timedOut ? 504 : 502, cause: error },
      );
    }

    if (!response.ok) {
      throw new AiError('AI_PROVIDER_ERROR', 'The quote service could not complete the request.', {
        status: response.status === 429 ? 429 : 502,
        details: { providerStatus: response.status },
      });
    }

    let payload;
    try {
      payload = JSON.parse(await readBoundedText(response, MAX_COMPLETION_RESPONSE_BYTES, 'AI_RESPONSE_TOO_LARGE'));
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError('INVALID_AI_RESPONSE', 'The quote service returned an unreadable response.', {
        status: 502,
        cause: error,
      });
    }

    const content = payload?.choices?.[0]?.message?.content
      ?? payload?.output_text
      ?? payload?.output?.[0]?.content?.[0]?.text;
    if (content == null) {
      throw new AiError('INVALID_AI_RESPONSE', 'The quote service returned no result.', { status: 502 });
    }
    return content;
  }
}

module.exports = { CompletionClient };
