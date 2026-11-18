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

// Plain loops instead of Array.from/forEach/map with callbacks: the app runs this on Hermes, which has no
// JIT to inline a callback per element, and the network has ~8,300 stops and ~2,700 groups.
const toInt32 = (lists: number[][]): Int32Array[] => {
  const out: Int32Array[] = new Array(lists.length);
  for (let i = 0; i < lists.length; i++) out[i] = new Int32Array(lists[i]);
  return out;
};

export function decodeNetwork(file: NetworkFile): Network {
  if (file.version !== NETWORK_VERSION) throw new Error(`Network file v${file.version}, expected v${NETWORK_VERSION}.`);
  const n = file.stops.id.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    lat[s] = file.stops.lat[s] / 1e6;
    lon[s] = file.stops.lon[s] / 1e6;
  }

  // stop -> [group, position] pairs: count first, then fill, so each stop gets one exact-size array
  const groupPattern = file.groups.pattern;
  const patternStops = file.patterns.stops;
  const groupCounts = new Int32Array(n);
  for (let g = 0; g < groupPattern.length; g++) {
    const stops = patternStops[groupPattern[g]];
    for (let pos = 0; pos < stops.length; pos++) groupCounts[stops[pos]] += 2;
  }
  const stopGroups: Int32Array[] = new Array(n);
  for (let s = 0; s < n; s++) stopGroups[s] = new Int32Array(groupCounts[s]);
  const groupFill = new Int32Array(n);
  for (let g = 0; g < groupPattern.length; g++) {
    const stops = patternStops[groupPattern[g]];
    for (let pos = 0; pos < stops.length; pos++) {
      const s = stops[pos];
      const at = groupFill[s];
      stopGroups[s][at] = g;
      stopGroups[s][at + 1] = pos;
      groupFill[s] = at + 2;
    }
  }

  // stop -> [to, seconds] pairs, both directions, in footpath order
  const { from, to, seconds } = file.footpaths;
  const walkCounts = new Int32Array(n);
  for (let i = 0; i < from.length; i++) {
    walkCounts[from[i]] += 2;
    walkCounts[to[i]] += 2;
  }
  const walks: Int32Array[] = new Array(n);
  for (let s = 0; s < n; s++) walks[s] = new Int32Array(walkCounts[s]);
  const walkFill = new Int32Array(n);
  for (let i = 0; i < from.length; i++) {
    const a = from[i];
    const b = to[i];
    const sec = seconds[i];
    let at = walkFill[a];
    walks[a][at] = b;
    walks[a][at + 1] = sec;
    walkFill[a] = at + 2;
    at = walkFill[b];
    walks[b][at] = a;
    walks[b][at + 1] = sec;
    walkFill[b] = at + 2;
  }

  const grid = new Map<number, number[]>();
  for (let s = 0; s < n; s++) {
    const key = cellKey(lat[s], lon[s]);
    const list = grid.get(key);
    if (list) list.push(s);
    else grid.set(key, [s]);
  }

  const stopIndex = new Map<string, number>();
  for (let s = 0; s < n; s++) stopIndex.set(file.stops.id[s], s);

  return {
    asOf: file.asOf,
    stopCount: n,
    stopId: file.stops.id,
    stopName: file.stops.name,
    stopCode: file.stops.code,
    lat,
    lon,
    parent: new Int32Array(file.stops.parent),
    kind: file.stops.kind,
    accessible: new Uint8Array(file.stops.accessible),
    routeId: file.routes.id,
    routeShort: file.routes.short,
    routeLong: file.routes.long,
    agency: file.routes.agency,
    services: file.services,
    patternRoute: new Int32Array(file.patterns.route),
    patternStops: toInt32(patternStops),
    patternOffsets: toInt32(file.patterns.offsets),
    groupPattern: new Int32Array(groupPattern),
    groupStart: toInt32(file.groups.start),
    groupScale: toInt32(file.groups.scale),
    groupService: toInt32(file.groups.service),
    stopGroups,
    walks,
    stopIndex,
    grid,
  };
}

/**
 * What the planner relies on in a network file, beyond its shape. The FIFO groups of
 * scripts/build-network.ts are only FIFO at every stop when offsets never decrease and scales are not
 * negative. RAPTOR's binary search and its shortcuts (skipping searches, pruning by the best arrival)
 * also need the day's list in order, and that list puts yesterday's trips past midnight (minus 24 h)
 * before today's: so no such trip may leave after the group's first trip, whatever the calendar.
 * Returns one line per broken rule, at most `limit`; empty when the file is sound.
 */
export function networkProblems(file: NetworkFile, limit = 20): string[] {
  const out: string[] = [];
  const say = (line: string) => out.length < limit && out.push(line);
  const { offsets } = file.patterns;
  for (let p = 0; p < offsets.length; p++) {
    const o = offsets[p];
    if (o.length !== file.patterns.stops[p].length) say(`pattern ${p}: ${o.length} offsets for ${file.patterns.stops[p].length} stops`);
    if (o.length && o[0] < 0) say(`pattern ${p}: first offset ${o[0]} is negative`);
    for (let i = 1; i < o.length; i++) if (o[i] < o[i - 1]) say(`pattern ${p}: offset ${i} (${o[i]}) is before offset ${i - 1} (${o[i - 1]})`);
  }
  const { pattern, start, scale } = file.groups;
  for (let g = 0; g < pattern.length; g++) {
    const total = offsets[pattern[g]][offsets[pattern[g]].length - 1] ?? 0;
    if (start[g].length !== scale[g].length || start[g].length !== file.groups.service[g].length) say(`group ${g}: start, scale and service differ in length`);
    for (let k = 0; k < scale[g].length; k++) {
      // A trip past midnight runs again tomorrow, 24 h earlier, ahead of the group's first trip of that day
      // (dayTimetable decides "past midnight" after rounding, hence the half second)
      if (start[g][k] * 10_000 + total * scale[g][k] >= 86_400 * 10_000 - 5_000 &&
        (start[g][k] - 86_400 > start[g][0] || (start[g][k] - 86_400) * 10_000 + total * scale[g][k] > start[g][0] * 10_000 + total * scale[g][0]))
        say(`group ${g}: trip ${k} runs past midnight and, 24 h earlier, would leave after trip 0`);
      if (scale[g][k] < 0) say(`group ${g}, trip ${k}: scale ${scale[g][k]} is negative`);
      // The scan rounds offset × scale / 10 000 with 32-bit integers
      if (start[g][k] + 86_400 + (total * scale[g][k]) / 10_000 >= 2 ** 31) say(`group ${g}, trip ${k}: times overflow 32 bits`);
      // FIFO at the first and last stop, which with the rules above means at every stop
      if (k > 0 && (start[g][k] < start[g][k - 1] || start[g][k] * 10_000 + total * scale[g][k] < start[g][k - 1] * 10_000 + total * scale[g][k - 1]))
        say(`group ${g}: trip ${k} overtakes trip ${k - 1}`);
    }
  }
  return out;
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
