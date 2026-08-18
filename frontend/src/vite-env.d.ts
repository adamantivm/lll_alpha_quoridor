/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Injected by vite.config.ts: the git sha this bundle was built from. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /**
   * Full URL of the stats worker's /v1/games collection. Set by the Pages
   * workflow; empty everywhere else, which disables reporting and leaves the
   * stats page saying it has nothing to read.
   *
   * The play page POSTs game records to it; the stats page GETs the list from
   * it and one game from `${VITE_STATS_ENDPOINT}/{game_id}`.
   */
  readonly VITE_STATS_ENDPOINT?: string;
}
