import { humanizeAlert } from "@/transit/alerts";
import { dedupeRoutes, describeRoute } from "@/transit/codes";
import type { Alert, Arrival, Bus, Feed, Health, IncomingBus, Nearby, RouteDetail, RouteRef, SearchResult, Stop, StopDetail } from "@/transit/types";
import type { z } from "zod";

import { simplify } from "@/transit/path";

import { cached, croma, isLive } from "./croma";
import * as s from "./schemas";

const MINUTE = 60_000;

/** How long a live answer may stand in for one the source failed to give. Every answer carries its own time, so the app says how old it is. */
const LIVE_GRACE_MS = 90_000;
/** Croma picks up each new TransMilenio batch within seconds, so live answers are shared for only a few. */
const LIVE_TTL_MS = 3_000;
const nearbyCache = cached<Nearby>(5 * MINUTE);
const searchCache = cached<SearchResult>(30 * MINUTE);
const stopCache = cached<z.infer<typeof s.stopLookup>>(6 * 60 * MINUTE);
const arrivalsCache = cached<z.infer<typeof s.arrivals>>(LIVE_TTL_MS, LIVE_GRACE_MS);
const alertsCache = cached<Alert[]>(2 * MINUTE);
/** A route as kept between requests: everything but what changes by the second, plus the name its hours are looked up by. */
type RouteBase = Omit<RouteDetail, "buses" | "feed" | "alerts" | "route"> & { route: RouteRef; hoursQuery: string };
const routeCache = cached<RouteBase | null>(60 * MINUTE);
const hoursCache = cached<RouteHours>(60 * MINUTE);
const busesCache = cached<{ feed: Feed; buses: Bus[] }>(LIVE_TTL_MS, LIVE_GRACE_MS);
const aroundCache = cached<z.infer<typeof s.vehicles>>(LIVE_TTL_MS, LIVE_GRACE_MS);

function toStop(raw: z.infer<typeof s.stop>): Stop {
  return {
    id: raw.stop_id,
    name: raw.name,
    kind: raw.kind === "station" ? "station" : "stop",
    lat: raw.latitude,
    lon: raw.longitude,
    accessible: raw.wheelchair_boarding === "accessible",
    distanceM: raw.distance_m == null ? null : Math.round(raw.distance_m),
    routes: dedupeRoutes(
      raw.routes.map((r) => describeRoute({ id: r.route_id, shortName: r.short_name ?? null, longName: r.long_name ?? null, system: r.system ?? null })),
    ),
  };
}

function toAlerts(raw: z.infer<typeof s.alerts>): Alert[] {
  return raw.alerts.map((a) => {
    const routes = a.routes.flatMap((r) => (r.route_code ? [r.route_code] : []));
    const { title, detail, places, note } = humanizeAlert({ effect: a.effect ?? null, description: a.description ?? null, routes });
    return { id: a.alert_id, effect: a.effect ?? "unknown", title, detail, places, note, routes, until: a.active_periods[0]?.end ?? null };
  });
}

/** Nearest first, rounded to ~50 m so riders standing on the same corner share one answer. */
export function nearby(lat: number, lon: number): Promise<Nearby> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  return nearbyCache(key, async () => {
    const data = await croma("stops-search", { latitude: lat, longitude: lon, radius_m: 700, per_page: 25 }, s.stopsSearch);
    return { stops: data.stops.map(toStop) };
  });
}

export function search(query: string): Promise<SearchResult> {
  const q = query.trim().toLowerCase();
  return searchCache(q, async () => {
    const [stops, routes] = await Promise.all([
      croma("stops-search", { query: q, per_page: 15 }, s.stopsSearch),
      croma("routes-search", { query: q, per_page: 15 }, s.routesSearch),
    ]);
    return {
      stops: stops.stops.map(toStop),
      routes: dedupeRoutes(
        routes.routes.map((r) => describeRoute({ id: r.route_id, shortName: r.short_name ?? null, longName: r.long_name ?? null, system: r.system ?? null })),
      ),
    };
  });
}

let feedDown = false;

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  const late = new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms));
  return Promise.race([work.catch(() => fallback), late]);
}

function alertsFor(filter: { stop_id: string } | { route: string }): Promise<Alert[]> {
  return within(alertsCache(JSON.stringify(filter), async () => toAlerts(await croma("alerts", filter, s.alerts))), 1200, []);
}

