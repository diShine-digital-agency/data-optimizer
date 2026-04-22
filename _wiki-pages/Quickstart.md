# Quickstart

Convert your first file in under 2 minutes.

## Option A — the web UI

1. Go to <https://converter.dishine.it>.
2. Drop a file (PDF, image, DOCX, PPTX, XLSX, TXT, CSV, HTML, JSON, YAML, MD) **or** paste a URL.
3. Pick **Markdown** or **JSON**.
4. Hit **Convert**. The result appears inline — copy or download it.

Free tier: **5 conversions / 24 h**, files up to **20 MB**. No account needed.

## Option B — the API

```bash
curl -X POST https://converter.dishine.it/v1/convert \
  -H "Authorization: Bearer dsh_<prefix>_<secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "report.pdf",
    "contentBase64": "'"$(base64 -w0 report.pdf)"'",
    "format": "markdown",
    "language": "en"
  }'
```

Response:

```json
{
  "output": "# Quarterly report\n\n…",
  "format": "markdown",
  "tier": "pro",
  "model": "gemini-2.5-pro"
}
```

Get an API key under **Account → API keys** (Pro required).

## What to try next

- Feed a **URL**: `POST /v1/fetch-url` with `{ "url": "https://…" }` — same output shape.
- Switch `format` to `"json"` for structured output (tool-call JSON-schema).
- Batch multiple files — there's no batch endpoint; just parallelize. Respect the 30 req/min rate limit.

See [API Reference](API-Reference) for the full spec.
