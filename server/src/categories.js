import { Router } from "express";
import { assert } from "./errors.js";
import { transaction } from "./db.js";
import { positiveInteger } from "./validation.js";

function categoryName(value) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  assert(name.length >= 1 && name.length <= 60, 400, "invalid_category", "Category names must be between 1 and 60 characters.");
  assert(!/[\p{Cc}\p{Cf}]/u.test(name), 400, "invalid_category", "Category names cannot contain control characters.");
  return name;
}

export function createCategoriesRouter(db) {
  const router = Router();

  router.get("/", (request, response) => {
    const categories = db.prepare(`
      SELECT c.id, c.name, c.created_at AS createdAt, COUNT(qc.quote_id) AS quoteCount
      FROM categories c LEFT JOIN quote_categories qc ON qc.category_id = c.id
      WHERE c.user_id = ? GROUP BY c.id ORDER BY c.name COLLATE NOCASE
    `).all(request.user.id).map((category) => ({ ...category, quoteCount: Number(category.quoteCount) }));
    response.json({ categories });
  });

  router.post("/setup", (request, response) => {
    assert(Array.isArray(request.body?.categories), 400, "invalid_categories", "Categories must be an array.");
    assert(request.body.categories.length >= 1 && request.body.categories.length <= 20, 400, "invalid_categories", "Choose between 1 and 20 categories.");
    const namesByKey = new Map();
    for (const value of request.body.categories) {
      const name = categoryName(value);
      const key = name.toLocaleLowerCase();
      if (!namesByKey.has(key)) namesByKey.set(key, name);
    }
    const names = [...namesByKey.values()];
    assert(names.length >= 1 && names.length <= 20, 400, "invalid_categories", "Choose between 1 and 20 categories.");

    transaction(db, () => {
      const insert = db.prepare("INSERT OR IGNORE INTO categories (user_id, name) VALUES (?, ?)");
      for (const name of names) insert.run(request.user.id, name);
      db.prepare("UPDATE users SET onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(request.user.id);
    });

    const categories = db.prepare("SELECT id, name, created_at AS createdAt FROM categories WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(request.user.id);
    response.status(201).json({ categories, needsSetup: false });
  });

  router.post("/", (request, response) => {
    const name = categoryName(request.body?.name);
    const result = db.prepare("INSERT INTO categories (user_id, name) VALUES (?, ?)").run(request.user.id, name);
    const category = db.prepare("SELECT id, name, created_at AS createdAt FROM categories WHERE id = ?").get(result.lastInsertRowid);
    response.status(201).json({ category });
  });

  router.patch("/:id", (request, response) => {
    const id = positiveInteger(request.params.id, "category_id");
    const name = categoryName(request.body?.name);
    const result = db.prepare("UPDATE categories SET name = ? WHERE id = ? AND user_id = ?").run(name, id, request.user.id);
    assert(result.changes, 404, "category_not_found", "Category not found.");
    response.json({ category: db.prepare("SELECT id, name, created_at AS createdAt FROM categories WHERE id = ?").get(id) });
  });

  router.delete("/:id", (request, response) => {
    const id = positiveInteger(request.params.id, "category_id");
    const result = db.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").run(id, request.user.id);
    assert(result.changes, 404, "category_not_found", "Category not found.");
    response.status(204).end();
  });

  return router;
}
