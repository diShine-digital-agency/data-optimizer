# Technical architecture

How the pieces fit together, why they were chosen, and where to look when something breaks.

---

## Table of contents

- [System overview](#system-overview)
- [Request flow](#request-flow)
- [Tier resolution](#tier-resolution)
- [Quota model](#quota-model)
- [Conversion pipeline](#conversion-pipeline)
- [Model routing](#model-routing)
- [Database schema](#database-schema)
- [Anti-abuse design](#anti-abuse-design)
- [Front-end architecture](#front-end-architecture)
- [Observability](#observability)
- [Known limitations](#known-limitations)

---

## System overview

```
┌──────────────────┐      ┌─────────────────────────┐      ┌─────────────────────┐
│  React SPA       │──────▶  Supabase Edge Functions │──────▶  AI gateway         │
│  (static host)   │      │  (Deno runtime)          │      │  (OpenAI-compat)    │
│                  │      │                          │      │  e.g. Gemini        │
│  - drag-drop UI  │      │  - convert-file          │      └─────────────────────┘
│  - URL mode      │      │  - fetch-url             │
│  - i18n EN/IT/FR │      │  - management endpoint   │      ┌─────────────────────┐
│  - shadcn/ui     │      │                          │──────▶  Firecrawl          │
└────────┬─────────┘      │  reads/writes:           │      │  (Pro URL fetches)  │
         │                │  - usage_log             │      └─────────────────────┘
         │                │  - user_roles            │
         ▼                │  - subscriptions         │      ┌─────────────────────┐
┌──────────────────┐      │  - api_keys              │──────▶  Stripe             │
│  Supabase Auth   │◀─────┘                          │      │  (paid tiers)       │
│  + Postgres      │      └─────────────────────────┘      └─────────────────────┘
└──────────────────┘
```

---

## Request flow

A typical file conversion:

1. **Browser** reads the file, base64-encodes it, and sends `POST /convert-file` with the format preference, locale hint, and session identifiers.
2. **Edge function** parses the request body, validates inputs, and detects the file type from MIME type and extension.
3. **Tier resolution** — API-key bearer token → authenticated user subscription → anonymous. First match wins.
4. **Block check** — if the resolved user is flagged as blocked, return `403`.
5. **File cap** — 100 MB for Pro, 20 MB for Free.
6. **Rate limit** — in-memory per-IP bucket, 30 req/min (configurable via `RATE_LIMIT_PER_MINUTE`).
7. **Quota** — Pro rolling-30-day count or Free daily count, both checked server-side.
8. **Extraction** — text/DOCX/PPTX/XLSX decoded locally; PDF/image sent to the vision model as a data URL.
9. **AI call** — single OpenAI-style chat completion. Tool-calling is used for `format = "json"`.
10. **Log** — `usage_log` insert (success=true), with coarse country and a short UA label.
11. **Respond** — `{ output, format, tier, model }` (+ `source`, `finalUrl` for `fetch-url`).

---

## Tier resolution

Each request is classified as one of three tiers:

| Tier | How it is detected |
|---|---|
| `pro` | Valid API-key bearer token **or** active subscription on the authenticated user. |
| `free` | Authenticated user with no active subscription, or anonymous request. |

Pro users get the larger file cap, the `gemini-2.5-pro` model on larger inputs, and the Firecrawl path on URL fetches.

---

## Quota model

### Free

A sliding 24-hour conversion count, checked server-side on every request. The count is tied to the authenticated user when signed in, or to the request origin when anonymous.

### Pro (active subscription)

Count over the rolling last 30 days per authenticated user, capped at `PRO_MONTHLY_LIMIT` (default 500).

---

## Conversion pipeline

### Text-like (DOCX, PPTX, XLSX, TXT, CSV, HTML, JSON, YAML, MD…)

No vision call. The edge function unzips OOXML archives **in Deno** and walks the XML itself:

- **DOCX** — `word/document.xml` → strip tags, preserve paragraph breaks.
- **PPTX** — per-slide: `ppt/slides/slideN.xml` (text, inspected signals for images/tables/charts/shapes/bullets) + `ppt/notesSlides/notesSlideN.xml` (speaker notes). The model gets a structured "## Slide N — Visible text / Speaker notes / Structural signals" bundle and emits a slide-by-slide analyst output (Purpose / Structure / Content / UX notes / Notes) + a deck overview.
- **XLSX** — build a sparse grid from `xl/worksheets/sheetN.xml` using shared-strings + sheet-name lookups. Collapse merged cells. Split rows into blocks separated by empty rows. Detect "title blocks" (single row with one repeated value → H3). Emit GFM tables per block.
- **Text/CSV/HTML/JSON/YAML** — UTF-8 decode with latin-1 fallback; the prompt sends a format-specific hint (`The input is delimited tabular data…`, `The input is raw HTML markup…`, etc.).

Extracted text is hard-capped at **250 000 chars** (~80 k tokens) to stay inside the model's budget; inputs above that are truncated with a note.

### PDF / image

Sent as a single `image_url` data-URL to the vision model. No pre-processing — the model OCRs, detects tables, preserves headings, etc.

The `MARKDOWN_SYSTEM` / `PDF_MARKDOWN_SYSTEM` / `IMAGE_MARKDOWN_SYSTEM` / `DECK_MARKDOWN_SYSTEM` prompts enforce:
- **Fidelity over summarization** — never paraphrase, never translate, mark unreadable text as `_[unclear]_`.
- **GFM-only Markdown output** — no wrapping code fences, no preamble.
- **Structural awareness** — headings, lists, tables, code blocks; footnotes for PDFs; tags for images.

### JSON output

When `format = "json"`, the request adds an `emit_document` tool with a JSON-schema describing title/metadata/sections (heading, level, content, lists, tables). `tool_choice` forces the call. We parse the tool-call arguments, pretty-print, and return as a string — so the on-the-wire shape is always `{ output: "…json text…" }`.

---

## Model routing

File-type × size × tier:

| kind \| size | Free             | Pro               |
|--------------|------------------|-------------------|
| text / docx / pptx / xlsx | `MODEL_FREE` (Flash) | `MODEL_PRO` (Pro) |
| pdf ≤ 2 MB   | `MODEL_FREE`     | `MODEL_FREE` (speed) |
| pdf > 2 MB   | `MODEL_FREE`     | `MODEL_PRO`       |
| image (any)  | `MODEL_FREE`     | `MODEL_PRO`       |

Small PDFs always go Flash even on Pro — with a ≤2 MB PDF the quality delta is negligible and latency drops 3-10×. Image OCR stays on Pro for Pro because the quality gap on complex layouts and handwriting is large.

Defaults are `gemini-2.5-flash` / `gemini-2.5-pro`; override via `AI_MODEL_FREE` / `AI_MODEL_PRO`.

---

## Database schema

All tables live in `public` and are behind Row-Level Security.

- **`user_roles`** — `(user_id, role)` with `blocked` flag.
- **`subscriptions`** — mirrors Stripe's `subscription` object (price, status, period end) plus an `environment` column for live/sandbox split.
- **`usage_log`** — one row per conversion: `user_id?`, `filename`, `format`, `file_size`, `success`, `country`, `user_agent_brief`, `created_at`. Indexed on `(user_id, created_at)` and the request-origin column.
- **`api_keys`** — `prefix` (public, unique) + `key_hash` (sha256 of the secret). Plaintext secrets are never stored.

RPCs:

- `has_role(_user_id, _role)` → boolean
- `has_active_subscription(user_uuid, check_env)` → boolean
- `is_user_blocked(_user_id)` → boolean

See `supabase/migrations/0001_initial_schema.sql` for the full DDL and policy list.

---

## Rate limiting & abuse prevention

A per-IP burst limiter (default 30 req / min, configurable via `RATE_LIMIT_PER_MINUTE`) runs in-memory inside the edge function. It is best-effort — useful as a first gate but not a hard SLA for high-volume deployments.

Free-tier quota is enforced server-side via `usage_log` counts. Raw IPs are **never** stored — only a salted hash at subnet granularity. Rotating the HMAC secret invalidates future hash matches without touching historical rows.

---

## Front-end architecture

- **React 18 + Vite + TypeScript**
- **Tailwind + shadcn/ui** — HSL custom properties, editorial/terminal hybrid design tokens in `src/index.css`. Manuscript-card, paper-grain and starfield-grain backgrounds.
- **TanStack Query** for server state; **Zustand** for local UI state (conversion queue, drag-drop…).
- **i18next** — `src/i18n/{en,it,fr}.json`. Default locale via `VITE_DEFAULT_LOCALE`.
- **Router** — React Router with code-split pages (`Home`, `Docs`, `Account`, `Auth`, `Checkout`, `Admin`).
- **Analytics** — optional, plug any privacy-friendly provider via `VITE_ANALYTICS_*` env vars.
- **Design tokens** — fonts: *Inter* (body), *Instrument Serif* (display), *JetBrains Mono* (mono). Accent color: electric coral (`--accent: 8 88% 58%`).

---

## Observability

- **Edge-function logs** — `console.log/error` end up in Supabase's function log stream.
- **Usage analytics** — aggregate `usage_log` in SQL (examples in `supabase/queries/`).
- **Stripe webhooks** — log every subscription transition into `subscriptions` + an audit row.
- **Client errors** — hook up your favourite error tracker in `src/main.tsx` (Sentry init is a one-liner).

---

## Known limitations

- **Password-protected files** are not supported — `extraction_failed`.
- **Encrypted PDFs** likewise fail; they reach the model as opaque bytes and return garbage.
- **Slide decks > 250 k chars of extracted text** get truncated.
- **Firecrawl failures** silently fall back to plain fetch — if a URL needs JS to render, Free tier will get an empty/garbled result.
- **In-memory rate limit** is per edge instance — Supabase can scale to multiple workers, so the effective cap is `RATE_LIMIT_PER_MINUTE × worker_count`. Fine for burst protection, not for strict SLAs.
- **Country lookup** uses `api.country.is` as a fallback when the edge platform doesn't expose a country header — this is a third-party call with a 1.5-second timeout and cached per instance for 24 h.
