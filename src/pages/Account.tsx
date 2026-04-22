import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export default function Account() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!user) {
    return (
      <section className="container mx-auto max-w-2xl py-12">
        <h1 className="mb-4 text-4xl">{t("account.title")}</h1>
        <p className="text-muted-foreground">Please sign in first.</p>
      </section>
    );
  }

  return (
    <section className="container mx-auto max-w-2xl py-12">
      <h1 className="mb-4 text-4xl">{t("account.title")}</h1>
      <p className="mb-6 text-muted-foreground">
        {t("account.signedInAs", { email: user.email ?? "" })}
      </p>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="rounded border border-border px-3 py-1.5 text-sm"
      >
        {t("account.signOut")}
      </button>
    </section>
  );
}
