'use strict';

const { AiError } = require('./errors');

function parseJsonObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') {
    throw new AiError('INVALID_AI_RESPONSE', 'The AI returned an unsupported response.', { status: 502 });
  }

  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return JSON.parse(unfenced);
  } catch (_) {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch (_) {
        // Fall through to a safe public error; never expose the provider payload.
      }
    }
  }

  throw new AiError('INVALID_AI_RESPONSE', 'The AI did not return valid structured data.', { status: 502 });
}

module.exports = { parseJsonObject };
