# FAQ (IT)

## Il file viene salvato?

**No.** I file transitano nella memoria della edge function e vengono eliminati immediatamente dopo la conversione. Vengono registrati solo i metadati di base (nome, dimensione, formato, esito), e le origini delle richieste sono conservate solo come hash a senso unico salati — mai come valori grezzi.

## Cosa viene estratto e come?

- **File basati su testo** (DOCX, PPTX, XLSX, TXT, CSV, HTML, JSON, YAML, MD) — decodificati localmente in Deno senza inviare il file grezzo a nessun modello. Il modello riceve il testo già estratto.
- **PDF / immagini** — inviati al modello vision come data-URL. Il modello gestisce l'OCR, il rilevamento del layout e la ricostruzione delle tabelle.

## Perché ho ricevuto `extraction_failed`?

Cause più comuni: il file è protetto da password, criptato o utilizza una variante di formato non riconosciuta dal parser. Per DOCX/PPTX, ri-esportare dall'applicazione di origine di solito risolve il problema. Per i PDF, rimuovere prima la protezione con password.

## Perché la mia conversione Pro usa il modello Flash?

I PDF piccoli (≤ 2 MB) usano sempre il modello più veloce, anche su Pro — la differenza di qualità a quella dimensione è trascurabile, mentre il guadagno in termini di latenza è significativo. PDF più grandi, immagini e file Office utilizzano il modello Pro completo.

## Posso sostituire Gemini con un altro modello?

Sì. Il backend comunica con qualsiasi endpoint `/chat/completions` compatibile con OpenAI. Imposta `AI_GATEWAY_URL` e `AI_GATEWAY_API_KEY` nei secrets della funzione Supabase e, se necessario, sovrascrivi `AI_MODEL_FREE` / `AI_MODEL_PRO`. Funziona con OpenAI, Azure OpenAI, vLLM, OpenRouter e altri provider compatibili.

## Come funziona la quota del piano Free?

Il piano Free permette 5 conversioni per finestra di 24 ore. Il limite è applicato lato server e si azzera automaticamente ogni giorno. Passando a Pro, il limite sale a 500 conversioni per un periodo mobile di 30 giorni.

## Sto costruendo un SDK — c'è un'API stabile su cui fare affidamento?

L'API REST è stabile. Gli SDK per linguaggi specifici sono nella roadmap. Per ora, è sufficiente richiamare i due endpoint (`/v1/convert` e `/v1/fetch-url`) con il proprio client HTTP. La spec OpenAPI in `docs/openapi.yaml` può generare un client tipizzato nella maggior parte dei linguaggi.
