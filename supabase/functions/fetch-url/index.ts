// ─────────────────────────────────────────────────────────────────────────────
//  fetch-url
//  Supabase Edge Function (Deno runtime)
//
//  POST { url, format, fingerprint?, clientHash?, language? }
//      → { output, format, tier, source, finalUrl, model }
//
//  - Free tier: simple server-side fetch() of the URL
//  - Pro / admin: Firecrawl scrape (JS rendering + anti-bot), with basic-fetch
//    fallback when Firecrawl errors out or isn't configured.
//  - Same tier resolution, quota enforcement, and usage_log writes as convert-file.
// ─────────────────────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyAdminToken } from "../_shared/admin-token.ts";
import { verifyInternalToken } from "../_shared/api-key.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token, x-internal-token",
};

const FREE_DAILY_LIMIT = Number(Deno.env.get("QUOTA_FREE_PER_DAY") ?? 5);
const PRO_MONTHLY_LIMIT = Number(Deno.env.get("QUOTA_PRO_PER_MONTH") ?? 500);
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 MB raw HTML cap
const MAX_CHARS = 250_000;
const RATE_LIMIT_PER_MINUTE = Number(Deno.env.get("RATE_LIMIT_PER_MINUTE") ?? 30);
const ALLOWED_LANGS = new Set([
  "auto", "en", "fr", "it", "es", "de", "pt", "nl", "ja", "zh",
]);

const AI_GATEWAY_URL =
  Deno.env.get("AI_GATEWAY_URL") ??
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const AI_GATEWAY_API_KEY =
  Deno.env.get("AI_GATEWAY_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");

const MODEL_FREE = Deno.env.get("AI_MODEL_FREE") ?? "gemini-2.5-flash";
const MODEL_PRO = Deno.env.get("AI_MODEL_PRO") ?? "gemini-2.5-pro";

const USER_AGENT =
  Deno.env.get("FETCH_USER_AGENT") ??
  "Mozilla/5.0 (compatible; DishineConvert/1.0; +https://converter.dishine.it)";

