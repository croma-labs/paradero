import assert from "node:assert/strict";
import { test } from "node:test";

import { minutesLeft } from "@/transit/time";

const now = Date.parse("2026-11-09T08:00:00-05:00");

test("counts the minutes down from the predicted time", () => {
  assert.equal(minutesLeft({ minutes: 5, at: "2026-11-09T08:04:59-05:00" }, now), 4);
  assert.equal(minutesLeft({ minutes: 3, at: "2026-11-09T07:59:00-05:00" }, now), 0);
});

test("falls back to the server's minutes without a usable time", () => {
  assert.equal(minutesLeft({ minutes: 7, at: null }, now), 7);
  assert.equal(minutesLeft({ minutes: 2, at: "not a time" }, now), 2);
  assert.equal(minutesLeft({ minutes: null, at: null }, now), null);
});
