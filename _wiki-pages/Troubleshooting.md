# Troubleshooting

## `401 invalid_token`

Your `Authorization: Bearer` header doesn't match the expected format
`dsh_<prefix>_<secret>`, or the key was revoked. Generate a new one under
**Account → API keys**.

## `413 file_too_large`

Free tier caps at 20 MB; Pro at 100 MB. For larger inputs, split the file
first (e.g. one PDF chapter at a time) or upgrade to Pro.

## `415 unsupported_format`

The server sniffs both MIME type and file extension. Rename the file to its
correct extension and try again. If the format is genuinely unsupported, open
an issue with a sample.

## `429` rate limit or quota exceeded (with `Retry-After` header)

You hit either the per-IP rate limit (30 req/min) or your tier's conversion
quota. The `Retry-After` response header tells you how many seconds to wait.

## `500 extraction_failed`

The file was received but could not be parsed. Common causes: password
protection, file corruption, or an unusual OOXML dialect. Re-export from the
source application. For PDFs, try flattening or re-saving the file first.

## Edge-function logs are empty (self-hosted)

Supabase streams `console.log` output from Deno into the project's
**Edge Functions → Logs** panel. If nothing appears:

1. Confirm the function actually ran — check `usage_log` for a new row.
2. Confirm your client is hitting the right project URL (`VITE_SUPABASE_URL`).
3. Tail logs from the CLI: `supabase functions logs convert-file --project-ref <ref>`

## Operator setup returns `magic_link_failed` (self-hosted)

The operator setup endpoint calls the Supabase Admin API (`generateLink`).
Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in the function secrets — the anon
key does not have the required permissions.

## `country: "unknown"` in log rows

The fallback country lookup timed out or was blocked. This is cosmetic — it
does not affect conversion results. Add a firewall exception for the lookup
service if accurate country labels are required.
