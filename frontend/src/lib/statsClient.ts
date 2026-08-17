/**
 * Binds the reporter in stats.ts to the browser and to the build: where to
 * post, which build this is, and the page-lifecycle events that tell us a
 * player walked away. Everything environment-shaped lives here so stats.ts
 * stays pure and testable.
 */
import { DEFAULT_NICK, createStatsReporter, getClientId, type StatsReporter } from "./stats";

/**
 * Both fields are getters, read at send time. `webgpuOk` because the probe in
 * webgpu.ts is async and may not have answered when a game starts; `nick`
 * because the player can change their name between games without the reporter
 * being rebuilt.
 */
export function createAppReporter(sources: {
  webgpuOk: () => boolean | null;
  nick: () => string;
}): StatsReporter {
  const { webgpuOk, nick } = sources;
  const reporter = createStatsReporter({
    // Set by the Pages workflow. Empty in dev and in CI, which disables
    // reporting entirely -- local play never writes to the shared database.
    endpoint: import.meta.env.VITE_STATS_ENDPOINT ?? "",
    appVersion: __APP_VERSION__,
    clientId: getClientId(),
    webgpuOk,
    // Blank is how the setup screen says "anonymous"; the worker would default
    // it anyway, but sending the sentinel keeps the two ends reading the same.
    nick: () => nick().trim() || DEFAULT_NICK,
    beaconImpl:
      typeof navigator !== "undefined" && navigator.sendBeacon
        ? navigator.sendBeacon.bind(navigator)
        : undefined,
  });

  // Both events, because neither is enough on its own: pagehide is the reliable
  // signal on desktop, while a mobile browser can kill a backgrounded tab
  // without ever firing it. markHidden() keeps recording afterwards, so a
  // player who switches away and comes back is not written off.
  addEventListener("pagehide", () => reporter.markHidden());
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") reporter.markHidden();
  });

  return reporter;
}
