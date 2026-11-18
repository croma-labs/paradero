import { humanizeAlert } from "@/transit/alerts";
import { describeRoute } from "@/transit/codes";
import {
  bogotaClock,
  firstService,
  options as planOptions,
  problems,
  rank,
  retime,
  timetableFor,
  WALK_ONLY_M,
  type Option,
  type Point,
  type ServiceClock,
} from "@/transit/itinerary";
import { activeServices, decodeNetwork, metres, type Network, type NetworkFile } from "@/transit/network";
import { decodePlaces, resolve, type Candidate, type Nearby, type Places, type PlacesFile } from "@/transit/places";
import type { DayTimetable, RideLeg } from "@/transit/raptor";
import type { RouteRef } from "@/transit/types";

import { cached, croma, CromaError, isLive } from "./croma";
import * as s from "./schemas";

const LIVE_WAIT_MS = 1500;
/** Live predictions only describe now: a trip planned for later is all timetable. */
const LIVE_WINDOW_MS = 20 * 60_000;
/** A prediction is for the planned bus when its own timetable time (predicted minus delay) is this close to the planned one. */
const SAME_TRIP_S = 90;
/** A first bus further away than this is not "now". */
const LONG_WAIT_S = 60 * 60;

/** Where the deployed API serves public/network (app.json → expo-router origin). Override with PARADERO_NETWORK_URL. */
const CANONICAL_ORIGIN = "https://paradero.expo.app";

let loading: Promise<{ net: Network; places: Places }> | null = null;

// ---------- Place ids ----------

/**
 * Place ids leave the server signed, so plan_trip only plans between places resolve_place (or
 * /api/places) actually returned, never ids an assistant made up.
 */
