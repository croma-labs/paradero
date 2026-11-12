import type { Arrival } from "./types";

/**
 * Minutes until the bus, counted on the phone from its predicted time so they keep falling between refreshes.
 * The server's `minutes` was right when Croma answered, which can be most of a minute ago after the caches.
 */
export function minutesLeft(a: Pick<Arrival, "minutes" | "at">, now = Date.now()): number | null {
  const at = a.at ? Date.parse(a.at) : NaN;
  return Number.isNaN(at) ? a.minutes : Math.max(0, Math.floor((at - now) / 60_000));
}
