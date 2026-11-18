/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { activeRoutes, isShown, toggleRoute } from "./route-filter.ts";

const all = ["A1", "B2", "C3"];

test("choosing a route adds it, and choosing it again removes it", () => {
  assert.deepEqual(toggleRoute([], "A1", all), ["A1"]);
  assert.deepEqual(toggleRoute(["A1"], "B2", all), ["A1", "B2"]);
  assert.deepEqual(toggleRoute(["A1", "B2"], "A1", all), ["B2"]);
});

test("removing the last chosen route goes back to All", () => {
  assert.deepEqual(toggleRoute(["A1"], "A1", all), []);
});

test("choosing every route goes back to All", () => {
  assert.deepEqual(toggleRoute(["A1", "B2"], "C3", all), []);
});

test("with a single route at the stop, choosing it is All", () => {
  assert.deepEqual(toggleRoute([], "A1", ["A1"]), []);
});

test("routes that stopped arriving are dropped from the choice", () => {
  assert.deepEqual(activeRoutes(["A1", "Z9"], all), ["A1"]);
  assert.deepEqual(toggleRoute(["Z9"], "A1", all), ["A1"]);
});

test("an empty filter shows everything; otherwise only the chosen routes", () => {
  assert.equal(isShown([], "A1"), true);
  assert.equal(isShown(["A1", "B2"], "B2"), true);
  assert.equal(isShown(["A1", "B2"], "C3"), false);
});