export async function stopDetail(stopId: string): Promise<StopDetail | null> {
  // The lookup is kept for hours, "not found" included, so after the first time this wait is free. In return, an id that is not
  // a stop costs one call instead of three: no arrivals or alerts are asked for a stop that does not exist.
  const lookup = await stopCache(stopId, () => croma("stop", { stop_id: stopId }, s.stopLookup));
  if (!lookup.found || !lookup.stop) return null;
  const stop = toStop(lookup.stop);
  const routeIds = lookup.stop.routes.map((r) => r.route_id);
  const [next, alerts, incoming] = await Promise.all([
    arrivalsCache(stopId, () => croma("stop-arrivals", { stop_id: stopId, limit: 30 }, s.arrivals)),
    alertsFor({ stop_id: stopId }),
    feedDown ? [] : within(incomingTo(stop, routeIds), 1500, []),
  ]);
  const live = isLive(next.as_of, next.live);
  feedDown = !live;

  const arrivals: Arrival[] = next.arrivals.map((a) => {
    const route = describeRoute({ id: a.route_id ?? "", shortName: a.route_code ?? null, longName: a.route_name ?? null, system: a.system ?? null });
    return {
      routeId: a.route_id ?? null,
      code: route.code,
      aliases: route.aliases,
      name: route.name,
      system: route.system,
      minutes: a.minutes_away ?? null,
      at: a.predicted_at ?? null,
      basis: a.basis,
      delaySeconds: a.delay_seconds ?? null,
      vehicle: a.vehicle_label ?? null,
      plate: a.license_plate ?? null,
    };
  });

  return {
    feed: { asOf: next.as_of, live },
    stop,
    arrivals,
    incoming,
    alerts,
  };
}

/** Buses within ~3 km on a route that serves this stop: the "which one comes first" view riders asked for. */
async function incomingTo(stop: Stop, routeIds: string[]): Promise<IncomingBus[]> {
  const serving = new Set(routeIds);
  const around = await aroundCache(`${stop.lat.toFixed(3)},${stop.lon.toFixed(3)}`, () =>
    croma("vehicles", { latitude: stop.lat, longitude: stop.lon, radius_m: 3000, per_page: 300 }, s.vehicles),
  );
  return around.vehicles
    .filter((v) => v.route_id && serving.has(v.route_id))
    .slice(0, 40)
    .map((v) => {
      const route = describeRoute({ id: v.route_id ?? "", shortName: v.route_code ?? null, longName: v.route_name ?? null, system: v.system ?? null });
      return {
        id: v.vehicle_id ?? v.label ?? `${v.latitude},${v.longitude}`,
        lat: v.latitude,
        lon: v.longitude,
        nextStop: v.stop_name ?? null,
        plate: v.license_plate ?? null,
        reportedAt: v.reported_at ?? null,
        code: route.code,
        system: route.system,
      };
    });
}

type RouteHours = Pick<RouteDetail["route"], "firstDeparture" | "lastDeparture" | "tripsPerWeek">;
const NO_HOURS: RouteHours = { firstDeparture: null, lastDeparture: null, tripsPerWeek: null };
const HOURS_RETRY_MS = MINUTE;
const hoursFailedAt = new Map<string, number>();
/** When each route's vehicles last answered, as the feed stamped it. A failed request reports this time, never the current one. */
const vehiclesAsOf = new Map<string, string>();

/**
 * First and last bus, kept apart from the route itself. When this answer is slow the screen opens without it, but only this once:
 * inside the route it was kept for the whole hour, blank. A late answer still lands in the cache for the next rider.
 */
function hoursOf(routeId: string, query: string): Promise<RouteHours> {
  if (!query) return Promise.resolve(NO_HOURS);
  // An open route asks again every few seconds. After a failed lookup the hours stay blank for a minute instead of asking Croma each time.
  const failedAt = hoursFailedAt.get(routeId);
  if (failedAt !== undefined && Date.now() - failedAt < HOURS_RETRY_MS) return Promise.resolve(NO_HOURS);
  const load = hoursCache(routeId, async () => {
    const found = await croma("routes-search", { query, per_page: 10 }, s.routesSearch).catch((error: unknown) => {
      hoursFailedAt.set(routeId, Date.now());
      if (hoursFailedAt.size > 2_000) hoursFailedAt.delete(hoursFailedAt.keys().next().value as string);
      throw error;
    });
    hoursFailedAt.delete(routeId);
    const own = found.routes.find((x) => x.route_id === routeId);
    return {
      firstDeparture: own?.first_departure?.slice(0, 5) ?? null,
      lastDeparture: own?.last_departure?.slice(0, 5) ?? null,
      tripsPerWeek: own?.trips_per_week ?? null,
    };
  });
  return within(load, 1500, NO_HOURS);
}

