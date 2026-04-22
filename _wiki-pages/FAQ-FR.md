# FAQ (FR)

## Mon fichier est-il stocké ?

**Non.** Les fichiers transitent par la mémoire de l'edge function et sont supprimés immédiatement après la conversion. Seules les métadonnées de base (nom, taille, format, résultat) sont enregistrées, et les origines des requêtes ne sont conservées que sous forme de hachages salés à sens unique — jamais en clair.

## Qu'est-ce qui est extrait et comment ?

- **Fichiers texte** (DOCX, PPTX, XLSX, TXT, CSV, HTML, JSON, YAML, MD) — décodés localement dans Deno sans envoyer le fichier brut à un modèle. Le modèle reçoit uniquement le texte extrait.
- **PDF / images** — envoyés au modèle vision sous forme de data-URL. Le modèle gère l'OCR, la détection de mise en page et la reconstruction des tableaux.

## Pourquoi ai-je reçu `extraction_failed` ?

Causes les plus fréquentes : le fichier est protégé par un mot de passe, chiffré, ou utilise une variante de format non reconnue par le parseur. Pour les DOCX/PPTX, ré-exporter depuis l'application d'origine règle généralement le problème. Pour les PDF, supprimer d'abord la protection par mot de passe.

## Pourquoi ma conversion Pro utilise-t-elle le modèle Flash ?

Les petits PDF (≤ 2 Mo) utilisent toujours le modèle rapide, même sur Pro — la différence de qualité à cette taille est négligeable, tandis que le gain de latence est significatif. Les PDF plus volumineux, les images et les fichiers Office utilisent le modèle Pro complet.

## Puis-je remplacer Gemini par un autre modèle ?

Oui. Le backend communique avec n'importe quel endpoint `/chat/completions` compatible OpenAI. Renseignez `AI_GATEWAY_URL` et `AI_GATEWAY_API_KEY` dans les secrets de votre fonction Supabase, et au besoin surchargez `AI_MODEL_FREE` / `AI_MODEL_PRO`. Compatible avec OpenAI, Azure OpenAI, vLLM, OpenRouter et d'autres fournisseurs similaires.

## Comment fonctionne le quota du palier Free ?

Le palier Free autorise 5 conversions par fenêtre de 24 heures. La limite est appliquée côté serveur et se réinitialise automatiquement chaque jour. En passant à Pro, cette limite monte à 500 conversions sur une période glissante de 30 jours.

## Je développe un SDK — y a-t-il une API stable sur laquelle m'appuyer ?

L'API REST est stable. Des SDK pour différents langages sont dans la feuille de route. En attendant, il suffit d'appeler les deux endpoints (`/v1/convert` et `/v1/fetch-url`) avec votre client HTTP. La spec OpenAPI dans `docs/openapi.yaml` peut générer un client typé pour la plupart des langages.
