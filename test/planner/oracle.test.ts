/**
 * On the real Bogotá network, RAPTOR must find exactly the arrival time an independent exact
 * algorithm (Connection Scan) finds. Runs when public/network/bogota.json has been built
 * (node scripts/build-network.ts); skipped otherwise.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { bogotaClock, endpoints, timetableFor } from "../../src/transit/itinerary.ts";
import { decodeNetwork, type NetworkFile } from "../../src/transit/network.ts";
import { raptor } from "../../src/transit/raptor.ts";
import { connections, csa } from "./csa.ts";

const FILE = "public/network/bogota.json";
const QUERIES = Number(process.env.ORACLE_QUERIES ?? 200);

describe("raptor against connection scan on the real network", { skip: !existsSync(FILE) && `${FILE} not built` }, () => {
  it(`agrees on the earliest arrival for ${QUERIES} random trips`, () => {
    const net = decodeNetwork(JSON.parse(readFileSync(FILE, "utf8")) as NetworkFile);
    const clock = bogotaClock(new Date("2026-11-10T12:00:00-05:00"));
    const day = timetableFor(net, clock);
    const boardable = Array.from({ length: net.stopCount }, (_, s) => s).filter((s) => net.stopGroups[s].length > 0);

    // Deterministic pseudo-random queries
    let seed = 7;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const all = connections(net, day, 4 * 3600, 30 * 3600);

    let reached = 0;
    for (let q = 0; q < QUERIES; q++) {
      const a = boardable[Math.floor(rand() * boardable.length)];
      const b = boardable[Math.floor(rand() * boardable.length)];
      const departAt = Math.floor((5 + rand() * 16) * 3600);
      const origin = endpoints(net, { lat: net.lat[a], lon: net.lon[a] }).stops;
      const destination = endpoints(net, { lat: net.lat[b], lon: net.lon[b] }).stops;

      const fromRaptor = Math.min(...raptor(net, day, { origin, destination, departAt, maxRides: 8 }).map((j) => j.arrives), Infinity);
      const fromCsa = csa(net, all, origin, destination, departAt);
      if (fromCsa < Infinity) reached++;
      assert.equal(fromRaptor, fromCsa, `trip ${q}: ${net.stopName[a]} → ${net.stopName[b]} at ${departAt}s`);
    }
    assert.ok(reached > QUERIES * 0.9, `only ${reached} of ${QUERIES} trips were reachable`);
  });
});
