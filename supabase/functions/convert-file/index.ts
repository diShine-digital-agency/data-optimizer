// ─────────────────────────────────────────────────────────────────────────────
//  convert-file
//  Supabase Edge Function (Deno runtime)
//
//  POST { fileBase64, mimeType, filename, format, fingerprint?, clientHash?, language? }
//      → { output, format, tier, model }
//
//  - Detects file type (PDF, image, DOCX, PPTX, XLSX, text)
//  - DOCX/PPTX/XLSX: unzips + reads the underlying XML locally (no vision call)
//  - PDF / image: sent to a vision-capable model
//  - Enforces Free-tier daily quota, Pro monthly cap, per-IP burst limit
//  - Writes a row to `usage_log` per successful conversion
//
//  The model backend is OpenAI-compatible and fully swappable via
//  AI_GATEWAY_URL + AI_GATEWAY_API_KEY. Defaults target Google Gemini's
//  OpenAI-compatible endpoint so a bare `GEMINI_API_KEY` drop-in also works.
// ─────────────────────────────────────────────────────────────────────────────
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyAdminToken } from "../_shared/admin-token.ts";
import { verifyInternalToken } from "../_shared/api-key.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token, x-internal-token",
};

const FREE_DAILY_LIMIT = Number(Deno.env.get("QUOTA_FREE_PER_DAY") ?? 5);
const PRO_MONTHLY_LIMIT = Number(Deno.env.get("QUOTA_PRO_PER_MONTH") ?? 500);
const MAX_FILE_BYTES_FREE = 20 * 1024 * 1024;   // 20 MB
const MAX_FILE_BYTES_PRO = 100 * 1024 * 1024;   // 100 MB
const RATE_LIMIT_PER_MINUTE = Number(Deno.env.get("RATE_LIMIT_PER_MINUTE") ?? 30);
const ALLOWED_LANGS = new Set([
  "auto", "en", "fr", "it", "es", "de", "pt", "nl", "ja", "zh",
]);

// AI backend (OpenAI-compatible chat-completions). Defaults to Google Gemini
// OpenAI-compat endpoint; override for any other OpenAI-compatible provider.
const AI_GATEWAY_URL =
  Deno.env.get("AI_GATEWAY_URL") ??
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const AI_GATEWAY_API_KEY =
  Deno.env.get("AI_GATEWAY_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");

const MODEL_FREE = Deno.env.get("AI_MODEL_FREE") ?? "gemini-2.5-flash";
const MODEL_PRO = Deno.env.get("AI_MODEL_PRO") ?? "gemini-2.5-pro";

