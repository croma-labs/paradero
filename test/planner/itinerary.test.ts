import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bogotaClock, options, problems, rank, retime, timetableFor, type Option } from "../../src/transit/itinerary.ts";
import type { Journey } from "../../src/transit/raptor.ts";
import { fixture, STOP, T } from "./fixture.ts";

const net = fixture();
const tuesday = bogotaClock(new Date("2026-11-10T06:55:00-05:00"));
const day = timetableFor(net, tuesday);
const point = (s: number) => ({ lat: net.lat[s], lon: net.lon[s] });

describe("bogotaClock", () => {
  it("reads the service day, weekday and seconds in Bogotá, UTC−5", () => {
    assert.deepEqual(bogotaClock(new Date("2026-11-10T03:30:00Z")), {
      yyyymmdd: 20261109,
      weekday: 1,
      seconds: T(22, 30),
      previous: { yyyymmdd: 20261108, weekday: 0 },
    });
  });
});

describe("options", () => {
  it("offers the fast trip with a transfer first and the slower direct one when it is not much later", () => {
    const found = options(net, day, point(STOP.A), point(STOP.E), T(6, 55));
    assert.equal(found[0].reason, "fastest");
    assert.equal(found[0].journey.rides, 2);
    assert.ok(found.every((o) => problems(net, o.journey, point(STOP.A), point(STOP.E)).length === 0));
  });

  it("returns nothing when there is no stop near the point", () => {
    assert.deepEqual(options(net, day, { lat: 4.3, lon: -74.5 }, point(STOP.E), T(7, 0)), []);
  });
});

describe("problems", () => {
  const base = (): Journey => options(net, day, point(STOP.A), point(STOP.C), T(6, 55))[0].journey;

  it("accepts a normal trip", () => {
    assert.deepEqual(problems(net, base(), point(STOP.A), point(STOP.C)), []);
  });

  it("refuses a trip that waits over an hour between vehicles", () => {
    const j = options(net, day, point(STOP.A), point(STOP.E), T(6, 55))[0].journey;
    const legs = j.legs.map((l) => ({ ...l }));
    const second = legs.filter((l) => l.kind === "ride")[1];
    second.departs += 2 * 3600;
    second.arrives += 2 * 3600;
    assert.ok(problems(net, { ...j, legs }, point(STOP.A), point(STOP.E)).includes("waits over an hour between vehicles"));
  });

  it("refuses a detour far longer than the trip", () => {
    // Over 4 km of riding for a rider who only wanted to cross the street from A
    const j = options(net, day, point(STOP.A), point(STOP.E), T(6, 55))[0].journey;
    assert.ok(problems(net, j, point(STOP.A), { lat: 4.6001, lon: -74.1 }).includes("detour far longer than the trip"));
  });
});

describe("rank", () => {
  const j = (departs: number, arrives: number, rides: number): Option => ({ journey: { departs, arrives, rides, legs: [] }, reason: "alternative", walkMetres: 100 });

  it("drops an option that arrives later with more transfers, unless it leaves later", () => {
    const ranked = rank([j(100, 1000, 1), j(100, 1100, 2), j(400, 1300, 1)]);
    assert.deepEqual(
      ranked.map((o) => [o.journey.arrives, o.reason]),
      [
        [1000, "fastest"],
        [1300, "next_departure"],
      ],
    );
  });

  it("calls a slower option with fewer vehicles fewer_transfers", () => {
    const ranked = rank([j(100, 1000, 2), j(100, 1200, 1)]);
    assert.deepEqual(
      ranked.map((o) => o.reason),
      ["fastest", "fewer_transfers"],
    );
  });
});

describe("retime", () => {
  const fast = () => options(net, day, point(STOP.A), point(STOP.E), T(6, 55))[0].journey;

  it("moves the first bus to its live time and keeps a connection that still works", () => {
    // R1's 7:00 bus is predicted at 7:03; R2 at 7:20 is still reachable
    const live = retime(net, day, fast(), { departs: T(7, 3) }, T(6, 55))!;
    const rides = live.legs.filter((l) => l.kind === "ride");
    assert.equal(rides[0].departs, T(7, 3));
    assert.equal(rides[1].departs, T(7, 20));
    assert.equal(live.arrives, fast().arrives);
  });

  it("re-plans the connection when the live bus makes the rider miss it", () => {
    // Running 12 minutes late: arrives at C 7:22, the 7:20 R2 is gone, the 7:40 one is next
    const live = retime(net, day, fast(), { departs: T(7, 12) }, T(6, 55))!;
    assert.equal(live.legs.filter((l) => l.kind === "ride")[1].departs, T(7, 40));
  });

  it("ignores a prediction the rider cannot reach in time", () => {
    const j = fast();
    const walk = j.legs[0].arrives - j.legs[0].departs;
    assert.equal(retime(net, day, j, { departs: T(6, 55) + walk - 1 }, T(6, 55)), null);
  });
});
