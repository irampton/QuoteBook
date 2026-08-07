'use strict';

const express = require('express');
const { ZodError } = require('zod');
const { AiError } = require('./errors');
const { parseRequestSchema, splitRequestSchema } = require('./schemas');

function publicError(error) {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Please check the submitted quote text and options.',
          details: { fields: error.issues.map((issue) => issue.path.join('.')).filter(Boolean) },
        },
      },
    };
  }
  if (error instanceof AiError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong while processing the quote.' } },
  };
}

function createAiRouter({ service, logger = console } = {}) {
  if (!service) throw new TypeError('createAiRouter requires an AI service.');
  const router = express.Router();

  router.post('/parse', async (req, res) => {
    try {
      const input = parseRequestSchema.parse(req.body);
      const quote = await service.parseQuote(input.text, {
        searchOnline: input.searchOnline,
        availableCategories: input.availableCategories,
      });
      res.json({ quote });
    } catch (error) {
      if (!(error instanceof AiError) && !(error instanceof ZodError)) logger?.error?.('AI parse request failed.', error);
      const response = publicError(error);
      res.status(response.status).json(response.body);
    }
  });

  router.post('/split', async (req, res) => {
    try {
      const input = splitRequestSchema.parse(req.body);
      const quotes = await service.splitQuotes(input.text);
      res.json({ quotes });
    } catch (error) {
      if (!(error instanceof AiError) && !(error instanceof ZodError)) logger?.error?.('AI split request failed.', error);
      const response = publicError(error);
      res.status(response.status).json(response.body);
    }
  });

  return router;
}

module.exports = { createAiRouter, publicError };
