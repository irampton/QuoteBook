import { createHash, createHmac, randomBytes } from "node:crypto";
import { Router } from "express";
import { assert, HttpError } from "./errors.js";
import { transaction } from "./db.js";
import { positiveInteger } from "./validation.js";

const TOKEN_PATTERN = /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function materializeToken(secret, quoteId, selector) {
  const authenticator = createHmac("sha256", secret)
    .update(`quotebook-share:v1:${quoteId}:${selector}`)
    .digest("base64url");
  return `${selector}.${authenticator}`;
}

function shareNotFound() {
  return new HttpError(404, "share_not_found", "Shared quote not found.");
}

function sharedQuote(db, secret, token, privateFields = false) {
  const match = typeof token === "string" ? token.match(TOKEN_PATTERN) : null;
  if (!match) throw shareNotFound();
  const columns = privateFields
    ? "q.id, q.user_id AS userId, q.text, q.author"
    : "q.id AS internalQuoteId, q.text, q.author";
  const quote = db.prepare(`
    SELECT ${columns} FROM quote_shares s JOIN quotes q ON q.id = s.quote_id
    WHERE s.selector = ? AND s.token_hash = ?
  `).get(match[1], tokenHash(token));
  if (!quote) throw shareNotFound();

  // The hash lookup is sufficient, and this also guards against accidental key rotation.
  const expected = materializeToken(secret, privateFields ? quote.id : quote.internalQuoteId, match[1]);
  if (expected !== token) throw shareNotFound();
  if (!privateFields) delete quote.internalQuoteId;
  return quote;
}

function categoryIds(body) {
  assert(Array.isArray(body?.categoryIds), 400, "invalid_categories", "categoryIds must be an array.");
  const ids = [...new Set(body.categoryIds)];
  assert(ids.length >= 1 && ids.length <= 50, 400, "invalid_categories", "Choose between 1 and 50 categories.");
  assert(ids.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0), 400, "invalid_categories", "categoryIds contains an invalid category.");
  return ids;
}

function verifyCategoryOwnership(db, userId, ids) {
  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`SELECT COUNT(*) AS count FROM categories WHERE user_id = ? AND id IN (${placeholders})`).get(userId, ...ids);
  assert(Number(result.count) === ids.length, 400, "invalid_categories", "One or more categories do not exist.");
}

function ownedQuote(db, userId, quoteId) {
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

export function createOwnedSharesRouter(db, getSecret) {
  const router = Router();

  function respondWithShare(request, response, createIfMissing) {
    const quoteId = positiveInteger(request.params.id, "quote_id");
    assert(ownedQuote(db, request.user.id, quoteId), 404, "quote_not_found", "Quote not found.");
    const secret = getSecret();
    let row = db.prepare("SELECT selector, token_hash AS tokenHash FROM quote_shares WHERE quote_id = ?").get(quoteId);
    const existed = Boolean(row);
    if (!row) {
      if (!createIfMissing) throw shareNotFound();
      const selector = randomBytes(24).toString("base64url");
      const token = materializeToken(secret, quoteId, selector);
      db.prepare("INSERT INTO quote_shares (quote_id, selector, token_hash) VALUES (?, ?, ?)")
        .run(quoteId, selector, tokenHash(token));
      row = { selector, tokenHash: tokenHash(token) };
    }
    const token = materializeToken(secret, quoteId, row.selector);
    if (row.tokenHash !== tokenHash(token)) {
      db.prepare("UPDATE quote_shares SET token_hash = ? WHERE quote_id = ?").run(tokenHash(token), quoteId);
    }
    response.status(existed ? 200 : 201).json({ share: { token, path: `/q/${token}` } });
  }

  router.get("/:id/share", (request, response) => respondWithShare(request, response, false));
  router.post("/:id/share", (request, response) => respondWithShare(request, response, true));
  return router;
}

export function createPublicSharesRouter(db, getSecret) {
  const router = Router();
  router.get("/:token", (request, response) => {
    const quote = sharedQuote(db, getSecret(), request.params.token);
    response.set("Cache-Control", "no-store");
    response.json({ quote });
  });
  return router;
}

export function createShareImportsRouter(db, getSecret) {
  const router = Router();
  router.post("/:token/import", (request, response) => {
    const source = sharedQuote(db, getSecret(), request.params.token, true);
    const ids = categoryIds(request.body);
    verifyCategoryOwnership(db, request.user.id, ids);

    const result = transaction(db, () => {
      let quoteId = source.id;
      let created = false;
      if (source.userId !== request.user.id) {
        const previousImport = db.prepare(`
          SELECT imported_quote_id AS quoteId FROM quote_share_imports
          WHERE share_quote_id = ? AND user_id = ?
        `).get(source.id, request.user.id);
        if (previousImport) {
          quoteId = previousImport.quoteId;
        } else {
          const inserted = db.prepare(`
            INSERT INTO quotes (user_id, text, author, lookup_mode) VALUES (?, ?, ?, 'parse')
          `).run(request.user.id, source.text, source.author);
          quoteId = inserted.lastInsertRowid;
          db.prepare(`
            INSERT INTO quote_share_imports (share_quote_id, user_id, imported_quote_id) VALUES (?, ?, ?)
          `).run(source.id, request.user.id, quoteId);
          created = true;
        }
      }
      const attach = db.prepare("INSERT OR IGNORE INTO quote_categories (quote_id, category_id) VALUES (?, ?)");
      for (const id of ids) attach.run(quoteId, id);
      return { created, quote: ownedQuote(db, request.user.id, quoteId) };
    });
    response.status(result.created ? 201 : 200).json(result);
  });
  return router;
}
