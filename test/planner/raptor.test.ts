import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activeServices } from "../../src/transit/network.ts";
import { dayTimetable, raptor, type Journey, type RideLeg } from "../../src/transit/raptor.ts";
import { fixture, HOLIDAY, MONDAY, STOP, T, TUESDAY } from "./fixture.ts";

const net = fixture();
const day = (d = TUESDAY, y = MONDAY) => dayTimetable(net, activeServices(net, d.yyyymmdd, d.weekday), activeServices(net, y.yyyymmdd, y.weekday));
const at = (stop: number) => [{ stop, walk: 0 }];
const routes = (j: Journey) => j.legs.filter((l): l is RideLeg => l.kind === "ride").map((l) => net.routeShort[net.patternRoute[net.groupPattern[l.group]]]);

describe("raptor", () => {
  it("returns the Pareto set: one slow direct ride, then a faster trip with a transfer", () => {
    const js = raptor(net, day(), { origin: at(STOP.A), destination: at(STOP.E), departAt: T(6, 55) });
    assert.deepEqual(
      js.map((j) => [j.rides, j.arrives]),
      [
        [1, T(8, 30)],
        [2, T(7, 40)],
      ],
    );
    assert.deepEqual(routes(js[1]), ["R1", "R2"]);
  });

  it("walks between nearby stops to transfer", () => {
    const [, fast] = raptor(net, day(), { origin: at(STOP.A), destination: at(STOP.E), departAt: T(6, 55) });
    const walk = fast.legs.find((l) => l.kind === "walk" && l.from === STOP.C);
    assert.ok(walk && walk.to === STOP.Cp && walk.arrives - walk.departs === 60);
  });

  it("takes the next trip when the first one has left", () => {
    const js = raptor(net, day(), { origin: at(STOP.A), destination: at(STOP.C), departAt: T(7, 1) });
    assert.equal(js.at(-1)?.arrives, T(7, 20));
  });

  it("leaves a minute between getting off one bus and boarding another at the same stop", () => {
    // R1 reaches C at 7:10:00; R4 leaves C at 7:10:30 (too tight) and 7:11:30 (fine)
    const js = raptor(net, day(), { origin: at(STOP.A), destination: at(STOP.F), departAt: T(6, 55) });
    const r4 = js.at(-1)!.legs.find((l): l is RideLeg => l.kind === "ride" && l.from === STOP.C)!;
    assert.equal(r4.departs, T(7, 11, 30));
  });

  it("finds nothing on a holiday when the only service is removed", () => {
    assert.deepEqual(raptor(net, day(HOLIDAY), { origin: at(STOP.A), destination: at(STOP.E), departAt: T(6, 55) }), []);
  });

  it("runs yesterday's trips past midnight on the next service day", () => {
    // Monday's 23:50 trip reaches M at 00:05 on Tuesday
    const js = raptor(net, day(TUESDAY, MONDAY), { origin: at(STOP.M), destination: at(STOP.E), departAt: 0 });
    assert.equal(js.at(-1)?.arrives, T(0, 15));
  });

  it("does not run yesterday's trips when yesterday had no service", () => {
    const sunday = { yyyymmdd: 20261108, weekday: 0 };
    const js = raptor(net, day(MONDAY, sunday), { origin: at(STOP.M), destination: at(STOP.E), departAt: 0 });
    // Only Monday's own 23:50 trip, which reaches M at 24:05
    assert.equal(js.at(-1)?.arrives, T(24, 15));
  });

  it("never boards or alights at a stop without access when asked for accessible trips", () => {
    const js = raptor(net, day(), { origin: at(STOP.Cp), destination: at(STOP.D), departAt: T(7, 0), accessibleOnly: true });
    assert.deepEqual(js, []);
  });

  it("starts the walk as late as still catches the first vehicle", () => {
    const js = raptor(net, day(), { origin: [{ stop: STOP.A, walk: 120 }], destination: at(STOP.C), departAt: T(6, 30) });
    const j = js.at(-1)!;
    assert.equal(j.departs, T(6, 58));
    assert.equal(j.legs[0].arrives, T(7, 0));
  });
});
