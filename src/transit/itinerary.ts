/**
 * From RAPTOR journeys to options a rider can follow: alternatives, sanity checks that refuse
 * anything absurd, live retiming of the first bus, and Bogotá's clock. Pure.
 */
import { activeServices, departure, metres, stopsNear, type Network } from "./network.ts";
import { dayTimetable, MAX_RIDES, raptor, SAME_STOP_TRANSFER_S, type DayTimetable, type Endpoint, type Journey, type RideLeg } from "./raptor.ts";

export const WALK_MPS = 1.25;
export const DETOUR = 1.3;
export const ACCESS_M = 800;
export const ACCESS_FALLBACK_M = 1500;
export const STATION_ACCESS_S = 180;
/** Closer than this, walking is the answer. */
export const WALK_ONLY_M = 900;
const MAX_WALK_M = 2500;
const MAX_TRIP_S = 4.5 * 3600;
/** Nobody should be told to stand at a stop for an hour halfway through a trip. */
const MAX_TRANSFER_WAIT_S = 60 * 60;
/** A ride that ends where it started is a trick of the data, not a trip. */
const MIN_RIDE_M = 150;
const MAX_DETOUR = 2.5;
const ALTERNATIVE_WINDOW_S = 45 * 60;

export interface Point {
  lat: number;
  lon: number;
}

/** Bogotá runs on UTC−5 all year. */
export interface ServiceClock {
  yyyymmdd: number;
  weekday: number;
  seconds: number;
  previous: { yyyymmdd: number; weekday: number };
}

export function bogotaClock(instant: Date): ServiceClock {
  const local = new Date(instant.getTime() - 5 * 3600_000);
  const day = (d: Date) => d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const before = new Date(local.getTime() - 86_400_000);
  return {
    yyyymmdd: day(local),
    weekday: local.getUTCDay(),
    seconds: local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds(),
    previous: { yyyymmdd: day(before), weekday: before.getUTCDay() },
  };
}

export function timetableFor(net: Network, clock: ServiceClock): DayTimetable {
  return dayTimetable(net, activeServices(net, clock.yyyymmdd, clock.weekday), activeServices(net, clock.previous.yyyymmdd, clock.previous.weekday));
}

const walkSeconds = (m: number) => Math.round((m * DETOUR) / WALK_MPS);

/** Stops a rider can walk to from a point, with the time to get into a TransMilenio station. */
export function endpoints(net: Network, p: Point, accessibleOnly = false): { stops: Endpoint[]; radius: number } {
  for (const radius of [ACCESS_M, ACCESS_FALLBACK_M]) {
    const stops = stopsNear(net, p.lat, p.lon, radius)
      .filter((s) => net.stopGroups[s.stop].length > 0 && (!accessibleOnly || net.accessible[s.stop] === 1))
      .map((s) => ({ stop: s.stop, walk: walkSeconds(s.metres) + (net.kind[s.stop] === "troncal" ? STATION_ACCESS_S : 0) }));
    if (stops.length >= 2 || radius === ACCESS_FALLBACK_M) return { stops, radius };
  }
  return { stops: [], radius: ACCESS_FALLBACK_M };
}

const rides = (j: Journey) => j.legs.filter((l): l is RideLeg => l.kind === "ride");
const routeOf = (net: Network, leg: RideLeg) => net.patternRoute[net.groupPattern[leg.group]];
const signature = (net: Network, j: Journey) => rides(j).map((l) => routeOf(net, l)).join(">");

/** Metres walked in a journey, from its walk legs. */
export function walkedMetres(net: Network, j: Journey, from: Point, to: Point): number {
  let total = 0;
  for (const l of j.legs) {
    if (l.kind !== "walk") continue;
    const a = l.from < 0 ? from : { lat: net.lat[l.from], lon: net.lon[l.from] };
    const b = l.to < 0 ? to : { lat: net.lat[l.to], lon: net.lon[l.to] };
    total += metres(a.lat, a.lon, b.lat, b.lon);
  }
  return Math.round(total);
}

