import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { convertFile, fetchUrl, type Format } from "@/lib/convert";
import { getClientHash, getFingerprint } from "@/lib/fingerprint";

export default function Home() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>("markdown");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  const language = (i18n.language as "en" | "it" | "fr") ?? "en";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !url) return;
    setBusy(true);
    setOutput("");
    try {
      const [fingerprint, clientHash] = await Promise.all([
        getFingerprint(),
        Promise.resolve(getClientHash()),
      ]);
      const res = file
        ? await convertFile({ file, format, language, fingerprint, clientHash })
        : await fetchUrl({ url, format, language, fingerprint, clientHash });
      setOutput(res.output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast.error(msg || t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="container mx-auto max-w-3xl py-12">
      <h1 className="mb-2 text-5xl">{t("home.tagline")}</h1>
      <p className="mb-8 text-muted-foreground">{t("home.subtagline")}</p>

      <form onSubmit={onSubmit} className="manuscript-card space-y-4 p-6">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
          aria-label="file input"
        />
        <div className="text-center text-xs uppercase text-muted-foreground">or</div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
        />

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="format"
              checked={format === "markdown"}
              onChange={() => setFormat("markdown")}
            />
            {t("home.format.markdown")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="format"
              checked={format === "json"}
              onChange={() => setFormat("json")}
            />
            {t("home.format.json")}
          </label>
        </div>

        <button
          type="submit"
          disabled={busy || (!file && !url)}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "…" : t("home.convert")}
        </button>
      </form>

      {output ? (
        <pre className="mt-8 whitespace-pre-wrap rounded-lg border border-border bg-muted p-4 font-mono text-sm">
          {output}
        </pre>
      ) : null}
    </section>
  );
}
