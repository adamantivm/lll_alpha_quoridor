/**
 * Binds the reporter in stats.ts to the browser and to the build: where to
 * post, which build this is, and the page-lifecycle events that tell us a
 * player walked away. Everything environment-shaped lives here so stats.ts
 * stays pure and testable.
 */
import { DEFAULT_NICK, createStatsReporter, getClientId, type StatsReporter } from "./stats";

/**
 * `webgpuOk` is a getter because the probe in webgpu.ts is async: the first
 * game starts before it answers, and the record is rewritten on every move
 * anyway, so a live read gets the right value onto all but the first write.
 */
export function createAppReporter(webgpuOk: () => boolean | null): StatsReporter {
  const reporter = createStatsReporter({
    // Set by the Pages workflow. Empty in dev and in CI, which disables
    // reporting entirely -- local play never writes to the shared database.
    endpoint: import.meta.env.VITE_STATS_ENDPOINT ?? "",
    appVersion: __APP_VERSION__,
    clientId: getClientId(),
    webgpuOk,
    // Where the nick UI will hook in: point this at whatever holds the player's
    // chosen name and every write, including mid-game ones, picks it up.
    nick: () => DEFAULT_NICK,
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
