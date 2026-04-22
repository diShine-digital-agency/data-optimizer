/**
 * Client-side identifiers sent alongside each conversion request.
 * The server hashes these before storage — raw values are never persisted.
 */

const CLIENT_HASH_KEY = "dsh_client_hash";
const FP_SESSION_KEY = "dsh_fingerprint";

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Stable per-device identifier, persisted in localStorage. */
export function getClientHash(): string {
  const existing = localStorage.getItem(CLIENT_HASH_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  localStorage.setItem(CLIENT_HASH_KEY, hex);
  return hex;
}

/** Session-scoped identifier derived from device/browser characteristics. */
export async function getFingerprint(): Promise<string> {
  const cached = sessionStorage.getItem(FP_SESSION_KEY);
  if (cached) return cached;
  const signals = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    String(new Date().getTimezoneOffset()),
  ].join("|");
  const fp = (await sha256Hex(signals)).slice(0, 32);
  sessionStorage.setItem(FP_SESSION_KEY, fp);
  return fp;
}
