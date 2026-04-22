# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2025-04-21

### Added
- Three Supabase edge functions: `convert-file`, `fetch-url`, and an operator management endpoint.
- Server-side daily quota for the Free tier; rolling 30-day quota for Pro.
- Per-IP burst rate limiter (30 req/min default, configurable via `RATE_LIMIT_PER_MINUTE`).
- OpenAI-compatible AI gateway abstraction — defaults to Google Gemini, swappable via `AI_GATEWAY_URL` / `AI_GATEWAY_API_KEY`.
- Supabase migration `0001_initial_schema.sql` with RLS policies, stored procedures, and full schema.
- OpenAPI 3.1 spec at `docs/openapi.yaml`.
- Trilingual UI — English, Italian, French — via i18next.
- React 18 + Vite + TypeScript front-end with Tailwind CSS and shadcn/ui.
- Stripe Checkout integration for Pro subscriptions (optional, self-hosters can omit).
- Firecrawl integration for JS-rendered URL fetches on Pro (optional).
