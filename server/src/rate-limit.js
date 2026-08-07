import { HttpError } from "./errors.js";

// Small in-process limiter suitable for this single-process SQLite deployment.
// Deployments with multiple API processes should replace this with a shared store.
export function createRateLimiter({ max, windowMs, key = (request) => request.ip }) {
  const buckets = new Map();
  let requestsSinceCleanup = 0;

  return (request, response, next) => {
    const now = Date.now();
    const bucketKey = String(key(request) || "unknown");
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;

    response.set("RateLimit-Limit", String(max));
    response.set("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    response.set("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      response.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return next(new HttpError(429, "rate_limited", "Too many requests. Please try again later."));
    }

    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 100 || buckets.size > 10_000) {
      requestsSinceCleanup = 0;
      for (const [storedKey, storedBucket] of buckets) {
        if (storedBucket.resetAt <= now || buckets.size > 10_000) buckets.delete(storedKey);
      }
    }
    return next();
  };
}
