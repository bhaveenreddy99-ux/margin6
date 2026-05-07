/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (required for real auth/data; dev has local fallbacks). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (public) key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** When "true", forces legacy count UI (disables Universal count input). */
  readonly VITE_FORCE_OLD_COUNT_UI?: string;
  /** Debounce for auto-save on count fields (ms). Default 1000. */
  readonly VITE_COUNT_SAVE_DEBOUNCE_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
