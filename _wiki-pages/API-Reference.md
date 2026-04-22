# API Reference

Full reference lives in [API.md](https://github.com/dishine/dishine-convert/blob/main/API.md) and [docs/openapi.yaml](https://github.com/dishine/dishine-convert/blob/main/docs/openapi.yaml). This page is a compressed tour.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/convert` | File → Markdown/JSON |
| `POST` | `/v1/fetch-url` | URL → Markdown/JSON |

## Auth

`Authorization: Bearer dsh_<prefix>_<secret>` — issued under **Account → API keys**.

Anonymous calls are accepted but metered as Free-tier.

## Request shape

```jsonc
// /v1/convert
{
  "filename": "deck.pptx",
  "contentBase64": "<base64 of the raw bytes>",
  "format": "markdown",          // or "json"
  "language": "en",              // "en" | "it" | "fr"
  "fingerprint": "optional",
  "clientHash": "optional"
}
```

```jsonc
// /v1/fetch-url
{
  "url": "https://example.com/article",
  "format": "markdown",
  "language": "en"
}
```

## Response shape

```json
{
  "output": "…markdown or stringified JSON…",
  "format": "markdown",
  "tier": "free",
  "model": "gemini-2.5-flash"
}
```

`fetch-url` also returns `source` (`"firecrawl" | "basic"`) and `finalUrl` (after redirects).

## Limits

| | Free | Pro |
|---|---|---|
| File size | 20 MB | 100 MB |
| Quota | 5 / 24 h | 500 / rolling 30 days |
| Rate limit | 30 req/min per IP | 30 req/min per IP |

## Error codes

`400` invalid input · `401` bad token · `402` payment required · `403` blocked · `413` file too large · `415` unsupported format · `429` rate-limited or quota exhausted · `500` extraction or model failure.

The body is always `{ "error": "short_code", "message": "human readable" }`.
