import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export function createDatabase(filename = process.env.DATABASE_PATH || path.join(moduleDirectory, "..", "data", "quotebook.db")) {
  if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });

  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = FAST;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS categories_user_id_idx ON categories(user_id);

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      author TEXT,
      quote_date TEXT,
      source TEXT,
      context TEXT,
      lookup_mode TEXT NOT NULL DEFAULT 'search' CHECK (lookup_mode IN ('search', 'parse')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE INDEX IF NOT EXISTS quotes_user_id_idx ON quotes(user_id);
    CREATE INDEX IF NOT EXISTS quotes_user_order_idx ON quotes(user_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS quote_categories (
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (quote_id, category_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS quote_categories_category_idx ON quote_categories(category_id);

    CREATE TABLE IF NOT EXISTS quote_shares (
      quote_id INTEGER PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
      selector TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS quote_share_imports (
      share_quote_id INTEGER NOT NULL REFERENCES quote_shares(quote_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      imported_quote_id INTEGER NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (share_quote_id, user_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS quote_share_imports_user_idx ON quote_share_imports(user_id);
  `);

  return db;
}

export function transaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