function languageInstruction(lang?: string): string {
  if (!lang || lang === "auto") return "";
  const map: Record<string, string> = {
    en: "English", fr: "French", it: "Italian", es: "Spanish",
    de: "German", pt: "Portuguese", nl: "Dutch", ja: "Japanese", zh: "Chinese",
  };
  const name = map[lang];
  if (!name) return "";
  return `\n\nThe page is primarily written in ${name}. Preserve original-language content verbatim, do not translate.`;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hostnameOf(u: string): string {
  try { return new URL(u).hostname; } catch { return "url"; }
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch { return false; }
}

async function basicFetch(url: string): Promise<{ html: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,it;q=0.7",
      },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`upstream_${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) throw new Error("html_too_large");
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { html, finalUrl: r.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function firecrawlScrape(url: string): Promise<{ markdown?: string; html?: string; finalUrl: string }> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("firecrawl_not_configured");
  const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
      onlyMainContent: true,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`firecrawl_${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const payload = data?.data ?? data;
  return {
    markdown: payload?.markdown,
    html: payload?.html,
    finalUrl: payload?.metadata?.sourceURL || payload?.metadata?.url || url,
  };
}

const MARKDOWN_SYSTEM = `You are a precise HTML → Markdown converter.
- Extract the meaningful content of the page (main article, headings, lists, tables, code blocks, links).
- Drop nav, ads, cookie banners, footers, sidebars, repeated boilerplate.
- Use GitHub-Flavored Markdown. No HTML tags in the output.
- Preserve link text and link URLs as [text](url).
- Preserve image alt text as ![alt](url) only if the image is content-bearing.
- Output ONLY the Markdown, no preamble.`;

const JSON_SYSTEM = "You are a structured document extractor. Always call the emit_document tool.";

const JSON_TOOL = {
  type: "function",
  function: {
    name: "emit_document",
    description: "Emit the document as a structured JSON tree.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              level: { type: "integer", minimum: 1, maximum: 6 },
              content: { type: "string" },
              items: { type: "array", items: { type: "string" } },
              table: {
                type: "object",
                properties: {
                  headers: { type: "array", items: { type: "string" } },
                  rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                },
              },
            },
            required: ["heading", "level", "content"],
          },
        },
      },
      required: ["title", "sections"],
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, format, fingerprint, clientHash, language } = await req.json();

    if (!url || typeof url !== "string" || !isHttpUrl(url)) {
      return new Response(JSON.stringify({ error: "invalid_url", message: "Provide a valid http(s) URL." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (format !== "markdown" && format !== "json") {
      return new Response(JSON.stringify({ error: "invalid_format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (fingerprint && (typeof fingerprint !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(fingerprint))) {
      return new Response(JSON.stringify({ error: "Invalid fingerprint" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (clientHash && (typeof clientHash !== "string" || !/^[a-f0-9]{16,64}$/.test(clientHash))) {
      return new Response(JSON.stringify({ error: "Invalid clientHash" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (language !== undefined && language !== null && language !== "" && !ALLOWED_LANGS.has(language)) {
      return new Response(JSON.stringify({ error: "Invalid language" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tier resolution
    const adminToken = req.headers.get("x-admin-token");
    let isAdmin = await verifyAdminToken(adminToken);

    const internalToken = req.headers.get("x-internal-token");
    const internalClaims = internalToken ? await verifyInternalToken(internalToken) : null;

    let userId: string | null = null;
    let isPro = false;
    if (internalClaims) {
      userId = internalClaims.userId;
      isPro = true;
    } else {
      const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader);
        if (user) {
          userId = user.id;
          const [{ data: live }, { data: sandbox }, { data: adminRole }] = await Promise.all([
            supabase.rpc("has_active_subscription", { user_uuid: user.id, check_env: "live" }),
            supabase.rpc("has_active_subscription", { user_uuid: user.id, check_env: "sandbox" }),
            supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
          ]);
          isPro = !!live || !!sandbox;
          isAdmin = isAdmin || !!adminRole;
        }
      }
    }

    if (userId) {
      const { data: isBlocked } = await supabase.rpc("is_user_blocked", { _user_id: userId });
      if (isBlocked) {
        return new Response(JSON.stringify({ error: "account_blocked", message: "This account has been blocked." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const rawIp = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const ipPrefix = (() => {
      if (rawIp === "unknown") return rawIp;
      if (rawIp.includes(":")) return rawIp.split(":").slice(0, 3).join(":") + "::";
      const parts = rawIp.split(".");
      return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : rawIp;
    })();
    const ipHash = await sha256(ipPrefix + (Deno.env.get("HMAC_SECRET") || ""));

    if (!isAdmin) {
      const rl = checkRateLimit(`fetchurl:${ipPrefix}`, RATE_LIMIT_PER_MINUTE);
      if (!rl.allowed) {
        return new Response(JSON.stringify({
          error: "rate_limited",
          message: `Too many requests. Try again in ${rl.retryAfterSec}s.`,
        }), {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(rl.retryAfterSec),
          },
        });
      }
    }

    if (isPro && !isAdmin && userId) {
      const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { count: monthCount } = await supabase
        .from("usage_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", monthStart);
      if ((monthCount || 0) >= PRO_MONTHLY_LIMIT) {
        return new Response(JSON.stringify({
          error: "monthly_limit_reached",
          message: `Pro plan: ${PRO_MONTHLY_LIMIT} conversions per month reached. Resets on a rolling 30-day window.`,
          limit: PRO_MONTHLY_LIMIT,
          used: monthCount,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!isAdmin && !isPro) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let q = supabase.from("usage_log").select("id", { count: "exact", head: true }).gte("created_at", since);
      if (userId) {
        q = q.eq("user_id", userId);
      } else {
        const conds: string[] = [`ip_hash.eq.${ipHash}`];
        if (fingerprint) conds.push(`fingerprint.eq.${fingerprint}`);
        if (clientHash) conds.push(`client_hash.eq.${clientHash}`);
        q = q.or(conds.join(","));
      }
      const { count, error } = await q;
      if (error) {
        return new Response(JSON.stringify({ error: "Quota check failed" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if ((count || 0) >= FREE_DAILY_LIMIT) {
        return new Response(JSON.stringify({
          error: "quota_exceeded",
          message: `Free tier: ${FREE_DAILY_LIMIT} conversions per day. Upgrade to Pro for unlimited.`,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Fetch the page: Pro → Firecrawl (if configured), else basic fetch.
    let pageMarkdown = "";
    let pageHtml = "";
    let finalUrl = url;
    let usedSource: "firecrawl" | "basic" = "basic";

    if (isPro || isAdmin) {
      try {
        const fc = await firecrawlScrape(url);
        finalUrl = fc.finalUrl;
        pageMarkdown = fc.markdown || "";
        pageHtml = fc.html || "";
        usedSource = "firecrawl";
      } catch (err) {
        console.error("firecrawl fallback to basic:", err);
        const r = await basicFetch(url);
        pageHtml = r.html;
        finalUrl = r.finalUrl;
      }
    } else {
      const r = await basicFetch(url);
      pageHtml = r.html;
      finalUrl = r.finalUrl;
    }

    if (!pageMarkdown && !pageHtml.trim()) {
      return new Response(JSON.stringify({
        error: "extraction_failed",
        message: `Could not fetch any readable content from ${hostnameOf(url)}.`,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let aiInput = pageMarkdown || pageHtml;
    let truncated = false;
    if (aiInput.length > MAX_CHARS) {
      aiInput = aiInput.slice(0, MAX_CHARS);
      truncated = true;
    }

    if (!AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY (or GEMINI_API_KEY) not configured");

    const langHint = languageInstruction(language);
    const systemPrompt = (format === "markdown" ? MARKDOWN_SYSTEM : JSON_SYSTEM) + langHint;
    const conversionHint = pageMarkdown
      ? "The input is already clean Markdown extracted from a web page. Polish it into the cleanest possible GitHub-Flavored Markdown version of the article."
      : "The input is raw HTML markup. Convert it into clean GitHub-Flavored Markdown. Strip nav, ads, cookie banners, sidebars, footers. Output MUST contain no HTML tags.";

    const userText = format === "markdown"
      ? `Source URL: ${finalUrl}${truncated ? "\n(Note: input was truncated to fit context.)" : ""}\n\n${conversionHint}\n\nInput:\n\n${aiInput}`
      : `Source URL: ${finalUrl}${truncated ? "\n(Note: input was truncated to fit context.)" : ""}\n\nConvert the following web page content into structured JSON via emit_document:\n\n${aiInput}`;

    const modelUsed = (isPro || isAdmin) ? MODEL_PRO : MODEL_FREE;
    const body: any = {
      model: modelUsed,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: [{ type: "text", text: userText }] },
      ],
    };
    if (format === "json") {
      body.tools = [JSON_TOOL];
      body.tool_choice = { type: "function", function: { name: "emit_document" } };
    }

    const aiResp = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Contact support." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI error:", aiResp.status, t);
      return new Response(JSON.stringify({
        error: "ai_failed",
        message: `Conversion failed for ${hostnameOf(url)}.`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiResp.json();
    let output: string;
    if (format === "markdown") {
      output = aiJson.choices?.[0]?.message?.content || "";
      if (!output.trim()) {
        return new Response(JSON.stringify({
          error: "empty_output",
          message: "The AI returned an empty result.",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      const args = toolCall?.function?.arguments;
      if (!args) {
        return new Response(JSON.stringify({
          error: "no_structured_output",
          message: "The AI didn't return structured JSON. Try Markdown format instead.",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const parsed = typeof args === "string" ? JSON.parse(args) : args;
      output = JSON.stringify(parsed, null, 2);
    }

    await supabase.from("usage_log").insert({
      user_id: userId,
      fingerprint: fingerprint || null,
      ip_hash: ipHash,
      client_hash: clientHash || null,
      filename: hostnameOf(finalUrl),
      format,
      file_size: aiInput.length,
      success: true,
    });

    return new Response(JSON.stringify({
      output,
      format,
      tier: isAdmin ? "admin" : isPro ? "pro" : "free",
      source: usedSource,
      finalUrl,
      model: modelUsed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("fetch-url error:", e);
    return new Response(JSON.stringify({ error: "fetch_failed", message: "Unable to fetch the URL. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