const encoder = new TextEncoder();
let signingKey: Promise<CryptoKey> | null = null;
function key(): Promise<CryptoKey> {
  const secret = process.env.PARADERO_PLACE_SECRET ?? process.env.CROMA_API_KEY ?? "paradero-development-only";
  signingKey ??= crypto.subtle.importKey("raw", encoder.encode(`paradero-place:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return signingKey;
}

async function signature(id: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), encoder.encode(id)));
  return btoa(String.fromCharCode(...mac.subarray(0, 12)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function seal(id: string): Promise<string> {
  return `${id}~${await signature(id)}`;
}

/** The place id inside a sealed id, or null when it was not issued by this server. */
export async function unseal(sealed: string): Promise<string | null> {
  const at = sealed.lastIndexOf("~");
  if (at < 0) return null;
  const id = sealed.slice(0, at);
  const given = sealed.slice(at + 1);
  const expected = await signature(id);
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? id : null;
}

/**
 * The network and places files are static assets next to the API (public/network), built by
 * scripts/build-network.ts and scripts/build-places.ts. Loaded once per server instance.
 */
export function data(origin: string): Promise<{ net: Network; places: Places }> {
  loading ??= (async () => {
    // Never trust the request's Host for where the data comes from: only on a developer's machine
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const base = process.env.PARADERO_NETWORK_URL ?? (local ? `${origin}/network` : `${CANONICAL_ORIGIN}/network`);
    const [n, p] = await Promise.all([fetch(`${base}/bogota.json`), fetch(`${base}/places.json`)]);
    if (!n.ok || !p.ok) throw new CromaError("planner_unavailable", "The trip planner data is not deployed.", 503);
    return { net: decodeNetwork((await n.json()) as NetworkFile), places: decodePlaces((await p.json()) as PlacesFile) };
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

const days = new Map<number, DayTimetable>();
function timetable(net: Network, clock: ServiceClock): DayTimetable {
  let day = days.get(clock.yyyymmdd);
  if (!day) {
    if (days.size > 3) days.clear();
    day = timetableFor(net, clock);
    days.set(clock.yyyymmdd, day);
  }
  return day;
}

// ---------- Places ----------

export async function findPlace(origin: string, query: string): Promise<{ candidates: Candidate[] } | { error: string }> {
  const { net, places } = await data(origin);
  const r = resolve(net, places, query);
  if ("error" in r) return r;
  return { candidates: await Promise.all(r.candidates.map(async (c) => ({ ...c, id: await seal(c.id) }))) };
}

// ---------- Plan ----------

export type System = "troncal" | "dual" | "alimentador" | "zonal_urbano" | "zonal_complementario" | "zonal_especial" | "transmicable" | "other";

/** What riders call each part of the system. TransMilenio and SITP are never mixed up. */
export const SYSTEM_NAME: Record<System, string> = {
  troncal: "TransMilenio",
  dual: "TransMilenio dual",
  alimentador: "Alimentador de TransMilenio",
  zonal_urbano: "SITP urbano",
  zonal_complementario: "SITP complementario",
  zonal_especial: "SITP especial",
  transmicable: "TransMiCable",
  other: "Bus",
};

export interface PlaceSummary {
  id: string;
  label: string;
  kind: string;
  near: Nearby;
}

export interface WalkStep {
  type: "walk";
  from: string;
  to: string;
  departs: string;
  arrives: string;
  minutes: number;
  metres: number;
}

export interface RideStep {
  type: "ride";
  system: System;
  systemName: string;
  route: Pick<RouteRef, "id" | "code" | "aliases" | "name">;
  board: { stopId: string; name: string; code: string | null; where: "estación" | "paradero" };
  alight: { stopId: string; name: string; where: "estación" | "paradero" };
  departs: string;
  arrives: string;
  /** "live" only for a departure TransMilenio is predicting right now. */
  departureBasis: "live" | "scheduled";
  minutes: number;
  stops: number;
  waitMinutes: number;
  alerts: { title: string; detail: string }[];
}

export interface PlannedOption {
  reason: Option["reason"];
  leave: string;
  arrive: string;
  minutes: number;
  transfers: number;
  walkMetres: number;
  steps: (WalkStep | RideStep)[];
}

export interface PlanResult {
  status: "ok" | "walk" | "no_service_now" | "no_route";
  notice: string | null;
  network: { asOf: string };
  feed: { live: boolean; asOf: string | null };
  from: PlaceSummary;
  to: PlaceSummary;
  departAt: string;
  walk: { minutes: number; metres: number } | null;
  options: PlannedOption[];
}

export type PlanInput = { from: string; to: string; at?: string; accessible?: boolean };

const iso = (clock: ServiceClock, secondsOfDay: number) => {
  const y = Math.floor(clock.yyyymmdd / 10_000);
  const m = Math.floor((clock.yyyymmdd % 10_000) / 100);
  const d = clock.yyyymmdd % 100;
  // Service-day seconds past 24:00 are the next morning; Date.UTC rolls the day over
  return new Date(Date.UTC(y, m - 1, d, 5, 0, secondsOfDay)).toISOString();
};

async function onePlace(net: Network, places: Places, sealed: string): Promise<{ point: Point; summary: PlaceSummary } | { error: string }> {
  const id = await unseal(sealed);
  if (!id || !/^(geo|stop|place|addr):/.test(id)) return { error: `"${sealed}" is not a place id from resolve_place. Resolve the place first and confirm it with the rider.` };
  const r = resolve(net, places, id);
  if ("error" in r) return r;
  if (r.candidates.length !== 1) return { error: `"${id}" matches ${r.candidates.length} places. Ask the rider which one.` };
  const c = r.candidates[0];
  return { point: { lat: c.lat, lon: c.lon }, summary: { id: sealed, label: c.label, kind: c.kind, near: c.near } };
}

/** "2026-11-11T07:30" or with an offset; a time without one is Bogotá time, a bare date is refused. */
function parseAt(at: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:\d{2})?$/.exec(at.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}${m[2] ?? "-05:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const where = (net: Network, stop: number) => (net.kind[stop] === "street" ? "paradero" : "estación");

type Arrivals = Awaited<ReturnType<typeof liveArrivals>>;
const arrivalsCache = cached<{
  as_of: string;
  live?: boolean;
  arrivals: { route_id?: string | null; predicted_at?: string | null; basis: string; delay_seconds?: number | null }[];
}>(15_000);
function liveArrivals(stopId: string) {
  return arrivalsCache(stopId, () => croma("stop-arrivals", { stop_id: stopId, limit: 30 }, s.arrivals));
}

const alertsCache = cached<{ title: string; detail: string }[]>(2 * 60_000);
function routeAlerts(code: string) {
  return alertsCache(code, async () => {
    const raw = await croma("alerts", { route: code }, s.alerts);
    return raw.alerts.map((a) => {
      const h = humanizeAlert({ effect: a.effect ?? null, description: a.description ?? null, routes: a.routes.flatMap((r) => (r.route_code ? [r.route_code] : [])) });
      return { title: h.title, detail: h.detail };
    });
  });
}

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  const late = new Promise<T>((done) => setTimeout(() => done(fallback), ms));
  return Promise.race([work.catch(() => fallback), late]);
}

export async function plan(origin: string, input: PlanInput): Promise<PlanResult | { error: string }> {
  const { net, places } = await data(origin);
  const from = await onePlace(net, places, input.from);
  if ("error" in from) return { error: `Origin: ${from.error}` };
  const to = await onePlace(net, places, input.to);
  if ("error" in to) return { error: `Destination: ${to.error}` };
  if (from.summary.id === to.summary.id) return { error: "Origin and destination are the same place." };

  const when = input.at ? parseAt(input.at) : new Date();
  if (!when) return { error: "at must be a date and time like 2026-11-11T07:30 (Bogotá time) or with an offset." };
  const clock = bogotaClock(when);
  const day = timetable(net, clock);
  const accessible = input.accessible ?? false;
  const direct = metres(from.point.lat, from.point.lon, to.point.lat, to.point.lon);
  const walkMinutes = Math.round((direct * 1.3) / 1.25 / 60);

  const base: Omit<PlanResult, "status" | "notice" | "options"> = {
    network: { asOf: net.asOf },
    feed: { live: false, asOf: null },
    from: from.summary,
    to: to.summary,
    departAt: iso(clock, clock.seconds),
    walk: direct <= WALK_ONLY_M * 2 ? { minutes: walkMinutes, metres: Math.round(direct * 1.3) } : null,
  };

  if (direct <= WALK_ONLY_M) {
    return { ...base, status: "walk", notice: `Queda a unos ${walkMinutes} minutos a pie: no vale la pena tomar bus.`, options: [] };
  }

  if (!activeServices(net, clock.yyyymmdd, clock.weekday).size) {
    return { ...base, status: "no_route", notice: "TransMilenio no ha publicado horario para esa fecha, así que no puedo planear ese viaje todavía.", options: [] };
  }

  let found = planOptions(net, day, from.point, to.point, clock.seconds, accessible);
  let status: PlanResult["status"] = "ok";
  let notice: string | null = null;
  if (!found.length) {
    found = firstService(net, day, from.point, to.point, clock.seconds, accessible);
    if (!found.length) {
      const tomorrow = bogotaClock(new Date(when.getTime() + 86_400_000));
      // Tomorrow's service starts before dawn, so look from midnight
      const early = firstService(net, timetable(net, tomorrow), from.point, to.point, 0, accessible);
      if (early.length) {
        return {
          ...base,
          status: "no_service_now",
          notice: "A esta hora ya no hay buses que hagan este viaje. Esta es la primera opción de mañana, según el horario publicado.",
          options: await present(net, tomorrow, early, 0, from.point, to.point),
        };
      }
      return {
        ...base,
        status: "no_route",
        notice: "No encontré una forma razonable de hacer este viaje en TransMilenio o SITP. No voy a inventar una.",
        options: [],
      };
    }
    status = "no_service_now";
    notice = `${Math.abs(when.getTime() - Date.now()) <= LIVE_WINDOW_MS ? "Ahora mismo" : "A esa hora"} no sale nada para este viaje. Esta es la próxima salida según el horario publicado.`;
  } else if (found[0].journey.departs - clock.seconds > LONG_WAIT_S) {
    status = "no_service_now";
    notice = `La próxima salida para este viaje es en más de una hora, a las ${hhmm(found[0].journey.departs)}, según el horario publicado.`;
  }

  // Live layer: the first bus of each option, from TransMilenio's predictions, only when leaving now
  const leavingNow = Math.abs(when.getTime() - Date.now()) <= LIVE_WINDOW_MS && status === "ok";
  const feeds: { live: boolean; asOf: string }[] = [];
  const checked = await Promise.all(
    found.map(async (o): Promise<Option & { live: boolean }> => {
      const scheduled = { ...o, live: false };
      if (!leavingNow) return scheduled;
      const first = o.journey.legs.find((l): l is RideLeg => l.kind === "ride")!;
      const arrivals = await within(liveArrivals(net.stopId[first.from]), LIVE_WAIT_MS, null as Arrivals | null);
      if (!arrivals) return scheduled;
      const isOn = isLive(arrivals.as_of, arrivals.live);
      feeds.push({ live: isOn, asOf: arrivals.as_of });
      if (!isOn) return scheduled;
      // The prediction for this very bus: same route, and its own timetable time matches the planned one
      const routeId = net.routeId[net.patternRoute[net.groupPattern[first.group]]];
      const midnight = Date.parse(iso(clock, 0));
      const match = arrivals.arrivals
        .filter((a) => a.route_id === routeId && a.basis !== "scheduled" && a.predicted_at && a.delay_seconds != null)
        .map((a) => {
          const predicted = Math.round((Date.parse(a.predicted_at!) - midnight) / 1000);
          return { predicted, gap: Math.abs(predicted - a.delay_seconds! - first.departs) };
        })
        .filter((a) => a.gap <= SAME_TRIP_S)
        .sort((a, b) => a.gap - b.gap)[0];
      if (!match) return scheduled;
      const moved = retime(net, day, o.journey, { departs: match.predicted }, clock.seconds);
      // A live bus that breaks a connection or the sanity rules leaves the timetable option as it was
      if (!moved || problems(net, moved, from.point, to.point).length) return scheduled;
      return { ...o, journey: moved, live: true };
    }),
  );
  const feed: PlanResult["feed"] = feeds.length
    ? { live: feeds.some((f) => f.live), asOf: feeds.map((f) => f.asOf).sort().at(-1) ?? null }
    : { live: false, asOf: null };

  return {
    ...base,
    feed,
    status,
    notice:
      notice ??
      (feeds.length && !feed.live ? "TransMilenio no está publicando datos en vivo ahora: todos los tiempos son del horario publicado." : null),
    options: await present(net, clock, rank(checked), clock.seconds, from.point, to.point),
  };
}

const hhmm = (secondsOfDay: number) => {
  const m = Math.floor(secondsOfDay / 60) % (24 * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

async function present(
  net: Network,
  clock: ServiceClock,
  list: (Option & { live?: boolean })[],
  departAt: number,
  origin: Point,
  destination: Point,
): Promise<PlannedOption[]> {
  const out: PlannedOption[] = [];
  for (const o of list) {
    const steps: (WalkStep | RideStep)[] = [];
    let previousArrival = departAt;
    let firstRide = true;
    const legs = o.journey.legs;
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      if (l.kind === "walk") {
        const minutes = Math.round((l.arrives - l.departs) / 60);
        const fromName = l.from < 0 ? "tu punto de partida" : net.stopName[l.from];
        const toName = l.to < 0 ? "tu destino" : net.stopName[l.to];
        // Metres walked, not derived from the time (which includes getting in or out of a station)
        const a = l.from < 0 ? origin : { lat: net.lat[l.from], lon: net.lon[l.from] };
        const b = l.to < 0 ? destination : { lat: net.lat[l.to], lon: net.lon[l.to] };
        const m = Math.round(metres(a.lat, a.lon, b.lat, b.lon) * 1.3);
        if (minutes > 0 || l.from >= 0) {
          steps.push({ type: "walk", from: fromName, to: toName, departs: iso(clock, l.departs), arrives: iso(clock, l.arrives), minutes, metres: m });
        }
        previousArrival = l.arrives;
        continue;
      }
      const r = net.patternRoute[net.groupPattern[l.group]];
      const system = (net.agency[r] as System) in SYSTEM_NAME ? (net.agency[r] as System) : "other";
      const ref = describeRoute({ id: net.routeId[r], shortName: net.routeShort[r], longName: net.routeLong[r], system });
      const alerts = await within(routeAlerts(ref.feedCode), 1200, []);
      steps.push({
        type: "ride",
        system,
        systemName: SYSTEM_NAME[system],
        route: { id: ref.id, code: ref.code, aliases: ref.aliases, name: ref.name },
        board: { stopId: net.stopId[l.from], name: net.stopName[l.from], code: net.stopCode[l.from] || null, where: where(net, l.from) },
        alight: { stopId: net.stopId[l.to], name: net.stopName[l.to], where: where(net, l.to) },
        departs: iso(clock, l.departs),
        arrives: iso(clock, l.arrives),
        departureBasis: firstRide && o.live ? "live" : "scheduled",
        minutes: Math.round((l.arrives - l.departs) / 60),
        stops: l.toPosition - l.fromPosition,
        waitMinutes: Math.max(0, Math.round((l.departs - previousArrival) / 60)),
        alerts,
      });
      firstRide = false;
      previousArrival = l.arrives;
    }
    out.push({
      reason: o.reason,
      leave: iso(clock, o.journey.departs),
      arrive: iso(clock, o.journey.arrives),
      minutes: Math.round((o.journey.arrives - o.journey.departs) / 60),
      transfers: Math.max(0, o.journey.rides - 1),
      walkMetres: steps.reduce((sum, step) => sum + (step.type === "walk" ? step.metres : 0), 0),
      steps,
    });
  }
  return out;
}
