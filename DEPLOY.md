# Deployment guide

This walks you from a fresh clone to a live Dishine Convert deployment on your own infrastructure.

**Stack:** React SPA (any static host) + Supabase (auth, Postgres, edge functions) + an OpenAI-compatible AI gateway.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & install](#2-clone--install)
3. [Supabase project](#3-supabase-project)
4. [Database schema](#4-database-schema)
5. [Edge-function secrets](#5-edge-function-secrets)
6. [Deploy the edge functions](#6-deploy-the-edge-functions)
7. [Front-end build & host](#7-front-end-build--host)
8. [Optional: Stripe](#8-optional-stripe)
9. [Optional: Firecrawl](#9-optional-firecrawl)
10. [Optional: custom AI gateway](#10-optional-custom-ai-gateway)
11. [Verify the deployment](#11-verify-the-deployment)
12. [Ongoing ops](#12-ongoing-ops)

---

## 1. Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (or npm/yarn)
- **Supabase CLI** ≥ 1.150 → `brew install supabase/tap/supabase`
- A **Google AI Studio** API key (or any OpenAI-compatible gateway key)
- (Optional) **Stripe** account for paid tiers
- (Optional) **Firecrawl** API key for JS-heavy URL scraping

---

## 2. Clone & install

```bash
git clone https://github.com/<you>/dishine-convert.git
cd dishine-convert
cp .env.example .env                # front-end vars
pnpm install
```

Do **not** commit `.env` — it's gitignored.

---

## 3. Supabase project

Create a new project at [supabase.com](https://supabase.com) (or run `supabase start` locally for dev). Then:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

In **Project Settings → API**, grab:
- `Project URL`  → `VITE_SUPABASE_URL`
- `anon public`  → `VITE_SUPABASE_ANON_KEY`
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (edge-function secret — **never** expose this in the browser)

---

## 4. Database schema

Apply the initial migration:

```bash
supabase db push          # hosted project
# OR
supabase db reset         # local dev — wipes & reapplies everything
```

This creates the `user_roles`, `subscriptions`, `usage_log`, and `api_keys` tables, stored procedures, and RLS policies.

See [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql) for the full schema.

---

## 5. Edge-function secrets

In **Supabase Dashboard → Project Settings → Edge Functions → Secrets**, set:

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes to `usage_log` (bypasses RLS by design). |
| `AI_GATEWAY_API_KEY` **or** `GEMINI_API_KEY` | The chat-completions backend key. |
| `AI_GATEWAY_URL` *(optional)* | Override the default Gemini endpoint. |
| `AI_MODEL_FREE` *(optional)* | Defaults to `gemini-2.5-flash`. |
| `AI_MODEL_PRO` *(optional)* | Defaults to `gemini-2.5-pro`. |
| `HMAC_SECRET` | ≥ 32 random chars. Used for request signing and hashing. Generate: `openssl rand -hex 48`. |
| `OPS_PASSPHRASE` | Passphrase for the operator access endpoint. Use 20+ random chars. |
| `OPS_EMAIL` *(optional)* | Operator email address. |
| `INTERNAL_TOKEN_SECRET` *(optional)* | Signs internal service tokens. Falls back to `HMAC_SECRET`. |
| `FIRECRAWL_API_KEY` *(optional)* | Enables Firecrawl for Pro URL fetches. |
| `FETCH_USER_AGENT` *(optional)* | Override the basic fetcher's user-agent string. |
| `QUOTA_FREE_PER_DAY` *(optional)* | Daily conversion limit for the Free tier. Default: `5`. |
| `QUOTA_PRO_PER_MONTH` *(optional)* | Monthly conversion limit for Pro. Default: `500`. |
| `RATE_LIMIT_PER_MINUTE` *(optional)* | Per-IP burst limit. Default: `30`. |
| `SITE_URL` *(optional)* | Base URL for auth redirect links. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_*` *(optional)* | Required for paid tiers only. |

---

## 6. Deploy the edge functions

```bash
supabase functions deploy convert-file
supabase functions deploy fetch-url
```

These functions accept anonymous requests (no JWT required) because they perform their own tier resolution. The `[functions.*]` blocks in `supabase/config.toml` reflect this.

Smoke-test:

```bash
curl -sS -X POST "https://<project-ref>.functions.supabase.co/convert-file" \
  -H "Content-Type: application/json" \
  -d '{"filename":"hi.txt","contentBase64":"aGVsbG8=","format":"markdown"}'
```

You should get back a Markdown response with `"tier":"free"`.

---

## 7. Front-end build & host

```bash
pnpm build          # outputs to dist/
```

Deploy `dist/` to any static host. Three common setups:

### Vercel

```bash
vercel --prod
```

Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`, and `VITE_STRIPE_PUBLISHABLE_KEY` in **Project → Settings → Environment Variables**.

### Netlify

```bash
netlify deploy --prod --dir=dist
```

Same env vars in the Netlify UI.

### Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name dishine-convert
```

Use `wrangler secret put` (or the dashboard) for env vars.

Don't forget the SPA fallback for client-side routing. All three platforms auto-detect Vite builds, but if you're on Nginx:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

---

## 8. Optional: Stripe

Only needed if you want paid tiers.

1. Create **Product → Recurring Price** for `pro-monthly` and `pro-yearly` in the Stripe dashboard.
2. Copy the price IDs into `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_YEARLY`.
3. Add a webhook endpoint — events to subscribe to: `customer.subscription.*`, `checkout.session.completed`, `invoice.paid`.
4. Copy the webhook secret into `STRIPE_WEBHOOK_SECRET`.

The `subscriptions` table has an `environment` column (`live` / `sandbox`) for safe testing against sandbox Stripe without touching live data.

---

## 9. Optional: Firecrawl

Firecrawl renders JavaScript-heavy pages. Without it, URL fetches fall back to plain `fetch()` — fine for static content.

1. Sign up at [firecrawl.dev](https://firecrawl.dev).
2. Copy your API key into the `FIRECRAWL_API_KEY` edge-function secret.
3. Pro users automatically use Firecrawl, with transparent fallback to plain fetch on error.

---

## 10. Optional: custom AI gateway

The edge functions call an OpenAI-compatible `/chat/completions` endpoint. Swap backends with two secrets:

```bash
AI_GATEWAY_URL="https://your-provider.example.com/v1/chat/completions"
AI_GATEWAY_API_KEY="sk-…"
AI_MODEL_FREE="your-fast-model"
AI_MODEL_PRO="your-smart-model"
```

Any provider that accepts `{ model, messages, tools?, tool_choice? }` in the OpenAI chat-completions shape and returns `choices[0].message.content` (Markdown) or `choices[0].message.tool_calls[0].function.arguments` (JSON) will work.

---

## 11. Verify the deployment

- [ ] Open the front-end URL — sign up with a test email and confirm the magic link lands.
- [ ] Drop a small PDF, pick **Markdown**, and confirm you get clean output.
- [ ] Run the conversion 5 times in quick succession — the 6th should return `quota_exceeded`.
- [ ] In Supabase SQL editor: `select count(*) from usage_log;` should be non-zero.
- [ ] Open **Account → API keys**, create a key, and hit `/v1/convert` directly with curl.

---

## 12. Ongoing ops

- **Logs**: Supabase Dashboard → Edge Functions → `<function>` → Logs.
- **DB backups**: Supabase auto-backs-up Pro projects daily. Schedule a `pg_dump` for self-managed Postgres.
- **Rotate secrets**: regenerate `HMAC_SECRET` periodically and update it in edge-function secrets.
- **Blocking users**: set `blocked = true` in `user_roles` for a given `user_id` — the function checks this on every request.
- **Scaling**: the functions are stateless; Supabase auto-scales them. The in-memory rate-limiter is per-instance — for strict global caps, query the `usage_log` counts instead.
