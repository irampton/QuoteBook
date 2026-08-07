'use strict';

class AiError extends Error {
  constructor(code, message, { status = 502, details, cause } = {}) {
    super(message, { cause });
    this.name = 'AiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { AiError };
