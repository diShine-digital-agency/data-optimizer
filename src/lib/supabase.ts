import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !anon) {
  // Fail loud in dev — silent misconfig leads to hard-to-debug 401s.
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing — see .env.example",
  );
}

export const supabase = createClient(url ?? "", anon ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type SupabaseClient = typeof supabase;
