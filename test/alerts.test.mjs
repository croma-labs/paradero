import assert from "node:assert/strict";
import { test } from "node:test";

import { humanizeAlert } from "@/transit/alerts";

test("turns control-room stop references into one plain sentence", () => {
  const a = humanizeAlert({ effect: "detour", description: "EMCONTRAVIA\\313A00_Br. San Felipe\\314A00_Br. Calle 75", routes: ["B10"] });
  assert.equal(a.title, "Desvío");
  assert.equal(a.detail, "Entre Br. San Felipe y Br. Calle 75.");
  assert.deepEqual(a.places, ["Br. San Felipe", "Br. Calle 75"]);
});

test("falls back to TransMilenio's own words when no stop is named", () => {
  const a = humanizeAlert({ effect: null, description: "Cierre por operacion especial", routes: [] });
  assert.equal(a.title, "Novedad en la operación");
  assert.equal(a.detail, "Cierre por operación especial.");
});
