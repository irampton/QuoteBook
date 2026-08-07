import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createRequireAuth, createAuthRouter } from "./auth.js";
import { createCategoriesRouter } from "./categories.js";
import { createQuotesRouter } from "./quotes.js";
import { errorHandler, HttpError } from "./errors.js";
import { createRateLimiter } from "./rate-limit.js";

const require = createRequire(import.meta.url);
const { createAiRouter } = require("../ai/index.js");
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(moduleDirectory, "..", "..", "client", "dist");

export function createApp(db, { aiService, rateLimits = {} } = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);
  app.use((request, response, next) => {
    response.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    });
    if (process.env.CLIENT_ORIGIN && request.get("origin") === process.env.CLIENT_ORIGIN) {
      response.set({
        "Access-Control-Allow-Origin": process.env.CLIENT_ORIGIN,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        Vary: "Origin",
      });
    }
    if (request.method === "OPTIONS") return response.status(204).end();
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const requireAuth = createRequireAuth(db);
  const authRateLimit = createRateLimiter({ max: rateLimits.authMax ?? 60, windowMs: rateLimits.authWindowMs ?? 15 * 60_000 });
  const aiRateLimit = createRateLimiter({ max: rateLimits.aiMax ?? 30, windowMs: rateLimits.aiWindowMs ?? 60_000 });
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.use("/api/auth", createAuthRouter(db, requireAuth, authRateLimit));
  app.use("/api/categories", requireAuth, createCategoriesRouter(db));
  app.use("/api/quotes", requireAuth, createQuotesRouter(db));
  app.use("/api/ai", requireAuth, aiRateLimit, createAiRouter(aiService ? { service: aiService } : {}));
  app.use("/api", (_request, _response, next) => next(new HttpError(404, "not_found", "Route not found.")));

  // In production the API also serves the built Vue SPA. Vite's dev proxy handles this in development.
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, {
      setHeaders(response, filename) {
        if (path.basename(filename) === "index.html") response.set("Cache-Control", "no-cache");
        else if (filename.includes(`${path.sep}assets${path.sep}`)) response.set("Cache-Control", "public, max-age=31536000, immutable");
      },
    }));
    app.use((request, response, next) => {
      if (request.method === "GET" && !path.extname(request.path) && request.accepts("html")) {
        response.set("Cache-Control", "no-cache");
        return response.sendFile(path.join(clientDist, "index.html"));
      }
      next();
    });
  }
  app.use((_request, _response, next) => next(new HttpError(404, "not_found", "Route not found.")));
  app.use(errorHandler);
  return app;
}
