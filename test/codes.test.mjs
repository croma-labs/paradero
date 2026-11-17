import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeRoutes, describeRoute, directionsOf } from "@/transit/codes";

const route = (id, shortName, longName, system = "troncal") => describeRoute({ id, shortName, longName, system });

test("reads the halves of a paired SITP route back out of its long name", () => {
  const r = route("12429", "HK635", "K635 Montevideo || H635 Arborizadora Alta", "zonal_urbano");
  assert.equal(r.code, "K635 · H635");
  assert.deepEqual(r.aliases, ["K635", "H635"]);
  assert.equal(r.name, "Montevideo – Arborizadora Alta");
  assert.equal(r.feedCode, "HK635");
});

test("keeps the everyday service over its holiday twin", () => {
  const kept = dedupeRoutes([route("a", "B10", "Portal Norte Festivo"), route("b", "B10", "Portal Norte")]);
  assert.deepEqual(kept.map((r) => r.id), ["b"]);
});

test("finds every direction of a route, in a stable order", () => {
  const here = route("11231", "1", "Universidades");
  const sameCode = [here, route("13171", "1", "Portal Eldorado"), route("13999", "1", "Portal Eldorado Festivo"), route("10075", "B10", "Portal Norte")];
  const both = [["13171", "Portal Eldorado"], ["11231", "Universidades"]];
  assert.deepEqual(directionsOf(here, sameCode).map((r) => [r.id, r.name]), both);
  assert.deepEqual(directionsOf(sameCode[1], sameCode).map((r) => [r.id, r.name]), both, "same order from the other direction");
  assert.deepEqual(directionsOf(route("10075", "B10", "Portal Norte"), sameCode).map((r) => r.id), ["10075"]);
});
