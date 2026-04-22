// ─────────────────────────────────────────────────────────────────────────────
//  rate-limit.ts
//  In-memory token-bucket-ish rate limiter keyed by an arbitrary string
//  (typically "<function>:<ipPrefix>").
//
//  ⚠ Caveat: this is best-effort, per-edge-instance memory. Two parallel edge
//  workers will each count independently. That is acceptable for a burst
//  limiter but NOT for a strict global cap — use the DB-backed quota in the
//  edge functions (usage_log) for strict caps.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = 60 * 1000;

interface Bucket {
  count: number;
  reset: number;
}

const buckets = new Map<string, Bucket>();

// Light-touch garbage collection so the map can't grow unbounded on noisy
// hosts. Runs only when the map gets large.
function maybeGc(now: number) {
  if (buckets.size < 10_000) return;
  for (const [k, v] of buckets) {
    if (v.reset < now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, perMinute: number): RateLimitResult {
  const now = Date.now();
  maybeGc(now);
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + WINDOW_MS });
    return { allowed: true, remaining: perMinute - 1, retryAfterSec: 0 };
  }
  if (b.count >= perMinute) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((b.reset - now) / 1000)),
    };
  }
  b.count++;
  return { allowed: true, remaining: perMinute - b.count, retryAfterSec: 0 };
}

// Test-only: clear the bucket map. Don't call in production.
export function _resetRateLimit() {
  buckets.clear();
}
