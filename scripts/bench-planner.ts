/// <reference types="node" />
/**
 * Coverage, speed and shape of the planner's answers on the real network.
 *
 *   node scripts/bench-planner.ts [trips=1000]
 *
 * Needs public/network/bogota.json (node scripts/build-network.ts).
 */
import { readFileSync } from "node:fs";

import { bogotaClock, options, timetableFor } from "../src/transit/itinerary.ts";
import { decodeNetwork, metres, type NetworkFile } from "../src/transit/network.ts";

const TRIPS = Number(process.argv[2] ?? 1000);
const raw = JSON.parse(readFileSync("public/network/bogota.json", "utf8")) as NetworkFile;
const decodeStart = performance.now();
const net = decodeNetwork(raw);
const decodeMs = performance.now() - decodeStart;
const stations = Array.from({ length: net.stopCount }, (_, s) => s).filter((s) => net.stopGroups[s].length > 0);

let seed = 11;
const rand = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
  return seed / 2 ** 31;
};
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

function run(label: string, at: string) {
  const clock = bogotaClock(new Date(at));
  let t0 = performance.now();
  const day = timetableFor(net, clock);
  const dayMs = performance.now() - t0;

  const latency: number[] = [];
  const minutes: number[] = [];
  const transfers = [0, 0, 0, 0];
  let answered = 0;
  let count = 0;
  for (let i = 0; i < TRIPS; i++) {
    const a = stations[Math.floor(rand() * stations.length)];
    const b = stations[Math.floor(rand() * stations.length)];
    // A point near each stop, not the stop itself
    const from = { lat: net.lat[a] + (rand() - 0.5) * 0.004, lon: net.lon[a] + (rand() - 0.5) * 0.004 };
    const to = { lat: net.lat[b] + (rand() - 0.5) * 0.004, lon: net.lon[b] + (rand() - 0.5) * 0.004 };
    if (metres(from.lat, from.lon, to.lat, to.lon) < 2000) continue;
    count++;
    t0 = performance.now();
    const found = options(net, day, from, to, clock.seconds);
    latency.push(performance.now() - t0);
    if (!found.length) continue;
    answered++;
    const best = found[0].journey;
    minutes.push((best.arrives - best.departs) / 60);
    transfers[Math.min(3, best.rides - 1)]++;
  }
  console.log(`\n${label} (${at})`);
  console.log(`  timetable for the day: ${dayMs.toFixed(0)} ms`);
  console.log(`  trips over 2 km: ${count}; answered: ${answered} (${((100 * answered) / count).toFixed(1)}%)`);
  console.log(`  latency per plan (with alternatives and checks): p50 ${quantile(latency, 0.5).toFixed(0)} ms, p95 ${quantile(latency, 0.95).toFixed(0)} ms, max ${Math.max(...latency).toFixed(0)} ms`);
  console.log(`  fastest option: median ${quantile(minutes, 0.5).toFixed(0)} min, p90 ${quantile(minutes, 0.9).toFixed(0)} min`);
  console.log(`  transfers in the fastest option: ${transfers.map((n, i) => `${i}: ${((100 * n) / answered).toFixed(0)}%`).join(", ")}`);
}

console.log(`network of ${net.asOf}: ${net.stopCount} stops, ${net.groupPattern.length} trip groups (decoded in ${decodeMs.toFixed(0)} ms)`);
run("Weekday morning peak", "2026-11-10T07:30:00-05:00");
run("Weekday midday", "2026-11-10T13:00:00-05:00");
run("Sunday", "2026-11-15T10:00:00-05:00");
run("Weekday late night", "2026-11-10T22:45:00-05:00");
