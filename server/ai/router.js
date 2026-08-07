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
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => { if (!res.writableEnded) abort(); };
    req.once('aborted', abort);
    res.once('close', close);
    try {
      const input = parseRequestSchema.parse(req.body);
      const quote = await service.parseQuote(input.text, {
        searchOnline: input.searchOnline,
        availableCategories: input.availableCategories,
        signal: controller.signal,
      });
      res.json({ quote });
    } catch (error) {
      if (controller.signal.aborted && (req.aborted || res.destroyed)) return;
      if (!(error instanceof AiError) && !(error instanceof ZodError)) logger?.error?.('AI parse request failed.', error);
      const response = publicError(error);
      res.status(response.status).json(response.body);
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', close);
    }
  });

  router.post('/split', async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => { if (!res.writableEnded) abort(); };
    req.once('aborted', abort);
    res.once('close', close);
    try {
      const input = splitRequestSchema.parse(req.body);
      const quotes = await service.splitQuotes(input.text, { signal: controller.signal });
      res.json({ quotes });
    } catch (error) {
      if (controller.signal.aborted && (req.aborted || res.destroyed)) return;
      if (!(error instanceof AiError) && !(error instanceof ZodError)) logger?.error?.('AI split request failed.', error);
      const response = publicError(error);
      res.status(response.status).json(response.body);
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', close);
    }
  });

  return router;
}

module.exports = { createAiRouter, publicError };
