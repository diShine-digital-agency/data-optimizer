# Quickstart (IT)

La tua prima conversione in meno di 2 minuti.

## Opzione A — interfaccia web

1. Vai su <https://converter.dishine.it>.
2. Trascina un file (PDF, immagine, DOCX, PPTX, XLSX, TXT, CSV, HTML, JSON, YAML, MD) **oppure** incolla un URL.
3. Scegli **Markdown** o **JSON**.
4. Clicca **Converti**. Il risultato appare inline — copialo o scaricalo.

Free tier: **5 conversioni / 24 h**, file fino a **20 MB**. Nessun account richiesto.

## Opzione B — API

```bash
curl -X POST https://converter.dishine.it/v1/convert \
  -H "Authorization: Bearer dsh_<prefix>_<secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "report.pdf",
    "contentBase64": "'"$(base64 -w0 report.pdf)"'",
    "format": "markdown",
    "language": "it"
  }'
```

Risposta:

```json
{
  "output": "# Report trimestrale\n\n…",
  "format": "markdown",
  "tier": "pro",
  "model": "gemini-2.5-pro"
}
```

Generi la tua chiave API da **Account → Chiavi API** (Pro richiesto).

## Cosa provare dopo

- Dai in pasto un **URL** con `POST /v1/fetch-url` + `{ "url": "https://…" }` — stessa shape di output.
- Passa `format` a `"json"` per output strutturato (tool-call con JSON-schema).
- Serve conversione batch? Non c'è endpoint dedicato — parallelizza rispettando il rate limit di 30 req/min.

Vedi [Riferimento API](API-Reference) per la spec completa.
