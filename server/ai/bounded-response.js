'use strict';

const { AiError } = require('./errors');

async function readBoundedText(response, maxBytes, code = 'UPSTREAM_RESPONSE_TOO_LARGE') {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiError(code, 'An upstream service returned too much data.', { status: 502 });
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new AiError(code, 'An upstream service returned too much data.', { status: 502 });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AiError(code, 'An upstream service returned too much data.', { status: 502 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

module.exports = { readBoundedText };
