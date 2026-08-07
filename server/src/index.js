import "dotenv/config";
import { createApp } from "./app.js";
import { createDatabase } from "./db.js";

const configuredPort = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
if (!Number.isSafeInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
const port = configuredPort;
const db = createDatabase();
const server = createApp(db).listen(port, () => console.log(`QuoteBook API listening on http://localhost:${port}`));
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  const forceClose = setTimeout(() => server.closeAllConnections?.(), 10_000);
  forceClose.unref();
  server.close(() => {
    clearTimeout(forceClose);
    db.close();
  });
  server.closeIdleConnections?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
