/**
 * A nine-stop network small enough to know every right answer by hand.
 *
 *   A ──R1 (troncal)── B ──── C · C' ──R2 (SITP)── D ──── E
 *   A ─────────────────R3 (SITP, slow)──────────────────── E
 *   C ──R4── F (leaves C 30 s or 90 s after R1 arrives: tests the transfer buffer)
 *   N ──R5── M ── E (leaves N at 23:50 and reaches M at 00:05: a trip of yesterday's service past midnight)
 *
 * C and C' are 60 s apart on foot. D has no wheelchair access.
 */
import { decodeNetwork, NETWORK_VERSION, type NetworkFile } from "../../src/transit/network.ts";

export const T = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

export const STOP = { A: 0, B: 1, C: 2, Cp: 3, D: 4, E: 5, F: 6, N: 7, M: 8 } as const;

const WEEKDAYS = 0b0011111; // Monday..Friday
export const TUESDAY = { yyyymmdd: 20261110, weekday: 2 };
export const MONDAY = { yyyymmdd: 20261109, weekday: 1 };
/** A holiday Monday: the weekday service is removed. */
export const HOLIDAY = { yyyymmdd: 20261116, weekday: 1 };

export function fixtureFile(): NetworkFile {
  const lat = [4.6, 4.61, 4.62, 4.6201, 4.63, 4.64, 4.625, 4.7, 4.69];
  const lon = [-74.1, -74.1, -74.1, -74.1003, -74.09, -74.09, -74.11, -74.05, -74.06];
  return {
    version: NETWORK_VERSION,
    asOf: "2026-10-13",
    source: "fixture",
    builtAt: "2026-11-10T00:00:00Z",
    stops: {
      id: ["A", "B", "C", "Cp", "D", "E", "F", "N", "M"],
      name: ["Alfa", "Beta", "Gamma", "Gamma calle", "Delta", "Épsilon", "Fi", "Nocturna", "Mu"],
      code: ["", "", "", "C1", "D1", "E1", "F1", "N1", "M1"],
      lat: lat.map((v) => Math.round(v * 1e6)),
      lon: lon.map((v) => Math.round(v * 1e6)),
      parent: [-1, -1, -1, -1, -1, -1, -1, -1, -1],
      kind: ["troncal", "troncal", "troncal", "street", "street", "street", "street", "street", "street"],
      accessible: [1, 1, 1, 1, 0, 1, 1, 1, 1],
    },
    routes: {
      id: ["r1", "r2", "r3", "r4", "r5"],
      short: ["R1", "R2", "R3", "R4", "R5"],
      long: ["Gamma", "Épsilon", "Épsilon", "Fi", "Épsilon"],
      agency: ["troncal", "zonal_urbano", "zonal_urbano", "zonal_urbano", "zonal_urbano"],
    },
    services: { id: ["weekday"], days: [WEEKDAYS], start: [20260101], end: [20261231], added: [[]], removed: [[HOLIDAY.yyyymmdd]] },
    patterns: {
      route: [0, 1, 2, 3, 4],
      stops: [
        [STOP.A, STOP.B, STOP.C],
        [STOP.Cp, STOP.D, STOP.E],
        [STOP.A, STOP.E],
        [STOP.C, STOP.F],
        [STOP.N, STOP.M, STOP.E],
      ],
      offsets: [[0, 300, 600], [0, 600, 1200], [0, 5100], [0, 300], [0, 900, 1500]],
    },
    groups: {
      pattern: [0, 1, 2, 3, 4],
      start: [[T(7, 0), T(7, 10)], [T(7, 20), T(7, 40)], [T(7, 5)], [T(7, 10, 30), T(7, 11, 30)], [T(23, 50)]],
      scale: [[10_000, 10_000], [10_000, 10_000], [10_000], [10_000, 10_000], [10_000]],
      service: [[0, 0], [0, 0], [0], [0, 0], [0]],
    },
    footpaths: { from: [STOP.C], to: [STOP.Cp], seconds: [60] },
  };
}

export const fixture = () => decodeNetwork(fixtureFile());
