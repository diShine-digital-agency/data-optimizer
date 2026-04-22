// ─────────────────────────────────────────────────────────────────────────────
//  api-key.ts
//  Internal-token verification for the `/v1/*` API wrapper functions.
//
//  Flow:
//    1. A user creates an API key in the dashboard.
//      - The FULL key (prefix + secret) is shown ONCE to the user.
//      - The server stores only sha256(secret) in `api_keys.key_hash`.
//    2. External clients send:  Authorization: Bearer dsh_<prefix>_<secret>
//       The wrapper function verifies it here, then forwards to the internal
//       edge function with `x-internal-token: <signed short-lived JWT-ish token>`
//       containing `userId`.
//    3. This helper validates that short-lived internal token and returns
//       `{ userId }` on success.
//
//  Key format convention (suggested — change if you prefer):
//      dsh_<8-char-prefix>_<32-char-secret>
//
//  The long-lived API keys themselves are NEVER sent to convert-file /
//  fetch-url directly — only the internal short-lived token is.
// ─────────────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array | string): string {
  const src = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < src.length; i++) bin += String.fromCharCode(src[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function internalKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("INTERNAL_TOKEN_SECRET") ?? Deno.env.get("HMAC_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error(
      "INTERNAL_TOKEN_SECRET (or HMAC_SECRET fallback) not set or too short",
    );
  }
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface InternalClaims {
  userId: string;
  keyId?: string;
  iat: number;
  exp: number;
}

// Sign a short-lived (5 min default) internal token that wraps an API-key
// authenticated request. Called by the public v1 wrapper edge functions.
export async function signInternalToken(
  userId: string,
  keyId?: string,
  ttlMs: number = 5 * 60 * 1000,
): Promise<string> {
  const now = Date.now();
  const payload: InternalClaims = { userId, keyId, iat: now, exp: now + ttlMs };
  const payloadB64 = b64url(JSON.stringify(payload));
  const key = await internalKey();
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64)),
  );
  return `${payloadB64}.${b64url(sig)}`;
}

export async function verifyInternalToken(
  token: string | null | undefined,
): Promise<InternalClaims | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await internalKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sigB64),
      enc.encode(payloadB64),
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(payloadB64))) as InternalClaims;
    if (typeof payload?.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload?.userId !== "string" || payload.userId.length < 8) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// Hash the secret portion of a public API key for DB storage & lookup.
export async function hashApiKeySecret(secret: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Parse the public "dsh_<prefix>_<secret>" format.
export function parsePublicApiKey(raw: string): { prefix: string; secret: string } | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^dsh_([a-zA-Z0-9]{4,16})_([a-zA-Z0-9]{24,64})$/);
  if (!m) return null;
  return { prefix: m[1], secret: m[2] };
}
