import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
// The .sqlite suffix intentionally matches the repository's secret/data ignore rules.
const defaultSecretFile = path.resolve(moduleDirectory, "..", "data", ".share-secret.sqlite");
let cachedSecret;

export function normalizeShareSecret(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length < 32) throw new Error("Share secret must contain at least 32 bytes.");
    return Buffer.from(value);
  }
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("SHARE_SECRET must contain at least 32 characters.");
  }
  return createHash("sha256").update(value).digest();
}

export function loadShareSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SHARE_SECRET) {
    cachedSecret = normalizeShareSecret(process.env.SHARE_SECRET);
    return cachedSecret;
  }

  const filename = process.env.SHARE_SECRET_FILE || defaultSecretFile;
  mkdirSync(path.dirname(filename), { recursive: true });
  try {
    const encoded = readFileSync(filename, "utf8").trim();
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.length !== 32) throw new Error("Stored share secret is invalid.");
    cachedSecret = decoded;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const generated = randomBytes(32);
    try {
      writeFileSync(filename, generated.toString("base64url"), { flag: "wx", mode: 0o600 });
      cachedSecret = generated;
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
      const decoded = Buffer.from(readFileSync(filename, "utf8").trim(), "base64url");
      if (decoded.length !== 32) throw new Error("Stored share secret is invalid.");
      cachedSecret = decoded;
    }
  }
  return cachedSecret;
}
