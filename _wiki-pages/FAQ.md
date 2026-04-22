# FAQ

## Is my file stored?

**No.** Files pass through the edge function's memory and are discarded immediately after conversion. Only basic metadata (filename, size, format, outcome) is logged, and request origins are stored only as salted one-way hashes — never as raw values.

## What gets extracted and how?

- **Text-based files** (DOCX, PPTX, XLSX, TXT, CSV, HTML, JSON, YAML, MD) — decoded locally in Deno without sending the raw file to any model. The extracted text is what the model receives.
- **PDF / images** — sent to the vision model as a data-URL. The model handles OCR, layout detection, and table reconstruction.

## Why did I get `extraction_failed`?

Most common causes: the file is password-protected, encrypted, or uses a format variant the parser doesn't recognise. For DOCX/PPTX, re-exporting from the source application usually fixes it. For PDFs, remove any password protection first.

## Why is my Pro conversion using the Flash model?

Small PDFs (≤ 2 MB) always use the faster model, even on Pro — the quality difference at that size is negligible and the latency drop is significant. Larger PDFs, images, and Office files use the full Pro model.

## Can I swap Gemini for another model?

Yes. The backend talks to any OpenAI-compatible `/chat/completions` endpoint. Set `AI_GATEWAY_URL` and `AI_GATEWAY_API_KEY` in your Supabase function secrets, and optionally override `AI_MODEL_FREE` / `AI_MODEL_PRO`. Works with OpenAI, Azure OpenAI, vLLM, OpenRouter, and other compatible providers.

## How does the Free tier quota work?

The Free tier allows 5 conversions per 24-hour window. The limit is enforced server-side — it resets automatically every day. Upgrading to Pro raises this to 500 conversions per rolling 30-day period.

## I'm building an SDK — is there a stable API I can target?

The REST API is stable. Language-specific SDKs are on the roadmap. For now, wrap the two endpoints (`/v1/convert` and `/v1/fetch-url`) with your HTTP client of choice — the OpenAPI spec at `docs/openapi.yaml` can generate a typed client in most languages.