/** Reasons a journey must not be shown. Empty means it is sane. */
export function problems(net: Network, j: Journey, from: Point, to: Point): string[] {
  const out: string[] = [];
  const direct = metres(from.lat, from.lon, to.lat, to.lon);
  let ridden = 0;
  let last = -Infinity;
  let previousRoute = -1;
  let rides = 0;
  for (const l of j.legs) {
    if (l.departs < last - 1) out.push("time goes backwards");
    if (l.arrives < l.departs) out.push("leg ends before it starts");
    if (l.kind === "ride" && rides > 0 && l.departs - last > MAX_TRANSFER_WAIT_S) out.push("waits over an hour between vehicles");
    last = l.arrives;
    if (l.kind !== "ride") continue;
    rides++;
    if (l.toPosition <= l.fromPosition) out.push("ride goes nowhere");
    if (metres(net.lat[l.from], net.lon[l.from], net.lat[l.to], net.lon[l.to]) < MIN_RIDE_M) out.push("ride ends where it started");
    const route = routeOf(net, l);
    if (route === previousRoute) out.push("gets off and back on the same route");
    previousRoute = route;
    const stops = net.patternStops[net.groupPattern[l.group]];
    for (let i = l.fromPosition + 1; i <= l.toPosition; i++) {
      ridden += metres(net.lat[stops[i - 1]], net.lon[stops[i - 1]], net.lat[stops[i]], net.lon[stops[i]]);
    }
  }
  if (walkedMetres(net, j, from, to) > MAX_WALK_M) out.push("too much walking");
  if (ridden > direct * MAX_DETOUR + 3000) out.push("detour far longer than the trip");
  if (j.arrives - j.departs > MAX_TRIP_S) out.push("longer than four and a half hours");
  return out;
}

export interface Option {
  journey: Journey;
  /** Why it is on the list. */
  reason: "fastest" | "fewer_transfers" | "next_departure" | "alternative";
  walkMetres: number;
}

/**
 * Orders options by arrival and drops any that another option beats on arrival, vehicles and
 * walking at once, unless it leaves later (then it is "the next one"). Reasons are set last.
 */
export function rank<T extends Option>(list: T[], limit = 3): T[] {
  const sorted = [...list].sort((a, b) => a.journey.arrives - b.journey.arrives || a.journey.rides - b.journey.rides || a.walkMetres - b.walkMetres);
  const kept: T[] = [];
  for (const o of sorted) {
    const beaten = kept.some((k) => k.journey.arrives <= o.journey.arrives && k.journey.rides <= o.journey.rides && k.walkMetres <= o.walkMetres);
    const later = kept.every((k) => o.journey.departs > k.journey.departs + 120);
    if (beaten && !later) continue;
    kept.push(o);
    if (kept.length === limit) break;
  }
  const best = kept[0];
  return kept.map((o, i) => ({
    ...o,
    reason:
      i === 0
        ? "fastest"
        : o.journey.rides < best.journey.rides
          ? "fewer_transfers"
          : o.journey.departs > best.journey.departs + 60
            ? "next_departure"
            : "alternative",
  }));
}

/**
 * Up to `limit` sane options: the Pareto set (arrival vs vehicles), then later departures of the
 * best one so the rider sees what comes next.
 */