function languageInstruction(lang?: string): string {
  if (!lang || lang === "auto") return "";
  const map: Record<string, string> = {
    en: "English", fr: "French", it: "Italian", es: "Spanish",
    de: "German", pt: "Portuguese", nl: "Dutch", ja: "Japanese", zh: "Chinese",
  };
  const name = map[lang];
  if (!name) return "";
  return `\n\nThe document is primarily written in ${name}. Optimize OCR and text recognition for ${name}, preserve original-language content verbatim, do not translate.`;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Tiny in-memory IP→country cache (per edge instance). Keys live 24h.
const COUNTRY_CACHE = new Map<string, { code: string; exp: number }>();
const COUNTRY_TTL_MS = 24 * 60 * 60 * 1000;
async function lookupCountry(ip: string): Promise<string | null> {
  const cached = COUNTRY_CACHE.get(ip);
  if (cached && cached.exp > Date.now()) return cached.code || null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`https://api.country.is/${encodeURIComponent(ip)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const code = (j?.country || "").toString().toUpperCase().slice(0, 2);
    COUNTRY_CACHE.set(ip, { code, exp: Date.now() + COUNTRY_TTL_MS });
    return code || null;
  } catch (_) {
    return null;
  }
}

// ─── File-type routing ───────────────────────────────────────────────────────
type Kind = "text" | "image" | "pdf" | "docx" | "pptx" | "xlsx" | "unsupported";

function detectKind(mimeType: string, filename: string): Kind {
  const mt = (mimeType || "").toLowerCase();
  const ext = filename.toLowerCase().split(".").pop() || "";

  if (mt === "application/pdf" || ext === "pdf") return "pdf";
  if (mt.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)) return "image";
  if (
    mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) return "docx";
  if (
    mt === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  ) return "pptx";
  if (
    mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx"
  ) return "xlsx";
  if (
    mt.startsWith("text/") ||
    mt === "application/json" ||
    mt === "application/xml" ||
    ["txt", "md", "markdown", "csv", "tsv", "html", "htm", "xml", "json", "yaml", "yml", "log", "rtf"].includes(ext)
  ) return "text";

  return "unsupported";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

// Minimal ZIP reader (DOCX/PPTX/XLSX are ZIP archives) — STORED + DEFLATE.
async function readZipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error("Not a valid ZIP archive");

  const cdEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const compMethod = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
    const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const compData = bytes.subarray(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (compMethod === 0) {
      data = compData;
    } else if (compMethod === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const decompressed = await new Response(
        new Blob([compData]).stream().pipeThrough(ds),
      ).arrayBuffer();
      data = new Uint8Array(decompressed);
    } else {
      continue;
    }
    entries.set(name, data);
  }
  return entries;
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<w:br[^/]*\/>/g, "\n")
    .replace(/<\/a:p>/g, "\n\n")
    .replace(/<a:br[^/]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const entries = await readZipEntries(bytes);
  const doc = entries.get("word/document.xml");
  if (!doc) throw new Error("Invalid DOCX: missing document.xml");
  return stripXmlTags(new TextDecoder().decode(doc));
}

async function extractPptxText(bytes: Uint8Array): Promise<string> {
  const entries = await readZipEntries(bytes);
  const dec = new TextDecoder();
  const slideKeys = [...entries.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return na - nb;
    });

  const inspect = (xml: string) => {
    const imageCount = (xml.match(/<p:pic\b/g) || []).length;
    const tableCount = (xml.match(/<a:tbl\b/g) || []).length;
    const chartCount = (xml.match(/<c:chart\b/g) || (xml.match(/chart\d+\.xml/g) || [])).length;
    const shapeCount = (xml.match(/<p:sp\b/g) || []).length;
    const bulletCount =
      (xml.match(/<a:buChar\b/g) || []).length +
      (xml.match(/<a:buAutoNum\b/g) || []).length;
    const layoutMatch = xml.match(/<p:sldLayoutId[^>]*r:id="([^"]+)"/);
    return { imageCount, tableCount, chartCount, shapeCount, bulletCount, hasLayoutRef: !!layoutMatch };
  };

  const slides: string[] = [];
  for (let i = 0; i < slideKeys.length; i++) {
    const slideKey = slideKeys[i];
    const idx = i + 1;
    const xml = dec.decode(entries.get(slideKey)!);
    const meta = inspect(xml);
    const text = stripXmlTags(xml);

    const slideNum = parseInt(slideKey.match(/slide(\d+)\.xml/)![1], 10);
    const notesKey = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    const notesBytes = entries.get(notesKey);
    const notes = notesBytes ? stripXmlTags(dec.decode(notesBytes)) : "";

    const signals: string[] = [];
    if (meta.imageCount) signals.push(`${meta.imageCount} image${meta.imageCount > 1 ? "s" : ""}`);
    if (meta.tableCount) signals.push(`${meta.tableCount} table${meta.tableCount > 1 ? "s" : ""}`);
    if (meta.chartCount) signals.push(`${meta.chartCount} chart${meta.chartCount > 1 ? "s" : ""}`);
    if (meta.bulletCount) signals.push(`${meta.bulletCount} bullet group${meta.bulletCount > 1 ? "s" : ""}`);
    if (meta.shapeCount) signals.push(`${meta.shapeCount} shape${meta.shapeCount > 1 ? "s" : ""}`);

    const parts: string[] = [`## Slide ${idx}`];
    if (signals.length) parts.push(`_Structural signals: ${signals.join(", ")}._`);
    parts.push("### Visible text");
    parts.push(text || "_(no text on this slide)_");
    if (notes) {
      parts.push("### Speaker notes");
      parts.push(notes);
    }
    slides.push(parts.join("\n\n"));
  }
  return slides.join("\n\n---\n\n");
}

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function escapeGfmCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

