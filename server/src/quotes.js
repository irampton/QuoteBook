import { Router } from "express";
import { assert } from "./errors.js";
import { transaction } from "./db.js";
import { nonNegativeInteger, positiveInteger } from "./validation.js";

const MAX_TEXT_LENGTH = 10_000;
const WRAPPING_MARKS = [["\"", "\""], ["'", "'"], ["\u201c", "\u201d"], ["\u2018", "\u2019"], ["\u00ab", "\u00bb"]];

function stripWrappingMarks(value) {
  const text = value.trim();
  for (const [left, right] of WRAPPING_MARKS) {
    if (!text.startsWith(left)) continue;
    if (text.endsWith(right)) return text.slice(left.length, -right.length).trim();
    const terminal = text.at(-1);
    if (/[.!?;:\u2026]/u.test(terminal) && text.slice(0, -1).endsWith(right)) {
      return `${text.slice(left.length, -(right.length + 1)).trim()}${terminal}`;
    }
  }
  return text;
}

function optionalText(value, field, maximum = 2_000) {
  if (value === undefined || value === null || value === "") return null;
  assert(typeof value === "string", 400, "invalid_quote", `${field} must be text.`);
  const result = value.trim();
  assert(result.length <= maximum, 400, "invalid_quote", `${field} is too long.`);
  return result || null;
}

function normalizeQuote(body, partial = false) {
  const quote = {};
  if (!partial || body?.text !== undefined) {
    assert(typeof body?.text === "string", 400, "invalid_quote", "Quote text is required.");
    quote.text = stripWrappingMarks(body.text);
    assert(quote.text.length >= 1 && quote.text.length <= MAX_TEXT_LENGTH, 400, "invalid_quote", "Quote text must be between 1 and 10,000 characters.");
  }
  for (const [jsonName, column, maximum] of [
    ["author", "author", 300], ["date", "quote_date", 100], ["source", "source", 1_000], ["context", "context", 4_000],
  ]) {
    if (!partial || body?.[jsonName] !== undefined) quote[column] = optionalText(body?.[jsonName], jsonName, maximum);
  }
  if (!partial || body?.lookupMode !== undefined) {
    quote.lookup_mode = body?.lookupMode || "search";
    assert(["search", "parse"].includes(quote.lookup_mode), 400, "invalid_lookup_mode", "lookupMode must be search or parse.");
  }
  if (!partial || body?.categoryIds !== undefined) {
    assert(Array.isArray(body?.categoryIds ?? []), 400, "invalid_categories", "categoryIds must be an array.");
    quote.categoryIds = [...new Set((body?.categoryIds ?? []).map((id) => {
      assert(typeof id === "number" && Number.isSafeInteger(id) && id > 0, 400, "invalid_categories", "categoryIds contains an invalid category.");
      return id;
    }))];
    assert(quote.categoryIds.length <= 50, 400, "invalid_categories", "A quote can have at most 50 categories.");
  }
  return quote;
}

function verifyCategories(db, userId, categoryIds) {
  if (!categoryIds.length) return;
  const placeholders = categoryIds.map(() => "?").join(",");
  const count = db.prepare(`SELECT COUNT(*) AS count FROM categories WHERE user_id = ? AND id IN (${placeholders})`).get(userId, ...categoryIds).count;
  assert(Number(count) === categoryIds.length, 400, "invalid_categories", "One or more categories do not exist.");
}

function quoteById(db, userId, quoteId) {
  const quote = db.prepare(`
    SELECT id, text, author, quote_date AS date, source, context, lookup_mode AS lookupMode,
           created_at AS createdAt, updated_at AS updatedAt
    FROM quotes WHERE id = ? AND user_id = ?
  `).get(quoteId, userId);
  if (!quote) return null;
  quote.categories = db.prepare(`
    SELECT c.id, c.name FROM categories c JOIN quote_categories qc ON qc.category_id = c.id
    WHERE qc.quote_id = ? ORDER BY c.name COLLATE NOCASE
  `).all(quoteId);
  quote.categoryIds = quote.categories.map((category) => category.id);
  return quote;
}

function attachCategories(db, userId, quotes) {
  if (!quotes.length) return quotes;
  const categoriesByQuote = new Map(quotes.map((quote) => [quote.id, []]));
  const placeholders = quotes.map(() => "?").join(",");
  const categories = db.prepare(`
    SELECT qc.quote_id AS quoteId, c.id, c.name
    FROM quote_categories qc JOIN categories c ON c.id = qc.category_id
    WHERE c.user_id = ? AND qc.quote_id IN (${placeholders})
    ORDER BY c.name COLLATE NOCASE
  `).all(userId, ...quotes.map((quote) => quote.id));
  for (const category of categories) {
    categoriesByQuote.get(category.quoteId)?.push({ id: category.id, name: category.name });
  }
  return quotes.map((quote) => {
    const quoteCategories = categoriesByQuote.get(quote.id);
    return { ...quote, categories: quoteCategories, categoryIds: quoteCategories.map((category) => category.id) };
  });
}

