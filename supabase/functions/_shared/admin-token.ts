// ─────────────────────────────────────────────────────────────────────────────
//  admin-token.ts
//  HMAC-signed bearer token used by the operator-access flow.
//
//  Shape: `${payloadBase64Url}.${hmacBase64Url}`
//  Payload: { iat: number (ms), exp: number (ms), v: 1 }
//
//  Signed with HMAC_SECRET (must be >= 32 chars).
//  Default lifetime is 24 h; override via ADMIN_TOKEN_TTL_MS.
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

function getSecret(): string {
  const s = Deno.env.get("HMAC_SECRET");
  if (!s || s.length < 32) {
    throw new Error("HMAC_SECRET not set or too short (>=32 chars required)");
  }
  return s;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAdminToken(ttlMs?: number): Promise<string> {
  const now = Date.now();
  const lifetime = ttlMs ?? Number(Deno.env.get("ADMIN_TOKEN_TTL_MS") ?? 24 * 60 * 60 * 1000);
  const payload = { iat: now, exp: now + lifetime, v: 1 };
  const payloadB64 = b64url(JSON.stringify(payload));
  const key = await hmacKey();
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64)),
  );
  return `${payloadB64}.${b64url(sig)}`;
}

export async function verifyAdminToken(token: string | null | undefined): Promise<boolean> {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sigB64),
      enc.encode(payloadB64),
    );
    if (!ok) return false;
    const payload = JSON.parse(dec.decode(b64urlDecode(payloadB64)));
    if (typeof payload?.exp !== "number" || payload.exp < Date.now()) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// Constant-time string equality — prevents timing side-channels on passphrase checks.
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
