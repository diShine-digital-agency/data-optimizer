import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";

export default function Auth() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/account" },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <section className="container mx-auto max-w-md py-12">
      <h1 className="mb-6 text-4xl">{t("auth.title")}</h1>
      {sent ? (
        <p className="text-muted-foreground">{t("auth.sent")}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm">
            {t("auth.email")}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
          >
            {t("auth.sendLink")}
          </button>
        </form>
      )}
    </section>
  );
}
