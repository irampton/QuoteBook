import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
import { createRateLimiter } from "../src/rate-limit.js";

let db;
let server;
let baseUrl;
let token;
let categoryId;
let lastParseOptions;
let aiAbortStarted;
let aiAbortObserved;

const aiService = {
  async parseQuote(text, { searchOnline, availableCategories = [], signal }) {
    if (text === "WAIT_FOR_HTTP_ABORT") {
      aiAbortStarted?.();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aiAbortObserved?.();
          reject(new Error("request aborted"));
        }, { once: true });
      });
    }
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
  server = createApp(db, { aiService, shareSecret: Buffer.alloc(32, 7) }).listen(0, "127.0.0.1");
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
  return { status: response.status, body: data, headers: response.headers };
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

test("production SPA fallback serves dotted share paths without swallowing missing assets", async () => {
  const sharePage = await fetch(`${baseUrl}/q/${"A".repeat(32)}.${"B".repeat(43)}`);
  assert.equal(sharePage.status, 200);
  assert.match(sharePage.headers.get("content-type"), /^text\/html/);
  assert.match(await sharePage.text(), /<div id="app"><\/div>/);

  const unavailableSharePage = await fetch(`${baseUrl}/q/not-a-valid-token`);
  assert.equal(unavailableSharePage.status, 200);
  assert.match(unavailableSharePage.headers.get("content-type"), /^text\/html/);

  const missingAsset = await fetch(`${baseUrl}/assets/not-a-real-asset`);
  assert.equal(missingAsset.status, 404);
  assert.match(missingAsset.headers.get("content-type"), /^application\/json/);
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

test("aborts in-flight AI work when the HTTP client disconnects", async () => {
  let signalStarted;
  let signalObserved;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const observed = new Promise((resolve) => { signalObserved = resolve; });
  aiAbortStarted = signalStarted;
  aiAbortObserved = signalObserved;

  const body = JSON.stringify({ text: "WAIT_FOR_HTTP_ABORT", searchOnline: true });
  const clientRequest = httpRequest(`${baseUrl}/api/ai/parse`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
  });
  clientRequest.on("error", () => {});
  clientRequest.end(body);
  await started;
  clientRequest.destroy();
  await Promise.race([
    observed,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("AI abort signal was not propagated")), 1_000)),
  ]);
  aiAbortStarted = null;
  aiAbortObserved = null;
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

