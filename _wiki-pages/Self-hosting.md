# Self-hosting

Full walkthrough: [`DEPLOY.md`](https://github.com/dishine/dishine-convert/blob/main/DEPLOY.md). This page is the condensed version plus the questions people ask after reading it.

## Cost of a small instance

On the order of **$0 – $25/month** for a hobby-size deployment:

- **Supabase** free tier covers a small Postgres + edge-function invocations within the free plan limits.
- **Google Gemini** has a generous free tier on `gemini-2.5-flash` and pay-per-call on `gemini-2.5-pro`.
- **Firecrawl** is pay-per-scrape; only needed for Pro-tier JS-rendered URL fetches.
- **Stripe** is only needed if you want paid subscriptions.

## Do I need Stripe?

Only if you want the Pro tier. Without Stripe the app still works — all users default to the Free tier unless you provision them otherwise via the operator tools (see [DEPLOY.md](https://github.com/dishine/dishine-convert/blob/main/DEPLOY.md)).

## Do I need Firecrawl?

No. Without it, URL fetches go through plain `fetch()` — fast, but no JavaScript rendering. SPA pages or bot-protected pages will return incomplete results.

## Can I run it without Gemini?

Yes — see [FAQ → Can I swap Gemini](FAQ#can-i-swap-gemini-for-another-model). Any OpenAI-compatible chat-completions endpoint works.

## Operator access

Operator setup is documented in [DEPLOY.md](https://github.com/dishine/dishine-convert/blob/main/DEPLOY.md). Configure the required environment variables before deploying the edge functions.

## What do I back up?

Just Postgres. The schema in `supabase/migrations/` is reproducible, but the `subscriptions`, `user_roles`, `api_keys`, and `usage_log` tables hold your live state. Supabase's built-in point-in-time recovery covers this automatically on paid plans.

## How do I upgrade?

```bash
git pull
supabase db push           # applies new migrations
supabase functions deploy convert-file fetch-url
pnpm install && pnpm build # rebuild the SPA
```

Breaking changes always bump the major version and are documented in [`CHANGELOG.md`](https://github.com/dishine/dishine-convert/blob/main/CHANGELOG.md).
