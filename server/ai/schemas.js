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
  availableCategories: z.array(nonEmptyString.max(60)).max(100).optional().default([]),
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
    const outsidePunctuation = text.at(-1);
    if (text.length >= 3 && /[.?!…]/u.test(outsidePunctuation) && text.startsWith(left) && text.at(-2) === right) {
      const inner = text.slice(left.length, -2).trim();
      text = /[.?!…]$/u.test(inner) ? inner : `${inner}${outsidePunctuation}`;
      break;
    }
  }
  return text;
}

function normalizeQuoteText(value) {
  const text = stripWrappingQuotes(value);
  return /[\p{L}\p{N}]$/u.test(text) ? `${text}.` : text;
}

function canonicalCategories(suggestions, availableCategories = []) {
  const available = new Map();
  for (const category of availableCategories) {
    const trimmed = category.trim();
    const key = trimmed.toLocaleLowerCase();
    if (trimmed && !available.has(key)) available.set(key, trimmed);
  }
  const constrained = available.size > 0;
  const output = [];
  const seen = new Set();
  for (const suggestion of suggestions) {
    const trimmed = suggestion.trim();
    const key = trimmed.toLocaleLowerCase();
    const value = constrained ? available.get(key) : trimmed;
    if (value && !seen.has(value.toLocaleLowerCase())) {
      seen.add(value.toLocaleLowerCase());
      output.push(value);
    }
  }
  return output;
}

function normalizeQuote(candidate, availableCategories = []) {
  const parsed = quoteSchema.parse(candidate);
  return quoteSchema.parse({
    ...parsed,
    text: normalizeQuoteText(parsed.text),
    categories: canonicalCategories(parsed.categories, availableCategories),
  });
}

module.exports = {
  normalizeQuote,
  normalizeQuoteText,
  canonicalCategories,
  parseRequestSchema,
  quoteSchema,
  splitRequestSchema,
  splitSchema,
  stripWrappingQuotes,
};