async function loadRoute(routeId: string): Promise<RouteBase | null> {
  const data = await croma("route", { route_id: routeId, include_geometry: true }, s.route);
  if (!data.found || !data.route) return null;
  const r = data.route;
  const main = [...r.patterns].sort((a, b) => b.trips_per_week - a.trips_per_week)[0];
  const ref = describeRoute({ id: r.route_id, shortName: r.short_name ?? null, longName: r.long_name ?? null, system: r.system ?? null });

  return {
    route: ref,
    hoursQuery: r.short_name ?? "",
    path: (main?.geometry?.coordinates ?? []).map((c) => [c[0], c[1]] as [number, number]),
    patterns: [...r.patterns]
      .sort((a, b) => b.trips_per_week - a.trips_per_week)
      .slice(0, 4)
      .map((pt) => ({ path: simplify((pt.geometry?.coordinates ?? []).map((c) => [c[0], c[1]] as [number, number]), 6), stops: pt.stops.map((st) => st.stop_id) })),
    stops: (main?.stops ?? []).flatMap((st) =>
      st.latitude == null || st.longitude == null ? [] : [{ id: st.stop_id, name: st.name ?? "Paradero", lat: st.latitude, lon: st.longitude }],
    ),
  };
}

function busesOn(code: string) {
  return busesCache(code, async () => {
    const first = await croma("vehicles", { route: code, per_page: 200 }, s.vehicles);
    const rest = await Promise.all(
      Array.from({ length: Math.min(first.total_pages, 4) - 1 }, (_, i) => croma("vehicles", { route: code, per_page: 200, page: i + 2 }, s.vehicles)),
    );
    const buses = [first, ...rest].flatMap((page) =>
      page.vehicles.map((v) => ({
        id: v.vehicle_id ?? v.label ?? `${v.latitude},${v.longitude}`,
        lat: v.latitude,
        lon: v.longitude,
        nextStop: v.stop_name ?? null,
        plate: v.license_plate ?? null,
        reportedAt: v.reported_at ?? null,
      })),
    );
    vehiclesAsOf.set(code, first.as_of);
    if (vehiclesAsOf.size > 2_000) vehiclesAsOf.delete(vehiclesAsOf.keys().next().value as string);
    return { feed: { asOf: first.as_of, live: isLive(first.as_of, first.live) }, buses };
  });
}

export async function routeDetail(routeId: string): Promise<RouteDetail | null> {
  // "Not found" is kept like any answer, so asking again for a route that does not exist does not reach Croma every time.
  const base = await routeCache(routeId, () => loadRoute(routeId));
  if (!base) return null;
  const { route, hoursQuery, ...rest } = base;

  const code = route.feedCode;
  const [{ feed, buses }, alerts, hours] = await Promise.all([
    // The line, its stops and its hours are still worth showing when the vehicles are not: the screen then says there is no live data
    // since the last time they did answer. With no such time on this instance, the request fails as before rather than invent one.
    busesOn(code).catch((error: unknown): { feed: Feed; buses: Bus[] } => {
      const asOf = vehiclesAsOf.get(code);
      if (!asOf) throw error;
      console.error("[route]", code, "vehicles unavailable", error instanceof Error ? error.message : error);
      return { feed: { asOf, live: false }, buses: [] };
    }),
    alertsFor({ route: code }),
    hoursOf(routeId, hoursQuery),
  ]);
  return { ...rest, route: { ...route, ...hours }, feed, buses, alerts };
}

export async function health(): Promise<Health> {
  const { feed } = await busesCache("__health", async () => {
    const data = await croma("vehicles", { per_page: 1 }, s.vehicles);
    return { feed: { asOf: data.as_of, live: isLive(data.as_of, data.live) }, buses: [] };
  });
  return { feed };
}