test("quote edits and deletes preserve isolation, category counts, response shape, and share lifecycle", async () => {
  const owner = await api("/api/auth/signup", {
    method: "POST", body: { username: "edit.owner", password: "secure editing password" },
  });
  const attacker = await api("/api/auth/signup", {
    method: "POST", body: { username: "edit.attacker", password: "secure attacker password" },
  });
  const ownerSetup = await api("/api/categories/setup", {
    method: "POST", auth: owner.body.token, body: { categories: ["Before Edit", "After Edit"] },
  });
  const attackerSetup = await api("/api/categories/setup", {
    method: "POST", auth: attacker.body.token, body: { categories: ["Foreign"] },
  });
  const beforeId = ownerSetup.body.categories.find((category) => category.name === "Before Edit").id;
  const afterId = ownerSetup.body.categories.find((category) => category.name === "After Edit").id;
  const foreignId = attackerSetup.body.categories[0].id;

  const created = await api("/api/quotes", {
    method: "POST",
    auth: owner.body.token,
    body: {
      text: "\u201cKeep going.\u201d",
      author: "Original Author",
      date: "2025",
      source: "Original Source",
      context: "Original Context",
      lookupMode: "search",
      categoryIds: [beforeId],
    },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body), ["quote"]);
  assert.deepEqual(Object.keys(created.body.quote).sort(), [
    "author", "categories", "categoryIds", "context", "createdAt", "date", "id", "lookupMode", "source", "text", "updatedAt",
  ]);
  assert.equal(created.body.quote.text, "Keep going.");
  assert.deepEqual(created.body.quote.categories, [{ id: beforeId, name: "Before Edit" }]);

  const countsBefore = await api("/api/categories", { auth: owner.body.token });
  assert.equal(countsBefore.body.categories.find((category) => category.id === beforeId).quoteCount, 1);
  assert.equal(countsBefore.body.categories.find((category) => category.id === afterId).quoteCount, 0);

  const quoteId = created.body.quote.id;
  const edited = await api(`/api/quotes/${quoteId}`, {
    method: "PATCH",
    auth: owner.body.token,
    body: { text: "\"Keep going\".", author: "Edited Author", categoryIds: [afterId, afterId] },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(Object.keys(edited.body), ["quote"]);
  assert.equal(edited.body.quote.id, quoteId);
  assert.equal(edited.body.quote.text, "Keep going.");
  assert.equal(edited.body.quote.author, "Edited Author");
  assert.deepEqual(edited.body.quote.categories, [{ id: afterId, name: "After Edit" }]);
  assert.deepEqual(edited.body.quote.categoryIds, [afterId]);

  const countsAfterEdit = await api("/api/categories", { auth: owner.body.token });
  assert.equal(countsAfterEdit.body.categories.find((category) => category.id === beforeId).quoteCount, 0);
  assert.equal(countsAfterEdit.body.categories.find((category) => category.id === afterId).quoteCount, 1);

  assert.equal((await api(`/api/quotes/${quoteId}`, {
    method: "PATCH", auth: owner.body.token, body: { text: "Must not apply", categoryIds: "invalid" },
  })).status, 400);
  assert.equal((await api(`/api/quotes/${quoteId}`, {
    method: "PATCH", auth: owner.body.token, body: { text: "Must not apply either", categoryIds: [foreignId] },
  })).status, 400);
  assert.equal((await api(`/api/quotes/${quoteId}`, {
    method: "PATCH", auth: attacker.body.token, body: { text: "Stolen edit", categoryIds: [foreignId] },
  })).status, 404);
  assert.equal((await api(`/api/quotes/${quoteId}`, { method: "DELETE", auth: attacker.body.token })).status, 404);
  const unchanged = await api(`/api/quotes/${quoteId}`, { auth: owner.body.token });
  assert.equal(unchanged.body.quote.text, "Keep going.");
  assert.deepEqual(unchanged.body.quote.categoryIds, [afterId]);

  const share = await api(`/api/quotes/${quoteId}/share`, { method: "POST", auth: owner.body.token });
  assert.equal(share.status, 201);
  assert.equal((await api(`/api/shares/${share.body.share.token}`)).status, 200);
  const deleted = await api(`/api/quotes/${quoteId}`, { method: "DELETE", auth: owner.body.token });
  assert.equal(deleted.status, 204);
  assert.equal(deleted.body, null);
  assert.equal((await api(`/api/quotes/${quoteId}`, { auth: owner.body.token })).status, 404);
  assert.equal((await api(`/api/shares/${share.body.share.token}`)).status, 404);
  const countsAfterDelete = await api("/api/categories", { auth: owner.body.token });
  assert.equal(countsAfterDelete.body.categories.find((category) => category.id === afterId).quoteCount, 0);
});

test("shares publicly with strict privacy and imports safely across users", async () => {
  const ownerSignup = await api("/api/auth/signup", {
    method: "POST", body: { username: "share.owner", password: "secure owner password" },
  });
  const readerSignup = await api("/api/auth/signup", {
    method: "POST", body: { username: "share.reader", password: "secure reader password" },
  });
  const ownerToken = ownerSignup.body.token;
  const readerToken = readerSignup.body.token;
  const ownerSetup = await api("/api/categories/setup", {
    method: "POST", auth: ownerToken, body: { categories: ["Owner Original", "Owner Imported"] },
  });
  const readerSetup = await api("/api/categories/setup", {
    method: "POST", auth: readerToken, body: { categories: ["Reader Saved", "Reader Later"] },
  });
  const ownerOriginalId = ownerSetup.body.categories.find((category) => category.name === "Owner Original").id;
  const ownerImportedId = ownerSetup.body.categories.find((category) => category.name === "Owner Imported").id;
  const readerCategoryId = readerSetup.body.categories.find((category) => category.name === "Reader Saved").id;
  const readerLaterId = readerSetup.body.categories.find((category) => category.name === "Reader Later").id;

  const source = await api("/api/quotes", {
    method: "POST",
    auth: ownerToken,
    body: {
      text: "What is shared should remain intentionally small.",
      author: "Privacy Tester",
      date: "2026",
      source: "A private source",
      context: "Private context that must never cross the share boundary",
      categoryIds: [ownerOriginalId],
    },
  });
  assert.equal(source.status, 201);
  assert.equal((await api(`/api/quotes/${source.body.quote.id}/share`, { auth: ownerToken })).status, 404);

  const createdShare = await api(`/api/quotes/${source.body.quote.id}/share`, { method: "POST", auth: ownerToken });
  assert.equal(createdShare.status, 201);
  const { token: shareToken, path: sharePath } = createdShare.body.share;
  assert.match(shareToken, /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(sharePath, `/q/${shareToken}`);
  const stableShare = await api(`/api/quotes/${source.body.quote.id}/share`, { auth: ownerToken });
  assert.equal(stableShare.status, 200);
  assert.deepEqual(stableShare.body.share, createdShare.body.share);
  const repeatedShare = await api(`/api/quotes/${source.body.quote.id}/share`, { method: "POST", auth: ownerToken });
  assert.equal(repeatedShare.status, 200);
  assert.deepEqual(repeatedShare.body.share, createdShare.body.share);
  assert.equal((await api(`/api/quotes/${source.body.quote.id}/share`, { auth: readerToken })).status, 404);

  const storedShare = db.prepare("SELECT selector, token_hash AS tokenHash FROM quote_shares WHERE quote_id = ?").get(source.body.quote.id);
  assert.equal(storedShare.selector, shareToken.split(".")[0]);
  assert.equal(storedShare.tokenHash.length, 64);
  assert.notEqual(storedShare.tokenHash, shareToken);

  const publicQuote = await api(`/api/shares/${shareToken}`);
  assert.equal(publicQuote.status, 200);
  assert.equal(publicQuote.headers.get("cache-control"), "no-store");
  assert.deepEqual(publicQuote.body, {
    quote: { text: "What is shared should remain intentionally small.", author: "Privacy Tester" },
  });
  const authenticatedPublicQuote = await api(`/api/shares/${shareToken}`, { auth: readerToken });
  assert.deepEqual(authenticatedPublicQuote.body, publicQuote.body);

  const malformed = await api("/api/shares/not-a-token");
  const missing = await api(`/api/shares/${"A".repeat(32)}.${"B".repeat(43)}`);
  const replacement = shareToken.endsWith("A") ? "B" : "A";
  const tampered = await api(`/api/shares/${shareToken.slice(0, -1)}${replacement}`);
  assert.equal(malformed.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(tampered.status, 404);
  assert.deepEqual(malformed.body, missing.body);
  assert.equal((await api(`/api/shares/${"A".repeat(32)}.${"B".repeat(43)}/import`, {
    method: "POST", auth: readerToken, body: { categoryIds: [readerCategoryId] },
  })).status, 404);
  assert.deepEqual(tampered.body, missing.body);

  const unauthenticatedImport = await api(`/api/shares/${shareToken}/import`, {
    method: "POST", body: { categoryIds: [readerCategoryId] },
  });
  assert.equal(unauthenticatedImport.status, 401);

  const foreignCategory = await api(`/api/shares/${shareToken}/import`, {
    method: "POST", auth: readerToken, body: { categoryIds: [ownerOriginalId] },
  });
  assert.equal(foreignCategory.status, 400);

  const imported = await api(`/api/shares/${shareToken}/import`, {
    method: "POST", auth: readerToken, body: { categoryIds: [readerCategoryId] },
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.created, true);
  assert.equal(imported.body.quote.text, source.body.quote.text);
  assert.equal(imported.body.quote.author, source.body.quote.author);
  assert.equal(imported.body.quote.source, null);
  assert.equal(imported.body.quote.context, null);
  assert.equal(imported.body.quote.date, null);
  assert.deepEqual(imported.body.quote.categoryIds, [readerCategoryId]);

  const repeatedImport = await api(`/api/shares/${shareToken}/import`, {
    method: "POST", auth: readerToken, body: { categoryIds: [readerLaterId] },
  });
  assert.equal(repeatedImport.status, 200);
  assert.equal(repeatedImport.body.created, false);
  assert.equal(repeatedImport.body.quote.id, imported.body.quote.id);
  assert.deepEqual(new Set(repeatedImport.body.quote.categoryIds), new Set([readerCategoryId, readerLaterId]));
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM quote_share_imports WHERE share_quote_id = ? AND user_id = ?
  `).get(source.body.quote.id, readerSignup.body.user.id).count, 1);

  const ownerImport = await api(`/api/shares/${shareToken}/import`, {
    method: "POST", auth: ownerToken, body: { categoryIds: [ownerImportedId] },
  });
  const repeatedOwnerImport = await api(`/api/shares/${shareToken}/import`, {
    method: "POST", auth: ownerToken, body: { categoryIds: [ownerImportedId] },
  });
  assert.equal(ownerImport.status, 200);
  assert.equal(ownerImport.body.created, false);
  assert.equal(ownerImport.body.quote.id, source.body.quote.id);
  assert.equal(repeatedOwnerImport.body.quote.categoryIds.filter((id) => id === ownerImportedId).length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM quotes WHERE id = ?").get(source.body.quote.id).count, 1);

  assert.equal((await api(`/api/quotes/${source.body.quote.id}`, { method: "DELETE", auth: ownerToken })).status, 204);
  assert.equal((await api(`/api/shares/${shareToken}`)).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM quote_shares WHERE selector = ?").get(storedShare.selector).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM quote_share_imports WHERE share_quote_id = ?").get(source.body.quote.id).count, 0);
  assert.equal((await api(`/api/quotes/${imported.body.quote.id}`, { auth: readerToken })).status, 200);
});
