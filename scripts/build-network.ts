/// <reference types="node" />
/**
 * Builds public/network/bogota.json from TransMilenio's official static GTFS.
 *
 *   node scripts/build-network.ts                 # finds and downloads the latest GTFS
 *   node scripts/build-network.ts --gtfs ./GTFS_20261013.zip
 *
 * Every trip is stored as (start, scale) over its pattern's base profile, and checked against the
 * official stop times: a trip that would be off by more than MAX_ERROR_S anywhere gets its own
 * profile. See docs/PLANNER.md.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import { MAX_ERROR_S, NETWORK_VERSION, type NetworkFile, type StopKind } from "../src/transit/network.ts";

const HUB = "https://datosabiertos-transmilenio.hub.arcgis.com/api/search/v1/collections/all/items?q=gtfs&limit=100";
const ITEM = (id: string) => `https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`;
const OUT = "public/network/bogota.json";
const FOOTPATH_M = 300;
const WALK_MPS = 1.25;
const DETOUR = 1.3;
const STATION_ACCESS_S = 180;
const MIN_TRANSFER_S = 60;
const MIN_HEADWAY_S = 60;
const AGENCY: Record<string, string> = {
  "1": "troncal",
  "2": "alimentador",
  "3": "zonal_urbano",
  "4": "zonal_complementario",
  "5": "zonal_especial",
  "6": "dual",
  "7": "transmicable",
};

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function latestGtfs(): Promise<{ url: string; asOf: string }> {
  const res = await fetch(HUB);
  const json = (await res.json()) as { features: { properties: { id: string; title: string } }[] };
  const dated = json.features
    .map((f) => ({ id: f.properties.id, date: /GTFS Est[áa]ticos (\d{4}-\d{2}-\d{2})/.exec(f.properties.title)?.[1] }))
    .filter((f): f is { id: string; date: string } => !!f.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!dated.length) throw new Error("No GTFS found on TransMilenio's open data hub.");
  const item = (await (await fetch(ITEM(dated[0].id))).json()) as { url?: string };
  if (!item.url) throw new Error(`GTFS item ${dated[0].id} has no download URL.`);
  return { url: item.url, asOf: dated[0].date };
}

async function gtfsDir(): Promise<{ dir: string; source: string; asOf: string }> {
  let zip = arg("gtfs");
  let source = zip ?? "";
  let asOf = arg("as-of") ?? "";
  if (!zip) {
    const latest = await latestGtfs();
    source = latest.url;
    asOf = latest.asOf;
    zip = join(mkdtempSync(join(tmpdir(), "gtfs-")), basename(new URL(latest.url).pathname));
    console.log(`Downloading ${latest.url}`);
    const res = await fetch(latest.url);
    if (!res.ok) throw new Error(`GTFS download failed: ${res.status}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  if (!asOf) {
    const m = /(\d{4})(\d{2})(\d{2})/.exec(basename(zip));
    if (!m) throw new Error("Pass --as-of yyyy-mm-dd: the GTFS file name has no date.");
    asOf = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const dir = mkdtempSync(join(tmpdir(), "gtfs-x-"));
  execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  return { dir, source, asOf };
}

function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function table(dir: string, name: string): Record<string, string>[] {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  const [head, ...lines] = readFileSync(path, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const cols = splitCsv(head).map((c) => c.trim());
  return lines.map((l) => {
    const v = splitCsv(l);
    return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? "").trim()]));
  });
}

const seconds = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};

function metres(aLat: number, aLon: number, bLat: number, bLon: number) {
  const x = (bLon - aLon) * 111_320 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(x, (bLat - aLat) * 110_540);
}

async function main() {
  const { dir, source, asOf } = await gtfsDir();
  console.log(`Building network from GTFS of ${asOf}`);

  // Stops
  const stopRows = table(dir, "stops.txt");
  const stopIndex = new Map(stopRows.map((r, i) => [r.stop_id, i]));
  const lat = stopRows.map((r) => Number(r.stop_lat));
  const lon = stopRows.map((r) => Number(r.stop_lon));
  const parent = stopRows.map((r) => (r.parent_station ? (stopIndex.get(r.parent_station) ?? -1) : -1));

  // Routes and services
  const routeRows = table(dir, "routes.txt");
  const routeIndex = new Map(routeRows.map((r, i) => [r.route_id, i]));
  const calendar = table(dir, "calendar.txt");
  const serviceIndex = new Map(calendar.map((r, i) => [r.service_id, i]));
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const services: NetworkFile["services"] = {
    id: calendar.map((r) => r.service_id),
    days: calendar.map((r) => days.reduce((mask, d, i) => (r[d] === "1" ? mask | (1 << i) : mask), 0)),
    start: calendar.map((r) => Number(r.start_date)),
    end: calendar.map((r) => Number(r.end_date)),
    added: calendar.map(() => []),
    removed: calendar.map(() => []),
  };
  for (const r of table(dir, "calendar_dates.txt")) {
    let i = serviceIndex.get(r.service_id);
    if (i === undefined) {
      i = services.id.push(r.service_id) - 1;
      serviceIndex.set(r.service_id, i);
      services.days.push(0);
      services.start.push(0);
      services.end.push(0);
      services.added.push([]);
      services.removed.push([]);
    }
    (r.exception_type === "1" ? services.added : services.removed)[i].push(Number(r.date));
  }

  // Trips
  const tripRows = table(dir, "trips.txt");
  const tripIndex = new Map<string, number>();
  const tripRoute: number[] = [];
  const tripService: number[] = [];
  for (const r of tripRows) {
    const route = routeIndex.get(r.route_id);
    const service = serviceIndex.get(r.service_id);
    if (route === undefined || service === undefined) continue;
    tripIndex.set(r.trip_id, tripRoute.length);
    tripRoute.push(route);
    tripService.push(service);
  }
  const frequencies = new Map<number, { start: number; end: number; headway: number }[]>();
  for (const r of table(dir, "frequencies.txt")) {
    const t = tripIndex.get(r.trip_id);
    if (t === undefined) continue;
    const list = frequencies.get(t) ?? [];
    list.push({ start: seconds(r.start_time), end: seconds(r.end_time), headway: Math.max(Number(r.headway_secs), MIN_HEADWAY_S) });
    frequencies.set(t, list);
  }

  // Stop times, streamed into typed arrays and bucketed by trip
  let cap = 10_000_000;
  let n = 0;
  let stTrip = new Int32Array(cap);
  let stSeq = new Int32Array(cap);
  let stStop = new Int32Array(cap);
  let stTime = new Int32Array(cap);
  const lines = createInterface({ input: createReadStream(join(dir, "stop_times.txt")), crlfDelay: Infinity });
  let cols: Record<string, number> | null = null;
  for await (const line of lines as AsyncIterable<string>) {
    if (!line) continue;
    const v = splitCsv(line);
    if (!cols) {
      cols = Object.fromEntries(v.map((c, i) => [c.replace(/^﻿/, "").trim(), i]));
      continue;
    }
    const trip = tripIndex.get(v[cols.trip_id]);
    const stop = stopIndex.get(v[cols.stop_id]);
    if (trip === undefined || stop === undefined) continue;
    if (n === cap) {
      cap *= 2;
      const grow = (a: Int32Array) => {
        const b = new Int32Array(cap);
        b.set(a);
        return b;
      };
      stTrip = grow(stTrip);
      stSeq = grow(stSeq);
      stStop = grow(stStop);
      stTime = grow(stTime);
    }
    stTrip[n] = trip;
    stSeq[n] = Number(v[cols.stop_sequence]);
    stStop[n] = stop;
    stTime[n] = seconds(v[cols.departure_time] || v[cols.arrival_time]);
    n++;
  }
  const tripCount = tripRoute.length;
  const firstRow = new Int32Array(tripCount + 1);
  for (let i = 0; i < n; i++) firstRow[stTrip[i] + 1]++;
  for (let t = 0; t < tripCount; t++) firstRow[t + 1] += firstRow[t];
  const fill = firstRow.slice(0, tripCount);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[stTrip[i]]++] = i;
  console.log(`${n} stop times, ${tripCount} trips`);

  // Patterns: (route, stop sequence) -> trips with their offsets
  type Trip = { start: number; offsets: Int32Array; service: number };
  const patternKey = new Map<string, number>();
  const patternRoute: number[] = [];
  const patternStops: number[][] = [];
  const patternTrips: Trip[][] = [];
  for (let t = 0; t < tripCount; t++) {
    const rows = Array.from(order.subarray(firstRow[t], firstRow[t + 1])).sort((a, b) => stSeq[a] - stSeq[b]);
    if (rows.length < 2) continue;
    const stops = rows.map((r) => stStop[r]);
    const start = stTime[rows[0]];
    const offsets = Int32Array.from(rows, (r) => stTime[r] - start);
    const key = `${tripRoute[t]}|${stops.join(",")}`;
    let p = patternKey.get(key);
    if (p === undefined) {
      p = patternRoute.push(tripRoute[t]) - 1;
      patternKey.set(key, p);
      patternStops.push(stops);
      patternTrips.push([]);
    }
    const windows = frequencies.get(t);
    if (windows) {
      for (const w of windows) for (let s = w.start; s < w.end; s += w.headway) patternTrips[p].push({ start: s, offsets, service: tripService[t] });
    } else patternTrips[p].push({ start, offsets, service: tripService[t] });
  }

  // Profiles: base offsets + a per-trip scale, split until every trip fits within MAX_ERROR_S
  const out = {
    patterns: { route: [] as number[], stops: [] as number[][], offsets: [] as number[][] },
    groups: { pattern: [] as number[], start: [] as number[][], scale: [] as number[][], service: [] as number[][] },
  };
  let worst = 0;
  const fits = (base: Int32Array, trip: Trip, scale: number) => {
    let max = 0;
    for (let i = 0; i < base.length; i++) max = Math.max(max, Math.abs(trip.offsets[i] - Math.round((base[i] * scale) / 10_000)));
    return max;
  };
  patternTrips.forEach((trips, p) => {
    let left = trips;
    while (left.length) {
      const byLength = [...left].sort((a, b) => a.offsets[a.offsets.length - 1] - b.offsets[b.offsets.length - 1]);
      const base = byLength[Math.floor(byLength.length / 2)].offsets;
      const total = base[base.length - 1];
      const kept: { trip: Trip; scale: number }[] = [];
      const rest: Trip[] = [];
      for (const trip of left) {
        const scale = total > 0 ? Math.round((trip.offsets[trip.offsets.length - 1] / total) * 10_000) : 10_000;
        const err = fits(base, trip, scale);
        if (err <= MAX_ERROR_S) {
          worst = Math.max(worst, err);
          kept.push({ trip, scale });
        } else rest.push(trip);
      }
      const pi = out.patterns.route.push(patternRoute[p]) - 1;
      out.patterns.stops.push(patternStops[p]);
      out.patterns.offsets.push(Array.from(base));

      // FIFO groups: within a group no trip overtakes an earlier one at any stop
      kept.sort((a, b) => a.trip.start - b.trip.start || a.scale - b.scale);
      const groups: { last: { start: number; scale: number }; items: typeof kept }[] = [];
      for (const k of kept) {
        const g = groups.find((x) => x.last.start <= k.trip.start && x.last.start * 10_000 + total * x.last.scale <= k.trip.start * 10_000 + total * k.scale);
        if (g) {
          g.items.push(k);
          g.last = { start: k.trip.start, scale: k.scale };
        } else groups.push({ last: { start: k.trip.start, scale: k.scale }, items: [k] });
      }
      for (const g of groups) {
        out.groups.pattern.push(pi);
        out.groups.start.push(g.items.map((k) => k.trip.start));
        out.groups.scale.push(g.items.map((k) => k.scale));
        out.groups.service.push(g.items.map((k) => k.trip.service));
      }
      if (rest.length === left.length) throw new Error(`Pattern ${p} cannot be profiled.`);
      left = rest;
    }
  });

  // Stop kinds from the systems that serve them
  const served = stopRows.map(() => new Set<string>());
  out.patterns.stops.forEach((stops, pi) => {
    const agency = routeRows[out.patterns.route[pi]].agency_id;
    for (const s of stops) served[s].add(agency);
  });
  const kind: StopKind[] = stopRows.map((r, i) => {
    if (served[i].has("7")) return "cable";
    // Platforms inside stations and portals, and any stop a troncal route serves
    if (r.location_type === "1" || parent[i] >= 0 || served[i].has("1")) return "troncal";
    return "street";
  });

  // Footpaths between boardable stops, with the time it takes to get in or out of a station
  const boardable = stopRows.map((_, i) => i).filter((i) => served[i].size > 0);
  const CELL = 0.005;
  const grid = new Map<string, number[]>();
  for (const s of boardable) {
    const k = `${Math.floor(lat[s] / CELL)},${Math.floor(lon[s] / CELL)}`;
    grid.set(k, [...(grid.get(k) ?? []), s]);
  }
  const fp = { from: [] as number[], to: [] as number[], seconds: [] as number[] };
  const station = (s: number) => (kind[s] === "troncal" ? (parent[s] >= 0 ? parent[s] : s) : -1);
  for (const a of boardable) {
    const ci = Math.floor(lat[a] / CELL);
    const cj = Math.floor(lon[a] / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const b of grid.get(`${i},${j}`) ?? []) {
          if (b <= a) continue;
          const d = metres(lat[a], lon[a], lat[b], lon[b]);
          const sa = station(a);
          const sb = station(b);
          const sameStation = sa >= 0 && sa === sb;
          if (d > FOOTPATH_M && !sameStation) continue;
          const crossings = sameStation ? 0 : (sa >= 0 ? 1 : 0) + (sb >= 0 ? 1 : 0);
          fp.from.push(a);
          fp.to.push(b);
          fp.seconds.push(Math.max(MIN_TRANSFER_S, Math.round((d * DETOUR) / WALK_MPS)) + crossings * STATION_ACCESS_S);
        }
      }
    }
  }

  const file: NetworkFile = {
    version: NETWORK_VERSION,
    asOf,
    source,
    builtAt: new Date().toISOString(),
    stops: {
      id: stopRows.map((r) => r.stop_id),
      name: stopRows.map((r) => r.stop_name.replace(/\s+/g, " ").trim()),
      code: stopRows.map((r) => r.stop_code),
      lat: lat.map((v) => Math.round(v * 1e6)),
      lon: lon.map((v) => Math.round(v * 1e6)),
      parent,
      kind,
      accessible: stopRows.map((r) => (r.wheelchair_boarding === "1" ? 1 : 0)),
    },
    routes: {
      id: routeRows.map((r) => r.route_id),
      short: routeRows.map((r) => r.route_short_name),
      long: routeRows.map((r) => r.route_long_name),
      agency: routeRows.map((r) => AGENCY[r.agency_id] ?? "other"),
    },
    services,
    patterns: out.patterns,
    groups: out.groups,
    footpaths: fp,
  };
  mkdirSync("public/network", { recursive: true });
  const json = JSON.stringify(file);
  writeFileSync(arg("out") ?? OUT, json);
  const trips = out.groups.start.reduce((s, g) => s + g.length, 0);
  console.log(
    `Wrote ${arg("out") ?? OUT}: ${(json.length / 1e6).toFixed(1)} MB, ${stopRows.length} stops, ${out.patterns.route.length} profiles, ` +
      `${out.groups.pattern.length} groups, ${trips} trips, ${fp.from.length} footpaths, worst timetable error ${worst}s`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
