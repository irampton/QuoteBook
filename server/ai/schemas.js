'use strict';

const { z } = require('zod');

const nonEmptyString = z.string().trim().min(1);
const optionalText = z.preprocess(
  (value) => (value == null || value === '' ? null : value),
  z.string().trim().nullable(),
);

const quoteSchema = z.object({
  text: nonEmptyString.max(20_000),
  author: z.preprocess(
    (value) => (value == null || value === '' ? 'Unknown' : value),
    nonEmptyString.max(500),
  ),
  source: optionalText,
  date: optionalText,
  context: optionalText,
  categories: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(nonEmptyString.max(100)).max(12),
  ),
  confidence: z.preprocess(
    (value) => (value == null ? null : value),
    z.number().min(0).max(1).nullable(),
  ),
  researchNotes: optionalText,
}).strict();

const splitSchema = z.object({
  quotes: z.array(nonEmptyString.max(20_000)).min(1).max(250),
}).strict();

const parseRequestSchema = z.object({
  text: nonEmptyString.max(20_000),
  searchOnline: z.boolean().optional().default(true),
}).strict();

const splitRequestSchema = z.object({
  text: nonEmptyString.max(500_000),
}).strict();

function stripWrappingQuotes(value) {
  let text = value.trim();
  const pairs = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['«', '»']];
  for (const [left, right] of pairs) {
    if (text.length >= 2 && text.startsWith(left) && text.endsWith(right)) {
      text = text.slice(left.length, -right.length).trim();
      break;
    }
  }
  return text;
}

function normalizeQuote(candidate) {
  const parsed = quoteSchema.parse(candidate);
  return quoteSchema.parse({
    ...parsed,
    text: stripWrappingQuotes(parsed.text),
    categories: [...new Set(parsed.categories.map((item) => item.trim()).filter(Boolean))],
  });
}

module.exports = {
  normalizeQuote,
  parseRequestSchema,
  quoteSchema,
  splitRequestSchema,
  splitSchema,
  stripWrappingQuotes,
};