export function options(net: Network, day: DayTimetable, from: Point, to: Point, departAt: number, accessibleOnly = false, limit = 3): Option[] {
  const origin = endpoints(net, from, accessibleOnly).stops;
  const destination = endpoints(net, to, accessibleOnly).stops;
  if (!origin.length || !destination.length) return [];
  const query = { origin, destination, maxRides: MAX_RIDES, accessibleOnly };

  const sane = (js: Journey[]) => js.filter((j) => j.rides > 0 && problems(net, j, from, to).length === 0);
  const pareto = sane(raptor(net, day, { ...query, departAt }));
  if (!pareto.length) return [];

  const found: Option[] = [];
  const seen = new Set<string>();
  const add = (j: Journey, reason: Option["reason"]) => {
    const key = signature(net, j);
    if (seen.has(key) || found.length >= limit + 2) return;
    seen.add(key);
    found.push({ journey: j, reason, walkMetres: walkedMetres(net, j, from, to) });
  };

  const fastest = pareto[pareto.length - 1];
  add(fastest, "fastest");
  for (let i = pareto.length - 2; i >= 0; i--) {
    // Fewer vehicles is worth it only if it does not cost more than 15 minutes
    if (pareto[i].arrives - fastest.arrives <= 15 * 60) add(pareto[i], "fewer_transfers");
  }

  let after = rides(fastest)[0].departs - (fastest.legs[0].arrives - fastest.legs[0].departs) + 60;
  for (let tries = 0; found.length < limit && tries < 4 && after - departAt < ALTERNATIVE_WINDOW_S; tries++) {
    const later = sane(raptor(net, day, { ...query, departAt: after }));
    const best = later[later.length - 1];
    if (!best) break;
    add(best, "next_departure");
    after = rides(best)[0].departs - (best.legs[0].arrives - best.legs[0].departs) + 60;
  }
  return rank(found, limit);
}

/** First departure at or after `from` seconds that reaches the destination, for "no service now". */
export function firstService(net: Network, day: DayTimetable, from: Point, to: Point, after: number, accessibleOnly = false): Option[] {
  for (let t = after; t < after + 8 * 3600; t += 30 * 60) {
    const found = options(net, day, from, to, t, accessibleOnly, 1);
    if (found.length) return found;
  }
  return [];
}

export interface LiveDeparture {
  /** Seconds of the service day the vehicle is predicted to leave the stop. */
  departs: number;
}

/**
 * Moves the first ride to a live prediction and re-checks every later connection against the
 * timetable. Returns null when a later connection can no longer be made.
 */
export function retime(net: Network, day: DayTimetable, j: Journey, live: LiveDeparture, departAt: number): Journey | null {
  const first = j.legs.findIndex((l) => l.kind === "ride");
  if (first !== 1) return null;
  const ride = j.legs[first] as RideLeg;
  const access = j.legs[0].arrives - j.legs[0].departs;
  if (live.departs < departAt + access) return null;
  const legs = j.legs.map((l) => ({ ...l }));
  legs[0].departs = live.departs - access;
  legs[0].arrives = live.departs;
  const shifted = legs[first] as RideLeg;
  const duration = ride.arrives - ride.departs;
  shifted.departs = live.departs;
  shifted.arrives = live.departs + duration;
  let clock = shifted.arrives;
  let lastWasRide = true;
  for (let i = first + 1; i < legs.length; i++) {
    const l = legs[i];
    if (l.kind === "walk") {
      const span = l.arrives - l.departs;
      l.departs = clock;
      l.arrives = clock + span;
      clock = l.arrives;
      lastWasRide = false;
      continue;
    }
    const need = clock + (lastWasRide ? SAME_STOP_TRANSFER_S : 0);
    const trips = day.trips[l.group];
    let found = -1;
    for (let t = 0; t < trips.length; t++) {
      if (departure(net, l.group, trips[t], l.fromPosition) - day.shift[l.group][t] >= need) {
        found = t;
        break;
      }
    }
    if (found < 0) return null;
    l.trip = trips[found];
    l.departs = departure(net, l.group, trips[found], l.fromPosition) - day.shift[l.group][found];
    l.arrives = departure(net, l.group, trips[found], l.toPosition) - day.shift[l.group][found];
    clock = l.arrives;
    lastWasRide = true;
  }
  return { ...j, legs, departs: legs[0].departs, arrives: clock };
}
