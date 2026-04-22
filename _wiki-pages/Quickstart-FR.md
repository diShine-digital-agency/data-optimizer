# Quickstart (FR)

Votre première conversion en moins de 2 minutes.

## Option A — l'interface web

1. Allez sur <https://converter.dishine.it>.
2. Déposez un fichier (PDF, image, DOCX, PPTX, XLSX, TXT, CSV, HTML, JSON, YAML, MD) **ou** collez une URL.
3. Choisissez **Markdown** ou **JSON**.
4. Cliquez sur **Convertir**. Le résultat s'affiche directement — à copier ou télécharger.

Palier Free : **5 conversions / 24 h**, fichiers jusqu'à **20 Mo**. Aucun compte nécessaire.

## Option B — l'API

```bash
curl -X POST https://converter.dishine.it/v1/convert \
  -H "Authorization: Bearer dsh_<prefix>_<secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "rapport.pdf",
    "contentBase64": "'"$(base64 -w0 rapport.pdf)"'",
    "format": "markdown",
    "language": "fr"
  }'
```

Réponse :

```json
{
  "output": "# Rapport trimestriel\n\n…",
  "format": "markdown",
  "tier": "pro",
  "model": "gemini-2.5-pro"
}
```

Créez votre clé API dans **Compte → Clés API** (Pro requis).

## La suite

- Soumettez une **URL** via `POST /v1/fetch-url` avec `{ "url": "https://…" }` — même forme de réponse.
- Passez `format` à `"json"` pour une sortie structurée (tool-call avec JSON-schema).
- Besoin de traiter en lot ? Pas d'endpoint dédié — parallélisez en respectant la limite de 30 req/min.

Voir [Référence API](API-Reference) pour la spéc complète.
