# Quotebook

Quotebook is a private, searchable place to collect quotes and the stories behind them. It supports a guided first-run setup, single-quote research, progressive batch imports, editable AI suggestions, categories, full-library search, and native sharing/copying.

## Stack

- Vue 3, Vite, and Tailwind CSS v4
- Node.js 24 and Express 5
- SQLite via Node's built-in `node:sqlite` module
- Configurable OpenAI-compatible completion endpoint

Node 24 or newer is required. No native database dependency or separate database server is needed.

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set at least `COMPLETION_API_KEY`.

3. Start the production app (the production client is built automatically):

   ```bash
   npm start
   ```

4. Open `http://localhost:3000`.

For local development, run `npm run dev`; Vite serves the client with API requests proxied to the Node server.

## Docker

Build and start Quotebook with Docker Compose:

```bash
docker compose up --build -d
```

Then open `http://localhost:3000`. Compose reads `.env` when present and stores the SQLite database and generated share secret in the persistent `quotebook-data` volume.

The image builds the frontend from `client/package-lock.json` in a Linux build stage. This is intentional: using a Windows-generated root workspace install inside Linux can omit Rollup's platform-specific optional package and fail with `Cannot find module @rollup/rollup-linux-x64-gnu`.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `DATABASE_PATH` | SQLite database path | `server/data/quotebook.db` |
| `COMPLETION_URL` | Completion service base or full chat-completions URL | `https://dev.aqanta.com/` |
| `COMPLETION_API_KEY` | Completion service bearer token | none |
| `COMPLETION_MODEL` | Provider model name | `gpt-4.1-mini` |
| `COMPLETION_TIMEOUT_MS` | Completion request timeout | `30000` |
| `COMPLETION_JSON_MODE` | Request OpenAI-compatible JSON mode | `true` |
| `QUERY_REPAIR_ENABLED` | Generate one conservative typo-corrected search variant | `true` |
| `QUERY_REPAIR_TIMEOUT_MS` | Query-repair timeout (clamped to 1â€“10 seconds) | `5000` |
| `SEARCH_API_URL` | Optional JSON search-provider endpoint | DuckDuckGo HTML search |
| `SEARCH_API_KEY` | Optional search-provider bearer token | none |
| `WIKIQUOTE_ENABLED` | Include Wikiquote evidence in online lookups | `true` |
| `WIKIQUOTE_LANGUAGE` | Safe Wikiquote language subdomain | `en` |
| `WIKIQUOTE_TIMEOUT_MS` | Wikiquote request timeout (clamped to 1â€“15 seconds) | `8000` |
| `WIKIQUOTE_MAX_RESULTS` | Maximum Wikiquote results (clamped to 1â€“5) | `4` |
| `CLIENT_ORIGIN` | Optional allowed cross-origin development client | same-origin only |
| `TRUST_PROXY` | Express proxy trust setting; configure only behind a trusted proxy | unset |
| `SHARE_SECRET` | Optional 32+ character secret used to authenticate public share tokens | generated and persisted locally |
| `SHARE_SECRET_FILE` | Optional path for the generated share secret | `server/data/.share-secret.sqlite` |

When `COMPLETION_URL` is a bare origin such as the default, Quotebook appends `/v1/chat/completions`. A URL containing a path is used unchanged.

Do not commit `.env`; it is intentionally ignored. `.env.example` documents safe placeholders only.

## How quote processing works

- **Search online:** the server starts an immediate Wikiquote/general-web lookup while the AI conservatively repairs obvious spelling errors in the search wording. When a safe repair is found, one additional lookup runs against the corrected wording; evidence is merged and deduplicated before the final grounded parse.
- **Don't search:** only the pasted text is sent to the completion endpoint for parsing.
- **Batch import:** one completion first separates the pasted input. Each quote is then processed sequentially through the same single-quote pipeline. Completed quotes immediately expand into editable cards in a scrolling queue, so review and saving can happen while later lookups continue.

AI output is never saved automatically. The quote text, author, date, source, context, and suggested collections are presented for review and editing first. Suggestions are constrained to the user's existing collections when those are available. The parser conservatively corrects obvious capitalization and punctuation, removes one surrounding pair of quotation marks, and preserves the quote's wording.

After login, **All Quotes** is the default view. It includes the complete library, including quotes that have not been assigned to a collection. Selecting a collection filters the library to that collection.

## Public sharing

The Share action creates a stable, unguessable `/q/...` link. Logged-out visitors see only the quote text and author; collection names, source, date, context, ownership, and other library data are never returned by the public API. Signed-in visitors can choose one or more of their own collections and save the quote. Imports are idempotent, so retrying the same link adds newly chosen collections without creating duplicate quotes.

Share tokens are authenticated with a server secret, while only token hashes and non-secret selectors are stored in SQLite. When `SHARE_SECRET` is unset, Quotebook creates a persistent random secret at `SHARE_SECRET_FILE`. Back up that file together with the SQLite database—losing or rotating it invalidates existing public links.

Wikiquote and general web search fail independently. Evidence is sanitized and bounded before it reaches the completion service. If all online sources are unavailable, processing falls back to an editable parsed result and includes a research note rather than losing the quote.

Query repair is used only for finding evidence. Radical rewrites are rejected, and repaired wording is never stored merely because the repair step suggested it; the final quote remains governed by the supported evidence and editable review form.

## Security and data model

- Passwords are salted and derived with Node's `scrypt`; plaintext passwords are never stored.
- Login creates a random, revocable session token. Only its SHA-256 hash is stored in SQLite.
- All categories and quotes are scoped to the authenticated user.
- API input lengths, IDs, category ownership, and AI output shapes are validated.
- Login/signup requests are limited to 60 per 15 minutes per client IP; AI requests are limited to 30 per minute and return `Retry-After` when exceeded.
- The production server adds baseline security headers and serves the built SPA from the same origin.

The SQLite file and its WAL files are ignored by Git. Back up the configured database file to preserve user data.

## Commands

```bash
npm run dev       # API and Vite dev server
npm run build     # production client build
npm start         # builds the client, then serves API + client
npm test          # backend and AI integration tests
```

## API overview

Authenticated routes use `Authorization: Bearer <token>`.

- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/categories`, `POST /api/categories/setup`, `POST /api/categories`
- `GET /api/quotes?search=&category=`, `POST /api/quotes`
- `PATCH /api/quotes/:id`, `DELETE /api/quotes/:id`
- `POST /api/quotes/:id/share`
- `GET /api/shares/:token` (public), `POST /api/shares/:token/import` (authenticated)
- `POST /api/ai/parse`, `POST /api/ai/split`
- `GET /api/health`

Category and quote update/delete endpoints are implemented for API clients even where the initial UI only needs create and browse operations.
