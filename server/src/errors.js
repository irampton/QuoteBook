export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function assert(condition, status, code, message) {
  if (!condition) throw new HttpError(status, code, message);
}

export function errorHandler(error, _request, response, _next) {
  if (error instanceof HttpError) {
    return response.status(error.status).json({ error: { code: error.code, message: error.message } });
  }

  // node:sqlite currently reports extended SQLite result codes through `errcode`.
  if (error?.code === "ERR_SQLITE_CONSTRAINT_UNIQUE" || error?.errcode === 2067) {
    return response.status(409).json({ error: { code: "conflict", message: "That value already exists." } });
  }

  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({ error: { code: "invalid_json", message: "Request body must be valid JSON." } });
  }

  if (error?.type === "entity.too.large") {
    return response.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large." } });
  }

  console.error(error);
  return response.status(500).json({ error: { code: "internal_error", message: "An unexpected error occurred." } });
}
