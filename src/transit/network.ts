/**
 * The whole Bogotá network as one compact file, built from TransMilenio's official GTFS by
 * scripts/build-network.ts and loaded by the planner. Pure: no fetch, no clock.
 *
 * Timetable model: every trip of a stop pattern is the pattern's base profile scaled by one
 * factor (TransMilenio builds its timetable that way). The builder checks every trip against the
 * official stop times and splits the pattern when a trip would be off by more than MAX_ERROR_S.
 */

export const NETWORK_VERSION = 1;
export const MAX_ERROR_S = 5;

export type StopKind = "troncal" | "street" | "cable";

export interface NetworkFile {
  version: number;
  /** Date of the GTFS this was built from, yyyy-mm-dd. */
  asOf: string;
  source: string;
  builtAt: string;
  stops: {
    id: string[];
    name: string[];
    code: string[];
    /** Degrees × 1e6. */
    lat: number[];
    lon: number[];
    /** Index of the station this platform belongs to, or -1. */
    parent: number[];
    kind: StopKind[];
    accessible: number[];
  };
  routes: { id: string[]; short: string[]; long: string[]; agency: string[] };
  services: { id: string[]; days: number[]; start: number[]; end: number[]; added: number[][]; removed: number[][] };
  patterns: { route: number[]; stops: number[][]; offsets: number[][] };
  /** Trips grouped so that no trip overtakes another inside a group (RAPTOR needs this). */
  groups: { pattern: number[]; start: number[][]; scale: number[][]; service: number[][] };
  footpaths: { from: number[]; to: number[]; seconds: number[] };
}

export interface Network {
  asOf: string;
  stopCount: number;
  stopId: string[];
  stopName: string[];
  stopCode: string[];
  lat: Float64Array;
  lon: Float64Array;
  parent: Int32Array;
  kind: StopKind[];
  accessible: Uint8Array;
  routeId: string[];
  routeShort: string[];
  routeLong: string[];
  agency: string[];
  services: NetworkFile["services"];
  patternRoute: Int32Array;
  patternStops: Int32Array[];
  patternOffsets: Int32Array[];
  groupPattern: Int32Array;
  groupStart: Int32Array[];
  groupScale: Int32Array[];
  groupService: Int32Array[];
  /** stop -> [group, position] pairs, flattened. */
  stopGroups: Int32Array[];
  /** stop -> [to, seconds] pairs, flattened. */
  walks: Int32Array[];
  stopIndex: Map<string, number>;
  grid: Map<number, number[]>;
}

const CELL = 0.005;
const cellKey = (lat: number, lon: number) => Math.floor(lat / CELL) * 100_000 + Math.floor(lon / CELL);

export function decodeNetwork(file: NetworkFile): Network {
  if (file.version !== NETWORK_VERSION) throw new Error(`Network file v${file.version}, expected v${NETWORK_VERSION}.`);
  const n = file.stops.id.length;
  const lat = Float64Array.from(file.stops.lat, (v) => v / 1e6);
  const lon = Float64Array.from(file.stops.lon, (v) => v / 1e6);

  const stopGroupLists: number[][] = Array.from({ length: n }, () => []);
  file.groups.pattern.forEach((p, g) => {
    file.patterns.stops[p].forEach((s, pos) => stopGroupLists[s].push(g, pos));
  });

  const walkLists: number[][] = Array.from({ length: n }, () => []);
  file.footpaths.from.forEach((a, i) => {
    const b = file.footpaths.to[i];
    const s = file.footpaths.seconds[i];
    walkLists[a].push(b, s);
    walkLists[b].push(a, s);
  });

  const grid = new Map<number, number[]>();
  for (let s = 0; s < n; s++) {
    const key = cellKey(lat[s], lon[s]);
    const list = grid.get(key);
    if (list) list.push(s);
    else grid.set(key, [s]);
  }

  return {
    asOf: file.asOf,
    stopCount: n,
    stopId: file.stops.id,
    stopName: file.stops.name,
    stopCode: file.stops.code,
    lat,
    lon,
    parent: Int32Array.from(file.stops.parent),
    kind: file.stops.kind,
    accessible: Uint8Array.from(file.stops.accessible),
    routeId: file.routes.id,
    routeShort: file.routes.short,
    routeLong: file.routes.long,
    agency: file.routes.agency,
    services: file.services,
    patternRoute: Int32Array.from(file.patterns.route),
    patternStops: file.patterns.stops.map((s) => Int32Array.from(s)),
    patternOffsets: file.patterns.offsets.map((o) => Int32Array.from(o)),
    groupPattern: Int32Array.from(file.groups.pattern),
    groupStart: file.groups.start.map((s) => Int32Array.from(s)),
    groupScale: file.groups.scale.map((s) => Int32Array.from(s)),
    groupService: file.groups.service.map((s) => Int32Array.from(s)),
    stopGroups: stopGroupLists.map((l) => Int32Array.from(l)),
    walks: walkLists.map((l) => Int32Array.from(l)),
    stopIndex: new Map(file.stops.id.map((id, i) => [id, i])),
    grid,
  };
}

/** Metres between two points, equirectangular: exact enough inside one city. */
export function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const x = (bLon - aLon) * 111_320 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const y = (bLat - aLat) * 110_540;
  return Math.hypot(x, y);
}

/** Stops within `radius` metres of a point, nearest first. */
export function stopsNear(net: Network, lat: number, lon: number, radius: number): { stop: number; metres: number }[] {
  const reach = Math.ceil(radius / 550) + 1;
  const ci = Math.floor(lat / CELL);
  const cj = Math.floor(lon / CELL);
  const out: { stop: number; metres: number }[] = [];
  for (let i = ci - reach; i <= ci + reach; i++) {
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (const s of net.grid.get(i * 100_000 + j) ?? []) {
        const m = metres(lat, lon, net.lat[s], net.lon[s]);
        if (m <= radius) out.push({ stop: s, metres: m });
      }
    }
  }
  return out.sort((a, b) => a.metres - b.metres);
}

/** Seconds a stop departs at on a trip of a group. */
export function departure(net: Network, group: number, trip: number, position: number): number {
  const offset = net.patternOffsets[net.groupPattern[group]][position];
  return net.groupStart[group][trip] + Math.round((offset * net.groupScale[group][trip]) / 10_000);
}

const DAY_BITS = [64, 1, 2, 4, 8, 16, 32]; // Sunday..Saturday -> Monday=1 … Sunday=64

/** Services running on a date, given as yyyymmdd and its weekday (0 = Sunday). */
export function activeServices(net: Network, yyyymmdd: number, weekday: number): Set<number> {
  const active = new Set<number>();
  const s = net.services;
  for (let i = 0; i < s.id.length; i++) {
    let on = (s.days[i] & DAY_BITS[weekday]) !== 0 && yyyymmdd >= s.start[i] && yyyymmdd <= s.end[i];
    if (s.added[i].includes(yyyymmdd)) on = true;
    if (s.removed[i].includes(yyyymmdd)) on = false;
    if (on) active.add(i);
  }
  return active;
}
