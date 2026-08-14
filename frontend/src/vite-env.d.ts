/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Injected by vite.config.ts: the git sha this bundle was built from. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /**
   * Full URL of the stats worker's POST endpoint. Set by the Pages workflow;
   * empty everywhere else, which disables reporting.
   */
  readonly VITE_STATS_ENDPOINT?: string;
}
