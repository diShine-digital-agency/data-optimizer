import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";

export default function Admin() {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        magicLink?: string;
        token?: string;
      }>("ops-unlock", { body: { password } });
      if (error) throw error;
      if (data?.magicLink) {
        window.location.href = data.magicLink;
        return;
      }
      toast.success("Access granted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Access denied");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="container mx-auto max-w-md py-12">
      <h1 className="mb-6 text-4xl">{t("ops.title")}</h1>
      <form onSubmit={onUnlock} className="space-y-4">
        <label className="block text-sm">
          {t("ops.password")}
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "…" : t("ops.unlock")}
        </button>
      </form>
    </section>
  );
}
