# REST API Reference

Version: **v1** · Base URL: `https://converter.dishine.it/v1` (hosted) or `https://<your-project>.functions.supabase.co` (self-hosted).

All endpoints return JSON. All errors use HTTP status codes plus a typed `error` string you can switch on.

---

## Table of contents

- [Authentication](#authentication)
- [Rate limits & quotas](#rate-limits--quotas)
- [Endpoints](#endpoints)
  - [`POST /v1/convert`](#post-v1convert) — file → Markdown/JSON
  - [`POST /v1/fetch-url`](#post-v1fetch-url) — URL → Markdown/JSON
- [Response envelope](#response-envelope)
- [Error codes](#error-codes)
- [Language examples](#language-examples)
- [Supported formats & languages](#supported-formats--languages)
- [FAQ](#faq)

---

## Authentication

Send your API key as a Bearer token:

```
Authorization: Bearer dsh_<prefix>_<secret>
```

- Create keys from **Account → API keys → Generate**. The full key is shown **once** and stored hashed on the server.
- Lost a key? Revoke it and generate a new one — the old one stops working immediately.
- Anonymous requests (no `Authorization`) count against the **Free** tier.

---

## Rate limits & quotas

| Tier | Daily       | Monthly (rolling 30 d) | Per-IP burst | File cap |
|------|-------------|------------------------|--------------|----------|
| Free | 5 / day     | —                      | 30 / min     | 20 MB    |
| Pro  | —           | 500 / 30 days          | 30 / min     | 100 MB   |

- Free quota resets every 24 hours and is tracked server-side.
- `429` responses include a `Retry-After` header (value in seconds).

---

## Endpoints

### `POST /v1/convert`

Convert a file to Markdown or JSON.

**Request body** (JSON):

| Field         | Type    | Required | Notes |
|---------------|---------|----------|-------|
| `fileBase64`  | string  | yes      | Base64-encoded file bytes. |
| `mimeType`    | string  | yes      | e.g. `application/pdf`, `image/png`. |
| `filename`    | string  | yes      | Used for extension sniffing and logging. |
| `format`      | string  | yes      | `"markdown"` or `"json"`. |
| `language`    | string  | no       | One of `auto`, `en`, `fr`, `it`, `es`, `de`, `pt`, `nl`, `ja`, `zh`. Defaults to `auto`. |
| `fingerprint` | string  | no       | Opaque 1–64 char client fingerprint (alnum, `_`, `-`). |
| `clientHash`  | string  | no       | Hex 16–64 char client hash. |

**Response** — see [Response envelope](#response-envelope).

### `POST /v1/fetch-url`

Convert a public URL to Markdown or JSON.

**Request body** (JSON):

| Field         | Type   | Required | Notes |
|---------------|--------|----------|-------|
| `url`         | string | yes      | Must be `http://` or `https://`. |
| `format`      | string | yes      | `"markdown"` or `"json"`. |
| `language`    | string | no       | Same set as above. |
| `fingerprint` | string | no       | Same as above. |
| `clientHash`  | string | no       | Same as above. |

**Pro / admin** calls go through Firecrawl (JS rendering + anti-bot); **Free** calls use a plain server-side fetch. On Firecrawl failure the edge function falls back to plain fetch transparently.

---

## Response envelope

All successful conversions return:

```json
{
  "output": "# Title\n\n…",
  "format": "markdown",
  "tier": "free",
  "model": "gemini-2.5-flash"
}
```

| Field   | Notes |
|---------|-------|
| `output`| Markdown string, or a pretty-printed JSON string when `format = "json"`. |
| `format`| Echoes the requested format. |
| `tier`  | `"free" \| "pro" \| "admin"`. |
| `model` | The actual model used (routing may pick Flash for small files even on Pro). |

`/v1/fetch-url` additionally returns:

```json
{
  "source": "firecrawl",
  "finalUrl": "https://example.com/redirected-path"
}
```

---

## Error codes

Errors return an HTTP status code plus `{ "error": "<code>", "message": "<human text>" }`.

| HTTP | `error`                  | Meaning |
|------|--------------------------|---------|
| 400  | `invalid_url`            | URL isn't `http(s)://…`. |
| 400  | `invalid_format`         | `format` must be `"markdown"` or `"json"`. |
| 400  | `Invalid fingerprint`    | Fingerprint failed validation. |
| 400  | `Invalid clientHash`     | Client hash failed validation. |
| 400  | `Invalid language`       | Unsupported language code. |
| 402  | _(message only)_         | AI credits exhausted on the gateway side. |
| 403  | `account_blocked`        | Admin blocked this account. |
| 413  | `file_too_large`         | File exceeds the tier cap. |
| 415  | `unsupported_format`     | MIME / extension not in the allow-list. |
| 422  | `extraction_failed`      | Corrupt, password-protected, or unreadable file. |
| 422  | `empty_output`           | Model returned empty content. |
| 422  | `no_structured_output`   | JSON format requested but no tool call emitted. |
| 429  | `rate_limited`           | Per-IP burst limit. See `Retry-After`. |
| 429  | `quota_exceeded`         | Free daily cap reached. |
| 429  | `monthly_limit_reached`  | Pro 30-day cap reached. |
| 500  | `ai_failed`              | Upstream model error. |
| 503  | _(message only)_         | Quota check couldn't be performed; retry. |

---

## Language examples

### curl

```bash
curl -sS -X POST https://converter.dishine.it/v1/convert \
  -H "Authorization: Bearer $DISHINE_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg b64 "$(base64 -w0 invoice.pdf)" \
        '{fileBase64:$b64, mimeType:"application/pdf", filename:"invoice.pdf", format:"markdown"}')"
```

### Node (fetch, ≥ 18)

```js
import { readFile } from "node:fs/promises";

const file = await readFile("invoice.pdf");
const res = await fetch("https://converter.dishine.it/v1/convert", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.DISHINE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    fileBase64: file.toString("base64"),
    mimeType: "application/pdf",
    filename: "invoice.pdf",
    format: "markdown",
    language: "en",
  }),
});

if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
const { output, model, tier } = await res.json();
console.log({ tier, model, preview: output.slice(0, 200) });
```

### Python (httpx)

```python
import base64, os, httpx

with open("invoice.pdf", "rb") as f:
    payload = {
        "fileBase64": base64.b64encode(f.read()).decode(),
        "mimeType":   "application/pdf",
        "filename":   "invoice.pdf",
        "format":     "markdown",
    }

r = httpx.post(
    "https://converter.dishine.it/v1/convert",
    headers={"Authorization": f"Bearer {os.environ['DISHINE_KEY']}"},
    json=payload, timeout=120,
)
r.raise_for_status()
data = r.json()
print(data["tier"], data["model"])
print(data["output"][:200])
```

### Go

```go
package main

import (
    "bytes"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
)

func main() {
    raw, _ := os.ReadFile("invoice.pdf")
    payload, _ := json.Marshal(map[string]string{
        "fileBase64": base64.StdEncoding.EncodeToString(raw),
        "mimeType":   "application/pdf",
        "filename":   "invoice.pdf",
        "format":     "markdown",
    })
    req, _ := http.NewRequest("POST",
        "https://converter.dishine.it/v1/convert",
        bytes.NewReader(payload))
    req.Header.Set("Authorization", "Bearer "+os.Getenv("DISHINE_KEY"))
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil { panic(err) }
    defer resp.Body.Close()
    body, _ := io.ReadAll(resp.Body)
    fmt.Println(resp.StatusCode, string(body[:200]))
}
```

### PHP (Guzzle)

```php
<?php
require "vendor/autoload.php";
use GuzzleHttp\Client;

$client = new Client(["timeout" => 120]);
$response = $client->post("https://converter.dishine.it/v1/convert", [
    "headers" => [
        "Authorization" => "Bearer " . getenv("DISHINE_KEY"),
        "Content-Type"  => "application/json",
    ],
    "json" => [
        "fileBase64" => base64_encode(file_get_contents("invoice.pdf")),
        "mimeType"   => "application/pdf",
        "filename"   => "invoice.pdf",
        "format"     => "markdown",
    ],
]);

$data = json_decode($response->getBody(), true);
echo $data["tier"], " ", $data["model"], "\n";
echo substr($data["output"], 0, 200);
```

### Ruby (Net::HTTP)

```ruby
require "base64"
require "json"
require "net/http"
require "uri"

uri  = URI("https://converter.dishine.it/v1/convert")
req  = Net::HTTP::Post.new(uri, {
  "Authorization" => "Bearer #{ENV['DISHINE_KEY']}",
  "Content-Type"  => "application/json",
})
req.body = {
  fileBase64: Base64.strict_encode64(File.binread("invoice.pdf")),
  mimeType:   "application/pdf",
  filename:   "invoice.pdf",
  format:     "markdown",
}.to_json

res = Net::HTTP.start(uri.host, uri.port, use_ssl: true, read_timeout: 120) { |h| h.request(req) }
puts JSON.parse(res.body)["output"][0, 200]
```

---

## Supported formats & languages

**Input formats**

| Category     | MIME / extension |
|--------------|-------------------|
| PDF          | `application/pdf`, `.pdf` |
| Word         | `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.docx` |
| PowerPoint   | `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `.pptx` |
| Excel        | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `.xlsx` |
| Text         | `text/*`, `.txt`, `.md`, `.markdown`, `.log`, `.rtf` |
| Tabular text | `.csv`, `.tsv` |
| Markup       | `text/html`, `text/xml`, `.html`, `.htm`, `.xml` |
| Structured   | `application/json`, `.json`, `.yaml`, `.yml` |
| Images (OCR) | `image/*`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp` |

**Language hint values:** `auto` (default), `en`, `fr`, `it`, `es`, `de`, `pt`, `nl`, `ja`, `zh`. The hint is used to bias OCR and preserve original-language output — we **never translate** content.

---

## FAQ

**Are files stored?**
No. Conversions run in-memory inside the edge function. Only filename, format, size, coarse country, and a hashed IP are logged. Raw IPs are never persisted.

**Why does the Pro response sometimes come back with the Flash model?**
Files ≤ 2 MB are routed to Flash on every tier — it's 3-10× faster with near-identical fidelity on small inputs. Pro only "kicks in" above that threshold.

**How do I switch AI providers?**
Point `AI_GATEWAY_URL` at any OpenAI-compatible `/chat/completions` endpoint and set `AI_GATEWAY_API_KEY`. You can also override `AI_MODEL_FREE` / `AI_MODEL_PRO`. See [`DEPLOY.md`](DEPLOY.md).
