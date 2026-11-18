/**
 * networkProblems() guards what RAPTOR relies on: offsets that never go back, scales that are not
 * negative, and FIFO groups. A broken file must be refused by the builder instead of silently losing trips.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { networkProblems, type NetworkFile } from "../../src/transit/network.ts";
import { fixtureFile, T } from "./fixture.ts";

const FILE = "public/network/bogota.json";

describe("networkProblems", () => {
  it("finds nothing wrong with the fixture", () => {
    assert.deepEqual(networkProblems(fixtureFile()), []);
  });

  it("finds an offset that goes back", () => {
    const file = fixtureFile();
    file.patterns.offsets[0] = [0, 300, 200];
    assert.match(networkProblems(file).join("\n"), /pattern 0: offset 2 \(200\) is before offset 1 \(300\)/);
  });

  it("finds a negative first offset", () => {
    const file = fixtureFile();
    file.patterns.offsets[3] = [-10, 300];
    assert.match(networkProblems(file).join("\n"), /pattern 3: first offset -10 is negative/);
  });

  it("finds a negative scale", () => {
    const file = fixtureFile();
    file.groups.scale[2] = [-1];
    assert.match(networkProblems(file).join("\n"), /group 2, trip 0: scale -1 is negative/);
  });

  it("finds a trip that overtakes the one before it", () => {
    const file: NetworkFile = fixtureFile();
    // Leaves a minute later but runs in 30 % of the time: it reaches the end first
    file.groups.start[0] = [T(7, 0), T(7, 1)];
    file.groups.scale[0] = [10_000, 3_000];
    assert.match(networkProblems(file).join("\n"), /group 0: trip 1 overtakes trip 0/);
  });

  it("finds a trip past midnight that, a day earlier, would leave after the first trip", () => {
    const file = fixtureFile();
    // R1 at 04:00 and at 29:00 (05:00 tomorrow): tomorrow's list would be 05:00, then 04:00
    file.groups.start[0] = [T(4, 0), T(29, 0)];
    assert.match(networkProblems(file).join("\n"), /group 0: trip 1 runs past midnight and, 24 h earlier, would leave after trip 0/);
  });

  it("accepts a trip past midnight that a day earlier still leaves first", () => {
    const file = fixtureFile();
    file.groups.start[0] = [T(7, 0), T(30, 50)];
    assert.deepEqual(networkProblems(file), []);
  });

  it("finds offsets and stops of different length", () => {
    const file = fixtureFile();
    file.patterns.offsets[1] = [0, 600];
    assert.match(networkProblems(file).join("\n"), /pattern 1: 2 offsets for 3 stops/);
  });

  it("finds nothing wrong with the real network", { skip: !existsSync(FILE) && `${FILE} not built` }, () => {
    assert.deepEqual(networkProblems(JSON.parse(readFileSync(FILE, "utf8")) as NetworkFile), []);
  });
});
