import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router } from "express";
import { assert, HttpError } from "./errors.js";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;
const MAX_SESSIONS_PER_USER = 20;
const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = "1c9cacb8b9630c3903ddb1ee70b66403c89eb73cf6065c4b57f676c6f55749dfb85586c1e4246ecfe47629749ee420660a3d47798beec81d56342d1d1b7e02f2";

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return { salt, hash: derived.toString("hex") };
}

async function passwordMatches(password, salt, expectedHex) {
  const { hash } = await hashPassword(password, salt);
  const actual = Buffer.from(hash, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    onboardingComplete: Boolean(user.onboarding_completed),
    createdAt: user.created_at,
  };
}

function createSession(db, userId) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(userId, tokenHash(token), expiresAt);
  db.prepare(`
    DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
      SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    )
  `).run(userId, userId, MAX_SESSIONS_PER_USER);
  return token;
}

function validateCredentials(body) {
  const username = typeof body?.username === "string" ? body.username.trim().normalize("NFKC") : "";
  const password = typeof body?.password === "string" ? body.password : "";
  assert(/^[A-Za-z0-9_.-]{3,32}$/.test(username), 400, "invalid_username", "Username must be 3–32 letters, numbers, dots, dashes, or underscores.");
  assert(password.length >= 8 && password.length <= 256, 400, "invalid_password", "Password must be between 8 and 256 characters.");
  return { username, password };
}

export function createRequireAuth(db) {
  return (request, _response, next) => {
    const match = request.get("authorization")?.match(/^Bearer\s+([A-Za-z0-9_-]{43})$/i);
    if (!match) return next(new HttpError(401, "authentication_required", "Sign in to continue."));

    const session = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash(match[1]), new Date().toISOString());
    if (!session) return next(new HttpError(401, "invalid_session", "Your session is invalid or has expired."));

    request.user = session;
    request.sessionTokenHash = tokenHash(match[1]);
    next();
  };
}

export function createAuthRouter(db, requireAuth, rateLimit = (_request, _response, next) => next()) {
  const router = Router();

  router.post("/signup", rateLimit, async (request, response) => {
    const { username, password } = validateCredentials(request.body);
    const existing = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    assert(!existing, 409, "username_taken", "That username is already taken.");

    const passwordData = await hashPassword(password);
    const result = db.prepare("INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)")
      .run(username, passwordData.hash, passwordData.salt);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
    const token = createSession(db, user.id);
    response.status(201).json({ token, user: publicUser(user), needsSetup: true });
  });

  router.post("/login", rateLimit, async (request, response) => {
    const { username, password } = validateCredentials(request.body);
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    // Always perform scrypt so valid-looking unknown usernames do not have a fast timing path.
    const passwordValid = await passwordMatches(password, user?.password_salt || DUMMY_SALT, user?.password_hash || DUMMY_HASH);
    const valid = Boolean(user) && passwordValid;
    assert(valid, 401, "invalid_credentials", "Invalid username or password.");
    const token = createSession(db, user.id);
    response.json({ token, user: publicUser(user), needsSetup: !Boolean(user.onboarding_completed) });
  });

  router.get("/me", requireAuth, (request, response) => {
    response.json({ user: publicUser(request.user), needsSetup: !Boolean(request.user.onboarding_completed) });
  });

  router.post("/logout", requireAuth, (request, response) => {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(request.sessionTokenHash);
    response.status(204).end();
  });

  return router;
}