export function createQuotesRouter(db) {
  const router = Router();

  router.get("/", (request, response) => {
    assert(request.query.search === undefined || typeof request.query.search === "string", 400, "invalid_search", "search must be text.");
    const search = request.query.search?.trim() || "";
    assert(search.length <= 500, 400, "invalid_search", "search must be at most 500 characters.");
    const category = request.query.category === undefined ? null : positiveInteger(request.query.category, "category");
    const limit = nonNegativeInteger(request.query.limit, "limit", 50, 100);
    const offset = nonNegativeInteger(request.query.offset, "offset", 0, 1_000_000);
    assert(limit >= 1, 400, "invalid_limit", "limit must be at least 1.");

    const where = ["q.user_id = ?"];
    const params = [request.user.id];
    if (search) {
      where.push("(q.text LIKE ? ESCAPE '\\' OR q.author LIKE ? ESCAPE '\\' OR q.source LIKE ? ESCAPE '\\' OR q.context LIKE ? ESCAPE '\\')");
      const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    if (category) {
      where.push("EXISTS (SELECT 1 FROM quote_categories filter_qc WHERE filter_qc.quote_id = q.id AND filter_qc.category_id = ?)");
      params.push(category);
    }

    const rows = db.prepare(`
      SELECT q.id, q.text, q.author, q.quote_date AS date, q.source, q.context, q.lookup_mode AS lookupMode,
             q.created_at AS createdAt, q.updated_at AS updatedAt
      FROM quotes q WHERE ${where.join(" AND ")}
      ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?
    `)
      .all(...params, limit, offset);
    const quotes = attachCategories(db, request.user.id, rows);
    response.json({ quotes, pagination: { limit, offset, count: quotes.length } });
  });

  router.get("/:id", (request, response) => {
    const id = positiveInteger(request.params.id, "quote_id");
    const quote = quoteById(db, request.user.id, id);
    assert(quote, 404, "quote_not_found", "Quote not found.");
    response.json({ quote });
  });

  router.post("/", (request, response) => {
    const values = normalizeQuote(request.body);
    verifyCategories(db, request.user.id, values.categoryIds);
    const quote = transaction(db, () => {
      const result = db.prepare(`
        INSERT INTO quotes (user_id, text, author, quote_date, source, context, lookup_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(request.user.id, values.text, values.author, values.quote_date, values.source, values.context, values.lookup_mode);
      const insertCategory = db.prepare("INSERT INTO quote_categories (quote_id, category_id) VALUES (?, ?)");
      for (const categoryId of values.categoryIds) insertCategory.run(result.lastInsertRowid, categoryId);
      return quoteById(db, request.user.id, result.lastInsertRowid);
    });
    response.status(201).json({ quote });
  });

  router.patch("/:id", (request, response) => {
    const id = positiveInteger(request.params.id, "quote_id");
    assert(quoteById(db, request.user.id, id), 404, "quote_not_found", "Quote not found.");
    const values = normalizeQuote(request.body, true);
    if (values.categoryIds) verifyCategories(db, request.user.id, values.categoryIds);
    const columns = Object.keys(values).filter((key) => key !== "categoryIds");
    assert(columns.length || values.categoryIds, 400, "empty_update", "Provide at least one field to update.");

    const quote = transaction(db, () => {
      if (columns.length) {
        db.prepare(`UPDATE quotes SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
          .run(...columns.map((column) => values[column]), id, request.user.id);
      }
      if (values.categoryIds) {
        db.prepare("DELETE FROM quote_categories WHERE quote_id = ?").run(id);
        const insert = db.prepare("INSERT INTO quote_categories (quote_id, category_id) VALUES (?, ?)");
        for (const categoryId of values.categoryIds) insert.run(id, categoryId);
      }
      return quoteById(db, request.user.id, id);
    });
    response.json({ quote });
  });

  router.delete("/:id", (request, response) => {
    const id = positiveInteger(request.params.id, "quote_id");
    const result = db.prepare("DELETE FROM quotes WHERE id = ? AND user_id = ?").run(id, request.user.id);
    assert(result.changes, 404, "quote_not_found", "Quote not found.");
    response.status(204).end();
  });

  return router;
}
