#!/usr/bin/env node
/**
 * i18n-check — verify that en/it/fr share the same key set.
 *
 * Exits 0 if all three JSON files have identical keys; exits 1 otherwise,
 * printing a diff of what's missing or extra per locale.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const locales = ["en", "it", "fr"];
const files = Object.fromEntries(
  locales.map((l) => [l, JSON.parse(readFileSync(resolve(root, `src/i18n/${l}.json`), "utf8"))]),
);

function flatten(obj, prefix = "") {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const sub of flatten(v, key)) out.add(sub);
    } else {
      out.add(key);
    }
  }
  return out;
}

const keysets = Object.fromEntries(locales.map((l) => [l, flatten(files[l])]));
const canonical = keysets.en;

let ok = true;
for (const l of locales) {
  if (l === "en") continue;
  const missing = [...canonical].filter((k) => !keysets[l].has(k));
  const extra = [...keysets[l]].filter((k) => !canonical.has(k));
  if (missing.length || extra.length) {
    ok = false;
    console.error(`\n[${l}] mismatch vs en:`);
    if (missing.length) console.error("  missing:", missing.join(", "));
    if (extra.length) console.error("  extra:  ", extra.join(", "));
  }
}

if (ok) {
  console.log(`i18n OK — ${canonical.size} keys across ${locales.join(", ")}`);
  process.exit(0);
}
process.exit(1);
