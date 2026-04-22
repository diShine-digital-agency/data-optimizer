/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_DEFAULT_LOCALE?: "en" | "it" | "fr";
  readonly VITE_STRIPE_PRICE_PRO_MONTHLY?: string;
  readonly VITE_STRIPE_PRICE_PRO_YEARLY?: string;
  readonly VITE_ANALYTICS_SRC?: string;
  readonly VITE_ANALYTICS_DATA_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
