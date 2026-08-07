import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
import { createRateLimiter } from "../src/rate-limit.js";

let db;
let server;
let baseUrl;
let token;
let categoryId;
let lastParseOptions;

const aiService = {
  async parseQuote(text, { searchOnline, availableCategories = [] }) {
    lastParseOptions = { searchOnline, availableCategories };
    return {
      text: text.replace(/^[“"]|[”"]$/g, ""),
      author: "Test Author",
      source: null,
      date: null,
      context: null,
      categories: searchOnline ? ["Researched"] : ["Parsed"],
      confidence: 0.9,
      researchNotes: null,
    };
  },
  async splitQuotes() {
    return ["First", "Second"];
  },
};

before(async () => {
  db = createDatabase(":memory:");
  server = createApp(db, { aiService }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

async function api(path, { method = "GET", body, auth } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, body: data };
}

async function rawApi(path, { method = "POST", body, auth, contentType = "application/json" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": contentType, ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body,
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("health check is public", async () => {
  const rawResponse = await fetch(`${baseUrl}/api/health`);
  const response = { status: rawResponse.status, body: await rawResponse.json() };
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
  assert.match(rawResponse.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(rawResponse.headers.get("x-content-type-options"), "nosniff");
});

test("enables database integrity and performance pragmas", () => {
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(db.prepare("PRAGMA busy_timeout").get().timeout, 5_000);
  assert.ok(db.prepare("PRAGMA secure_delete").get().secure_delete >= 1);
  const indexes = db.prepare("PRAGMA index_list('quotes')").all().map((index) => index.name);
  assert.ok(indexes.includes("quotes_user_order_idx"));
});

test("returns safe client errors for malformed JSON", async () => {
  const response = await rawApi("/api/auth/login", { body: "{not json" });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "invalid_json");
});

test("normalizes compatibility characters in usernames", async () => {
  const signup = await api("/api/auth/signup", {
    method: "POST", body: { username: "Ｆｏｏ.bar", password: "another secure password" },
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.user.username, "Foo.bar");
  const login = await api("/api/auth/login", {
    method: "POST", body: { username: "foo.BAR", password: "another secure password" },
  });
  assert.equal(login.status, 200);
});

test("unknown API routes return JSON 404s instead of the production SPA", async () => {
  const response = await api("/api/does-not-exist");
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "not_found");
});

test("signs up and requires onboarding", async () => {
  const plaintextPassword = "correct horse battery staple";
  const response = await api("/api/auth/signup", { method: "POST", body: { username: "reader.one", password: plaintextPassword } });
  assert.equal(response.status, 201);
  token = response.body.token;
  assert.equal(response.body.user.username, "reader.one");
  assert.equal(response.body.needsSetup, true);
  assert.ok(token);
  const stored = db.prepare("SELECT password_hash, password_salt FROM users WHERE username = ?").get("reader.one");
  assert.notEqual(stored.password_hash, plaintextPassword);
  assert.ok(stored.password_hash.length >= 64);
  assert.ok(stored.password_salt.length >= 16);
  const storedSession = db.prepare("SELECT token_hash FROM sessions WHERE user_id = ?").get(response.body.user.id);
  assert.notEqual(storedSession.token_hash, token);
  assert.equal(storedSession.token_hash.length, 64);
});

test("rejects unauthenticated category reads", async () => {
  assert.equal((await api("/api/categories")).status, 401);
  assert.equal((await api("/api/categories", { auth: "x".repeat(10_000) })).status, 401);
});

test("protects AI routes and returns the frontend contract for authenticated users", async () => {
  assert.equal((await api("/api/ai/parse", { method: "POST", body: { text: "Private quote" } })).status, 401);

  const parsed = await api("/api/ai/parse", {
    method: "POST", auth: token, body: { text: "“Private quote”", searchOnline: false },
  });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.body.quote.text, "Private quote");
  assert.deepEqual(parsed.body.quote.categories, ["Parsed"]);

  const categorizedParse = await api("/api/ai/parse", {
    method: "POST",
    auth: token,
    body: { text: "Categorize this quote", searchOnline: true, availableCategories: ["Funny", "Deep"] },
  });
  assert.equal(categorizedParse.status, 200);
  assert.ok(categorizedParse.body.quote);
  assert.deepEqual(lastParseOptions, { searchOnline: true, availableCategories: ["Funny", "Deep"] });

  const split = await api("/api/ai/split", {
    method: "POST", auth: token, body: { text: "First\nSecond" },
  });
  assert.equal(split.status, 200);
  assert.deepEqual(split.body.quotes, ["First", "Second"]);

  const invalid = await api("/api/ai/parse", {
    method: "POST", auth: token, body: { text: "   ", searchOnline: true },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_REQUEST");
});

test("sets up categories", async () => {
  const response = await api("/api/categories/setup", {
    method: "POST", auth: token, body: { categories: ["Funny", "Meaningful", "funny"] },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.needsSetup, false);
  assert.equal(response.body.categories.length, 2);
  categoryId = response.body.categories.find((category) => category.name === "Funny").id;
});

test("returns a generic conflict for duplicate categories", async () => {
  const response = await api("/api/categories", {
    method: "POST", auth: token, body: { name: "FUNNY" },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: { code: "conflict", message: "That value already exists." } });
});

test("All Quotes includes categorized and uncategorized quotes while category filters exclude uncategorized quotes", async () => {
  const categorized = await api("/api/quotes", {
    method: "POST",
    auth: token,
    body: { text: "A categorized regression quote", categoryIds: [categoryId] },
  });
  const uncategorized = await api("/api/quotes", {
    method: "POST",
    auth: token,
    body: { text: "An uncategorized regression quote", categoryIds: [] },
  });
  assert.equal(categorized.status, 201);
  assert.equal(uncategorized.status, 201);

  const allQuotes = await api("/api/quotes", { auth: token });
  const allIds = new Set(allQuotes.body.quotes.map((quote) => quote.id));
  assert.equal(allQuotes.status, 200);
  assert.equal(allIds.has(categorized.body.quote.id), true);
  assert.equal(allIds.has(uncategorized.body.quote.id), true);
  assert.deepEqual(
    allQuotes.body.quotes.find((quote) => quote.id === uncategorized.body.quote.id).categories,
    [],
  );

  const categoryQuotes = await api(`/api/quotes?category=${categoryId}`, { auth: token });
  const categoryIds = new Set(categoryQuotes.body.quotes.map((quote) => quote.id));
  assert.equal(categoryQuotes.status, 200);
  assert.equal(categoryIds.has(categorized.body.quote.id), true);
  assert.equal(categoryIds.has(uncategorized.body.quote.id), false);

  await api(`/api/quotes/${categorized.body.quote.id}`, { method: "DELETE", auth: token });
  await api(`/api/quotes/${uncategorized.body.quote.id}`, { method: "DELETE", auth: token });
});

test("creates, searches, updates, and deletes a quote", async () => {
  const created = await api("/api/quotes", { method: "POST", auth: token, body: {
    text: "“Simplicity is the soul of efficiency.”", author: "Austin Freeman",
    source: "Test fixture", lookupMode: "search", categoryIds: [categoryId],
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.quote.text, "Simplicity is the soul of efficiency.");
  assert.deepEqual(created.body.quote.categoryIds, [categoryId]);

  const searched = await api("/api/quotes?search=efficiency", { auth: token });
  assert.equal(searched.status, 200);
  assert.equal(searched.body.quotes.length, 1);
  const filtered = await api(`/api/quotes?category=${categoryId}`, { auth: token });
  assert.equal(filtered.body.quotes.length, 1);

  const quoteId = created.body.quote.id;
  const updated = await api(`/api/quotes/${quoteId}`, {
    method: "PATCH", auth: token, body: { context: "Edited context", categoryIds: [] },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.quote.context, "Edited context");
  assert.deepEqual(updated.body.quote.categoryIds, []);
  assert.equal((await api(`/api/quotes/${quoteId}`, { method: "DELETE", auth: token })).status, 204);
  assert.equal((await api(`/api/quotes/${quoteId}`, { auth: token })).status, 404);
});

test("validates pagination, IDs, and literal wildcard searches", async () => {
  assert.equal((await api("/api/quotes?limit=1.5", { auth: token })).status, 400);
  assert.equal((await api("/api/quotes?offset=-1", { auth: token })).status, 400);
  assert.equal((await api("/api/quotes?category=0", { auth: token })).status, 400);
  assert.equal((await api("/api/quotes/not-a-number", { auth: token })).status, 400);
  assert.equal((await api("/api/quotes", {
    method: "POST", auth: token, body: { text: "Invalid category type", categoryIds: [String(categoryId)] },
  })).status, 400);

  const created = await api("/api/quotes", {
    method: "POST", auth: token, body: { text: "Progress is 100% earned", categoryIds: [] },
  });
  const searched = await api("/api/quotes?search=%25", { auth: token });
  assert.equal(searched.status, 200);
  assert.deepEqual(searched.body.quotes.map((quote) => quote.id), [created.body.quote.id]);
});

test("login and logout issue and revoke sessions", async () => {
  const loggedIn = await api("/api/auth/login", {
    method: "POST", body: { username: "READER.ONE", password: "correct horse battery staple" },
  });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.needsSetup, false);
  assert.equal((await api("/api/auth/logout", { method: "POST", auth: loggedIn.body.token })).status, 204);
  assert.equal((await api("/api/auth/me", { auth: loggedIn.body.token })).status, 401);
});

test("cleans up expired sessions and caps active sessions per user", async () => {
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get("reader.one");
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(user.id, "a".repeat(64), "2000-01-01T00:00:00.000Z");
  for (let index = 0; index < 21; index += 1) {
    const response = await api("/api/auth/login", {
      method: "POST", body: { username: "reader.one", password: "correct horse battery staple" },
    });
    assert.equal(response.status, 200);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE expires_at <= ?").get(new Date().toISOString()).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get(user.id).count, 20);
});

test("rate limiter emits retry metadata and a safe 429", () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
  const headers = new Map();
  const response = { set(name, value) { headers.set(name, value); } };
  let firstPassed = false;
  limiter({ ip: "test-client" }, response, () => { firstPassed = true; });
  assert.equal(firstPassed, true);
  let rejection;
  limiter({ ip: "test-client" }, response, (error) => { rejection = error; });
  assert.equal(rejection.status, 429);
  assert.equal(rejection.code, "rate_limited");
  assert.ok(Number(headers.get("Retry-After")) >= 1);
});

test("isolates categories and quotes between users", async () => {
  const firstLogin = await api("/api/auth/login", {
    method: "POST", body: { username: "reader.one", password: "correct horse battery staple" },
  });
  const secondSignup = await api("/api/auth/signup", {
    method: "POST", body: { username: "reader.two", password: "a different secure password" },
  });
  assert.equal(secondSignup.status, 201);
  const secondToken = secondSignup.body.token;

  const firstCategory = await api("/api/categories", {
    method: "POST", auth: firstLogin.body.token, body: { name: "Private" },
  });
  const firstQuote = await api("/api/quotes", {
    method: "POST", auth: firstLogin.body.token,
    body: { text: "Only the first user can read this", categoryIds: [firstCategory.body.category.id] },
  });
  assert.equal(firstQuote.status, 201);

  assert.equal((await api(`/api/quotes/${firstQuote.body.quote.id}`, { auth: secondToken })).status, 404);
  assert.equal((await api(`/api/quotes/${firstQuote.body.quote.id}`, {
    method: "PATCH", auth: secondToken, body: { text: "stolen" },
  })).status, 404);
  assert.equal((await api(`/api/quotes/${firstQuote.body.quote.id}`, {
    method: "DELETE", auth: secondToken,
  })).status, 404);

  const crossUserCategory = await api("/api/quotes", {
    method: "POST", auth: secondToken,
    body: { text: "Cannot attach another user's category", categoryIds: [firstCategory.body.category.id] },
  });
  assert.equal(crossUserCategory.status, 400);

  const secondList = await api("/api/quotes", { auth: secondToken });
  assert.equal(secondList.status, 200);
  assert.deepEqual(secondList.body.quotes, []);
  assert.equal((await api(`/api/quotes/${firstQuote.body.quote.id}`, { auth: firstLogin.body.token })).status, 200);
});
