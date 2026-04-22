// ─────────────────────────────────────────────────────────────────────────────
//  ops-unlock
//  Validates the operator passphrase, provisions a dedicated operator account
//  on first use (active role + subscription), and returns:
//    - token           : signed token accepted by the other edge functions
//    - magicLinkAction : one-shot link that starts a real auth session
// ─────────────────────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { signAdminToken, constantTimeEqual } from "../_shared/admin-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPS_EMAIL = Deno.env.get("OPS_EMAIL") ?? "ops@ops.dishine.local";

// In-memory rate limit: 5 attempts per 10 minutes per IP.
const attempts = new Map<string, { count: number; reset: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function ensureOpsUser(): Promise<string> {
  const sb = admin();
  let userId: string | null = null;
  try {
    let page = 1;
    while (page < 5) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data) break;
      const found = data.users.find((u) => (u.email || "").toLowerCase() === OPS_EMAIL);
      if (found) { userId = found.id; break; }
      if (data.users.length < 200) break;
      page++;
    }
  } catch (_) { /* ignore */ }

  if (!userId) {
    const randomPwd = crypto.randomUUID() + crypto.randomUUID();
    const { data: created, error } = await sb.auth.admin.createUser({
      email: OPS_EMAIL,
      password: randomPwd,
      email_confirm: true,
      user_metadata: { display_name: "Operator", ops_account: true },
    });
    if (error || !created?.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = created.user.id;
  }

  // Ensure admin role.
  await sb.from("user_roles").upsert(
    { user_id: userId, role: "admin" },
    { onConflict: "user_id,role" },
  );

  // Ensure synthetic active subscription so all Pro features are available.
  const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  await sb.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: `local_ops_${userId}`,
      stripe_customer_id: `local_ops_${userId}`,
      product_id: "local_ops",
      price_id: "local_ops",
      status: "active",
      current_period_end: farFuture,
      environment: "live",
      cancel_at_period_end: false,
    },
    { onConflict: "stripe_subscription_id" },
  );

  return userId;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (!checkRate(ip)) {
      return new Response(JSON.stringify({ error: "Too many attempts" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { password } = await req.json();
    if (typeof password !== "string") {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expected = Deno.env.get("OPS_PASSPHRASE");
    if (!expected) throw new Error("OPS_PASSPHRASE not configured");

    if (!constantTimeEqual(password, expected)) {
      await new Promise((r) => setTimeout(r, 500));
      return new Response(JSON.stringify({ error: "Invalid passphrase" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await signAdminToken();

    let magicLinkAction: string | null = null;
    let opsEmail: string | null = null;
    try {
      await ensureOpsUser();
      const sb = admin();
      const defaultOrigin = Deno.env.get("SITE_URL") ?? "http://localhost:5173";
      const origin = req.headers.get("origin") || defaultOrigin;
      const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
        type: "magiclink",
        email: OPS_EMAIL,
        options: { redirectTo: `${origin}/account` },
      });
      if (!linkErr && linkData?.properties?.action_link) {
        magicLinkAction = linkData.properties.action_link;
        opsEmail = OPS_EMAIL;
      }
    } catch (e) {
      console.error("ops user provisioning failed:", e);
    }

    return new Response(
      JSON.stringify({ token, expiresInMs: 24 * 60 * 60 * 1000, magicLinkAction, opsEmail }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ops-unlock error:", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