async function extractXlsxText(bytes: Uint8Array): Promise<string> {
  const entries = await readZipEntries(bytes);

  const sst: string[] = [];
  const sstXml = entries.get("xl/sharedStrings.xml");
  if (sstXml) {
    const txt = new TextDecoder().decode(sstXml);
    const matches = txt.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g);
    for (const m of matches) sst.push(stripXmlTags(m[1]));
  }

  const sheetNames: string[] = [];
  const wbXml = entries.get("xl/workbook.xml");
  if (wbXml) {
    const txt = new TextDecoder().decode(wbXml);
    const nm = txt.matchAll(/<sheet[^>]*\sname="([^"]+)"/g);
    for (const m of nm) sheetNames.push(m[1]);
  }

  const sheetKeys = [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)\.xml/)![1], 10);
      const nb = parseInt(b.match(/sheet(\d+)\.xml/)![1], 10);
      return na - nb;
    });

  const sheetsOut: string[] = [];

  for (let i = 0; i < sheetKeys.length; i++) {
    const xml = new TextDecoder().decode(entries.get(sheetKeys[i])!);

    const grid: Map<number, Map<number, string>> = new Map();
    let maxCol = -1;

    const rowMatches = xml.matchAll(/<row[^>]*?(?:\sr="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g);
    let autoRow = 0;
    for (const r of rowMatches) {
      const rowIdx = r[1] ? parseInt(r[1], 10) - 1 : autoRow;
      autoRow = rowIdx + 1;
      const rowMap = new Map<number, string>();
      const cellMatches = r[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g);
      let autoCol = 0;
      for (const c of cellMatches) {
        const attrs = c[1];
        const inner = c[2];
        const refMatch = attrs.match(/\sr="([A-Z]+)(\d+)"/);
        const typeMatch = attrs.match(/\st="(\w+)"/);
        const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : autoCol;
        autoCol = colIdx + 1;
        const type = typeMatch ? typeMatch[1] : "";

        let value = "";
        if (type === "inlineStr") {
          const tMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          if (tMatch) value = stripXmlTags(tMatch[1]);
        } else {
          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (vMatch) {
            const raw = vMatch[1];
            if (type === "s") value = sst[parseInt(raw, 10)] || "";
            else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
            else value = raw;
          }
        }

        if (value !== "") {
          rowMap.set(colIdx, value);
          if (colIdx > maxCol) maxCol = colIdx;
        }
      }
      if (rowMap.size > 0) grid.set(rowIdx, rowMap);
    }

    const mergeMatches = xml.matchAll(/<mergeCell\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/?>/g);
    for (const m of mergeMatches) {
      const c1 = colLettersToIndex(m[1]);
      const r1 = parseInt(m[2], 10) - 1;
      const c2 = colLettersToIndex(m[3]);
      const r2 = parseInt(m[4], 10) - 1;
      const value = grid.get(r1)?.get(c1) ?? "";
      if (value === "") continue;
      for (let rr = r1; rr <= r2; rr++) {
        let row = grid.get(rr);
        if (!row) { row = new Map(); grid.set(rr, row); }
        for (let cc = c1; cc <= c2; cc++) {
          if (rr === r1 && cc === c1) continue;
          if (!row.has(cc)) row.set(cc, value);
          if (cc > maxCol) maxCol = cc;
        }
      }
    }

    const sheetTitle = sheetNames[i] || `Sheet ${i + 1}`;
    if (grid.size === 0) {
      sheetsOut.push(`## ${sheetTitle}\n\n_(empty)_`);
      continue;
    }

    const rowIdxs = [...grid.keys()].sort((a, b) => a - b);
    const blocks: number[][] = [];
    let current: number[] = [];
    let prev = -2;
    for (const ri of rowIdxs) {
      if (current.length === 0 || ri === prev + 1) current.push(ri);
      else { blocks.push(current); current = [ri]; }
      prev = ri;
    }
    if (current.length > 0) blocks.push(current);

    const sheetParts: string[] = [`## ${sheetTitle}`];
    const colCount = maxCol + 1;

    blocks.forEach((blockRows, bIdx) => {
      const matrix: string[][] = [];
      for (const ri of blockRows) {
        const rowMap = grid.get(ri)!;
        const arr: string[] = [];
        for (let c = 0; c < colCount; c++) arr.push(escapeGfmCell(rowMap.get(c) ?? ""));
        matrix.push(arr);
      }
      const keep: boolean[] = [];
      for (let c = 0; c < colCount; c++) keep.push(matrix.some((row) => row[c] !== ""));
      const trimmed = matrix.map((row) => row.filter((_, c) => keep[c]));
      if (trimmed.length === 0 || (trimmed[0]?.length ?? 0) === 0) return;

      const firstRow = trimmed[0];
      const isTitleBlock =
        trimmed.length === 1 &&
        firstRow.length >= 1 &&
        firstRow.every((v) => v === firstRow[0]) &&
        firstRow[0] !== "";
      if (isTitleBlock) {
        sheetParts.push("");
        sheetParts.push(`### ${firstRow[0]}`);
        return;
      }

      if (blocks.length > 1) {
        sheetParts.push("");
        sheetParts.push(`### Block ${bIdx + 1}`);
      }
      const header = trimmed[0].map((h, idx) => h || `Col ${idx + 1}`);
      const body = trimmed.slice(1);
      sheetParts.push("");
      sheetParts.push(`| ${header.join(" | ")} |`);
      sheetParts.push(`| ${header.map(() => "---").join(" | ")} |`);
      for (const row of body) sheetParts.push(`| ${row.join(" | ")} |`);
    });

    sheetsOut.push(sheetParts.join("\n"));
  }

  return sheetsOut.join("\n\n---\n\n");
}

// ─── AI prompts ──────────────────────────────────────────────────────────────

const MARKDOWN_SYSTEM = `You are a high-fidelity file-to-Markdown converter. Convert the input into clean, faithful, well-structured GitHub-Flavored Markdown.

Fidelity rules (most important):
- Preserve EVERY piece of meaningful content. Never summarize, paraphrase, translate, or omit text.
- Never invent content. If something is unclear or unreadable, write _[unclear]_ inline rather than guessing.
- Preserve the original language verbatim.

Structure rules:
- Map heading hierarchy faithfully (#, ##, ###, ####). Use the document's own visual hierarchy, not your invention.
- Lists: use - for unordered, 1. for ordered. Preserve nesting via 2-space indentation.
- Tables: use GFM pipe syntax with a header separator row. Escape | inside cells as \\|. Collapse newlines inside cells to spaces.
- Code or pre-formatted blocks: use fenced code blocks with a language hint when detectable (\`\`\`python, \`\`\`json, \`\`\`bash). Keep indentation as-is.
- Blockquotes for quoted text: > prefix.
- Inline emphasis: *italic*, **bold**, \`code\`. Keep links as [text](url).
- For images embedded inside documents, write a concise factual caption in italics on its own line: *[Image: short factual description]*. Do NOT invent what's in the image if you can't see it.
- Multi-column layouts: read in natural reading order (top-to-bottom, left-to-right) and merge into a single linear flow.
- Headers/footers/page numbers in PDFs: drop repeated running headers/footers and page numbers; keep them only if they carry unique meaning.

Output rules:
- Output ONLY the Markdown content. No preface, no "Here is...", no closing remarks.
- Do NOT wrap the entire response in a code fence.
- Separate slides/pages/sheets/sections with a horizontal rule (---) only when the source has clear breaks.`;

const DECK_MARKDOWN_SYSTEM = `You are a slide-deck-to-Markdown analyst. The input is text already extracted from a PowerPoint/Keynote-style deck, slide by slide. Each slide block starts with "## Slide N" and may include "### Visible text", "### Speaker notes", and a "_Structural signals_" line listing detected images, tables, charts, bullets and shapes.

For EVERY slide, output exactly this structure:

## Slide N — <short inferred title>
**Purpose:** one sentence on what this slide is trying to achieve in the deck's narrative.
**Structure & layout:** describe the visual structure inferred from the signals and text shape (e.g. "Title slide", "Two-column comparison", "Title + bullet list", "Image-led with caption", "Data slide with table/chart", "Section divider", "Closing/CTA"). Mention image/table/chart counts when present.
**Content:**
- Faithfully transcribe the visible text as Markdown: heading, sub-bullets, tables (GFM pipes) when a table is detected. Do NOT invent text that isn't there.
**UX / UI notes:** 1-3 bullets on hierarchy, density, readability, what likely draws the eye, and one concrete improvement suggestion.
**Speaker notes:** verbatim notes if present, otherwise "_None._"

Separate slides with a horizontal rule (---).
After the last slide, append:

## Deck overview
- **Slides:** total count
- **Narrative arc:** 2-4 sentences on how the deck flows
- **Audience & tone:** inferred audience and register
- **Strengths:** 2-3 bullets
- **Improvements:** 2-3 concrete bullets

Rules:
- Output ONLY Markdown, no preface, no code fences around the whole answer.
- Be faithful: never fabricate content. Inferences belong only in Purpose / Structure / UX notes / Deck overview.
- Keep the original language verbatim. Be tight, no filler.`;

const IMAGE_MARKDOWN_SYSTEM = `You are a high-precision image-to-Markdown describer with OCR.

Process the image in this order:
1. OCR FIRST: detect and transcribe every visible piece of text (signs, captions, UI labels, slide text, document text, handwriting, watermarks). Preserve the original language and reading order. If text is partly unreadable, mark it _[unclear]_.
2. Then describe the image visually.

Output structure:
# <H1 title summarizing the image, e.g. "Photo of …", "Screenshot of …", "Document scan of …">

## Description
2-4 sentences describing the scene, subjects, composition, mood, colors, and notable details. Be concrete and factual.

## Text content
Transcribe every visible piece of text VERBATIM, preserving structure (use lists, headings, tables when the layout suggests them). If the image contains no text at all, write "_No visible text._".

## Tags
A comma-separated list of 5-10 relevant keywords (subjects, setting, style, dominant colors, document type if applicable).

Rules:
- Output ONLY Markdown. No code fences around the whole answer, no preface.
- Never invent text that isn't there. Never invent objects you can't see.
- Keep transcribed text in its original language.`;

const PDF_MARKDOWN_SYSTEM = MARKDOWN_SYSTEM + `

Additional PDF guidance:
- The input is a PDF. Treat each page in reading order.
- Recover semantic structure: detect titles vs body vs captions vs footnotes. Demote running page numbers and repeated headers/footers.
- Tables: reconstruct GFM tables faithfully, even if the PDF used visual lines. Align columns by header.
- Multi-column pages: linearize columns in natural reading order.
- Footnotes: render as a "## Footnotes" section at the end of the page or document, using [^n] markers inline.
- Forms / fillable fields: render labeled values as a definition list (\`**Label:** value\`).`;

const JSON_TOOL = {
  type: "function",
  function: {
    name: "emit_document",
    description: "Emit a structured JSON representation of the document.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        metadata: {
          type: "object",
          properties: {
            source_format: { type: "string" },
            page_count: { type: "number" },
            language: { type: "string" },
          },
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              level: { type: "number" },
              content: { type: "string" },
              lists: { type: "array", items: { type: "string" } },
              tables: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                  },
                },
              },
            },
            required: ["heading", "level", "content"],
          },
        },
      },
      required: ["title", "sections"],
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { fileBase64, mimeType, filename, format, fingerprint, clientHash, language } =
      await req.json();

    if (!fileBase64 || !mimeType || !filename || !format) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (format !== "markdown" && format !== "json") {
      return new Response(JSON.stringify({ error: "format must be 'markdown' or 'json'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (fingerprint !== undefined && fingerprint !== null && fingerprint !== "") {
      if (typeof fingerprint !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(fingerprint)) {
        return new Response(JSON.stringify({ error: "Invalid fingerprint" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (clientHash !== undefined && clientHash !== null && clientHash !== "") {
      if (typeof clientHash !== "string" || !/^[a-f0-9]{16,64}$/.test(clientHash)) {
        return new Response(JSON.stringify({ error: "Invalid clientHash" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (language !== undefined && language !== null && language !== "" && !ALLOWED_LANGS.has(language)) {
      return new Response(JSON.stringify({ error: "Invalid language" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileSize = Math.floor((fileBase64.length * 3) / 4);
    const kind = detectKind(mimeType, filename);
    if (kind === "unsupported") {
      return new Response(JSON.stringify({
        error: "unsupported_format",
        message: `File type "${mimeType || filename.split(".").pop()}" is not supported. Supported: PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, HTML, JSON, JPG, PNG, WEBP.`,
      }), { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Tier resolution
    const adminToken = req.headers.get("x-admin-token");
    let isAdmin = await verifyAdminToken(adminToken);

    const internalToken = req.headers.get("x-internal-token");
    const internalClaims = internalToken ? await verifyInternalToken(internalToken) : null;

    let userId: string | null = null;
    let isPro = false;
    if (internalClaims) {
      userId = internalClaims.userId;
      isPro = true;
    } else {
      const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader);
        if (user) {
          userId = user.id;
          const [{ data: subData }, { data: subDataSandbox }, { data: adminRole }] = await Promise.all([
            supabase.rpc("has_active_subscription", { user_uuid: user.id, check_env: "live" }),
            supabase.rpc("has_active_subscription", { user_uuid: user.id, check_env: "sandbox" }),
            supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
          ]);
          isPro = !!subData || !!subDataSandbox;
          isAdmin = isAdmin || !!adminRole;
        }
      }
    }

    if (userId) {
      const { data: isBlocked } = await supabase.rpc("is_user_blocked", { _user_id: userId });
      if (isBlocked) {
        return new Response(JSON.stringify({ error: "account_blocked", message: "This account has been blocked." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const cap = (isPro || isAdmin) ? MAX_FILE_BYTES_PRO : MAX_FILE_BYTES_FREE;
    if (fileSize > cap) {
      const capMb = Math.floor(cap / (1024 * 1024));
      return new Response(JSON.stringify({
        error: "file_too_large",
        message: `File exceeds ${capMb}MB limit for your tier.`,
      }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash IP at /24 (IPv4) or /48 (IPv6) prefix so sequential VPN exit-IPs
    // in the same subnet fold into one free-tier bucket.
    const rawIp = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const ipPrefix = (() => {
      if (rawIp === "unknown") return rawIp;
      if (rawIp.includes(":")) {
        return rawIp.split(":").slice(0, 3).join(":") + "::";
      }
      const parts = rawIp.split(".");
      return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : rawIp;
    })();
    const ipHash = await sha256(ipPrefix + (Deno.env.get("HMAC_SECRET") || ""));

    // ISO-2 country. Preferred via platform headers, else free IP lookup.
    // Raw IPs are NEVER persisted.
    let country: string | null = (
      req.headers.get("cf-ipcountry") ||
      req.headers.get("x-vercel-ip-country") ||
      req.headers.get("x-country-code") ||
      ""
    ).toUpperCase().slice(0, 2) || null;
    if (!country && rawIp !== "unknown" && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fc|fd)/i.test(rawIp)) {
      country = await lookupCountry(rawIp);
    }

    // Short UA label (browser + OS) — coarse, no fingerprinting beyond UA.
    const ua = req.headers.get("user-agent") || "";
    const uaBrief = (() => {
      if (!ua) return null;
      const browser =
        /Edg\//.test(ua) ? "Edge" :
        /Chrome\//.test(ua) && !/Chromium/.test(ua) ? "Chrome" :
        /Firefox\//.test(ua) ? "Firefox" :
        /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" :
        /OPR\//.test(ua) ? "Opera" : "Other";
      const os =
        /Windows/.test(ua) ? "Win" :
        /Mac OS X|Macintosh/.test(ua) ? "macOS" :
        /Android/.test(ua) ? "Android" :
        /iPhone|iPad|iOS/.test(ua) ? "iOS" :
        /Linux/.test(ua) ? "Linux" : "Other";
      return `${browser}/${os}`;
    })();

    // Per-IP burst limiter. Admins exempt. Best-effort, in-memory per instance.
    if (!isAdmin) {
      const rl = checkRateLimit(`convert:${ipPrefix}`, RATE_LIMIT_PER_MINUTE);
      if (!rl.allowed) {
        return new Response(JSON.stringify({
          error: "rate_limited",
          message: `Too many requests. Try again in ${rl.retryAfterSec}s.`,
        }), {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(rl.retryAfterSec),
          },
        });
      }
    }

    // Pro monthly cap: PRO_MONTHLY_LIMIT conversions / rolling 30 days.
    if (isPro && !isAdmin && userId) {
      const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { count: monthCount } = await supabase
        .from("usage_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", monthStart);
      if ((monthCount || 0) >= PRO_MONTHLY_LIMIT) {
        return new Response(JSON.stringify({
          error: "monthly_limit_reached",
          message: `Pro plan: ${PRO_MONTHLY_LIMIT} conversions per month reached. Resets on a rolling 30-day window.`,
          limit: PRO_MONTHLY_LIMIT,
          used: monthCount,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Free-tier daily quota check.
    if (!isAdmin && !isPro) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let query = supabase.from("usage_log").select("id", { count: "exact", head: true }).gte("created_at", since);
      if (userId) {
        query = query.eq("user_id", userId);
      } else {
        const conds: string[] = [`ip_hash.eq.${ipHash}`];
        if (fingerprint) conds.push(`fingerprint.eq.${fingerprint}`);
        if (clientHash) conds.push(`client_hash.eq.${clientHash}`);
        query = query.or(conds.join(","));
      }
      const { count, error: quotaErr } = await query;
      if (quotaErr) {
        console.error("Quota query error:", quotaErr);
        return new Response(JSON.stringify({ error: "Quota check failed" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if ((count || 0) >= FREE_DAILY_LIMIT) {
        return new Response(JSON.stringify({
          error: "quota_exceeded",
          message: `Free tier: ${FREE_DAILY_LIMIT} conversions per day. Upgrade to Pro for unlimited.`,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── AI call setup ────────────────────────────────────────────────────────
    if (!AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY (or GEMINI_API_KEY) not configured");

    // Pro users get the higher-tier reasoning model for sharper output.
    const proTier = isPro || isAdmin;
    let model = proTier ? MODEL_PRO : MODEL_FREE;
    const langHint = languageInstruction(language);
    let systemPrompt = (format === "markdown" ? MARKDOWN_SYSTEM
      : "You are a structured document extractor. Always call the emit_document tool.") + langHint;
    const userContent: any[] = [];

    // Small files (≤2MB) use Flash (~3-10× faster); large/complex files use Pro for quality.
    const SMALL_FILE_BYTES = 2 * 1024 * 1024;
    const isSmallFile = fileSize <= SMALL_FILE_BYTES;

    if (kind === "image") {
      // Keep Pro tier on Pro for vision: OCR quality matters most.
      model = proTier ? MODEL_PRO : MODEL_FREE;
      if (format === "markdown") systemPrompt = IMAGE_MARKDOWN_SYSTEM + langHint;
      userContent.push({ type: "text", text: format === "markdown"
        ? `Analyze this image (filename: "${filename}") and produce the Markdown described in the system prompt. Run OCR carefully before describing.`
        : `Analyze this image (filename: "${filename}") and emit a structured JSON via emit_document. Use the title to summarize the image, sections for description / extracted text / tags. Run OCR carefully.` });
      userContent.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } });
    } else if (kind === "pdf") {
      // Small PDFs (≤2MB) → Flash; larger → Pro tier's choice or Flash for free users.
      model = isSmallFile
        ? MODEL_FREE
        : (proTier ? MODEL_PRO : MODEL_FREE);
      if (format === "markdown") systemPrompt = PDF_MARKDOWN_SYSTEM + langHint;
      userContent.push({ type: "text", text: format === "markdown"
        ? `Convert this PDF "${filename}" to clean, faithful Markdown following the system prompt. Preserve every piece of meaningful text, reconstruct tables with GFM pipes, and keep heading hierarchy. Output ONLY the Markdown.`
        : `Convert this PDF "${filename}" into structured JSON via emit_document. Preserve every section, table and list.` });
      userContent.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } });
    } else {
      // Text-like extraction path (text / docx / pptx / xlsx)
      let extracted: string;
      try {
        const bytes = base64ToBytes(fileBase64);
        if (kind === "text") extracted = bytesToText(bytes);
        else if (kind === "docx") extracted = await extractDocxText(bytes);
        else if (kind === "pptx") extracted = await extractPptxText(bytes);
        else if (kind === "xlsx") extracted = await extractXlsxText(bytes);
        else extracted = bytesToText(bytes);
      } catch (extractErr) {
        console.error("extract error:", extractErr);
        return new Response(JSON.stringify({
          error: "extraction_failed",
          message: `Could not read "${filename}". The file may be corrupted, password-protected, or in an unsupported variant.`,
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const MAX_CHARS = 250_000;
      let truncated = false;
      if (extracted.length > MAX_CHARS) {
        extracted = extracted.slice(0, MAX_CHARS);
        truncated = true;
      }

      const conversionHint =
        kind === "pptx"
          ? "The input is a slide deck. Each slide is already split with '## Slide N' and may include visible text, structural signals (image/table/chart counts), and speaker notes. Follow the slide-by-slide template in the system prompt EXACTLY (Purpose / Structure & layout / Content / UX-UI notes / Speaker notes), then end with the '## Deck overview' section."
          : kind === "text" && /\.html?$|\.xml$/.test(filename.toLowerCase())
          ? "The input is raw HTML/XML markup. Translate every tag into the equivalent Markdown construct (headings, paragraphs, lists, links, code, tables, blockquotes, emphasis). Strip wrapper elements and attributes. Output MUST contain no HTML tags at all."
          : kind === "text" && /\.json$|\.ya?ml$/.test(filename.toLowerCase())
          ? "The input is structured data (JSON/YAML). Render it as readable Markdown: use headings for top-level keys, lists for arrays, and tables for arrays of objects with consistent keys."
          : kind === "text" && /\.csv$|\.tsv$/.test(filename.toLowerCase())
          ? "The input is delimited tabular data. Render it as a GitHub-Flavored Markdown table, treating the first row as headers."
          : "Render the input as faithful, well-structured GitHub-Flavored Markdown.";

      if (kind === "pptx" && format === "markdown") {
        systemPrompt = DECK_MARKDOWN_SYSTEM + langHint;
      }

      userContent.push({ type: "text", text:
        `Source filename: ${filename}\nDetected type: ${kind}${truncated ? "\n(Note: input was truncated to fit context.)" : ""}\n\n` +
        (format === "markdown"
          ? `${conversionHint}\n\nInput:\n\n${extracted}`
          : `Convert the following extracted document content into structured JSON via emit_document:\n\n${extracted}`) });
    }

    const body: any = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    };
    if (format === "json") {
      body.tools = [JSON_TOOL];
      body.tool_choice = { type: "function", function: { name: "emit_document" } };
    }

    const aiResp = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Contact support." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI error:", aiResp.status, t);
      return new Response(JSON.stringify({
        error: "ai_failed",
        message: `Conversion failed for "${filename}". The AI couldn't process this file.`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiResp.json();
    let output: string;

    if (format === "markdown") {
      output = aiJson.choices?.[0]?.message?.content || "";
      if (!output.trim()) {
        return new Response(JSON.stringify({
          error: "empty_output",
          message: "The AI returned an empty result. The file may not contain readable content.",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      const args = toolCall?.function?.arguments;
      if (!args) {
        return new Response(JSON.stringify({
          error: "no_structured_output",
          message: "The AI didn't return structured JSON. Try Markdown format instead.",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const parsed = typeof args === "string" ? JSON.parse(args) : args;
      output = JSON.stringify(parsed, null, 2);
    }

    await supabase.from("usage_log").insert({
      user_id: userId,
      fingerprint: fingerprint || null,
      ip_hash: ipHash,
      client_hash: clientHash || null,
      filename,
      format,
      file_size: fileSize,
      success: true,
      country,
      user_agent_brief: uaBrief,
    });

    return new Response(JSON.stringify({
      output,
      format,
      tier: isAdmin ? "admin" : isPro ? "pro" : "free",
      model,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("convert-file error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
