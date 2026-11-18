/** Routes the rider chose to see at a stop. Empty means every route. */
export type RouteFilter = readonly string[];

/** Keeps only the chosen routes that still arrive; a route that left must not empty the list. */
export function activeRoutes(chosen: RouteFilter, available: readonly string[]): string[] {
  return chosen.filter((code) => available.includes(code));
}

/** Whether an arrival on `code` is shown under the filter. */
export function isShown(active: RouteFilter, code: string): boolean {
  return active.length === 0 || active.includes(code);
}

/** Adds or removes `code`. Choosing every route is the same as choosing none: back to "All". */
export function toggleRoute(chosen: RouteFilter, code: string, available: readonly string[]): string[] {
  const active = activeRoutes(chosen, available);
  const next = active.includes(code) ? active.filter((c) => c !== code) : [...active, code];
  return next.length === available.length ? [] : next;
}
