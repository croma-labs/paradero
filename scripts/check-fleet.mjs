import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { lookupVehicleSize } from "../src/server/fleet.ts";
import { parseFleetCsv } from "./import-sitp-fleet.mjs";

// Real plates from every official type in the pinned December 2024 inventory.
for (const plate of ["VEW081", "VEO675", "TUP284"]) {
  assert.deepEqual(lookupVehicleSize(plate), { size: "small", asOf: "2024-12" });
}
for (const plate of ["WCM390", "TAU152", "TGW242", "TGW247", "WDD865"]) {
  assert.deepEqual(lookupVehicleSize(plate), { size: "large", asOf: "2024-12" });
}
assert.deepEqual(lookupVehicleSize(" wcm-390 "), lookupVehicleSize("WCM390"));
for (const plate of [null, undefined, "", "ZZZ999", "WCM3900", "WCM_390", "WCM390/", "Z50-7000", "507136", "16-5"]) {
  assert.equal(lookupVehicleSize(plate), null, `Must not guess size for ${plate}`);
}

const header = "matricula;descripcion_tipo;descripcion_estado_vinculacion\r\n";
const parse = (rows) => parseFleetCsv(Buffer.from(`${header}${rows}`));
const fixture = 'ABC123;"BUS (80)";Vinculado\r\nDEF456;BUS (40);Vinculado\r\nGHI789;UNKNOWN FUTURE TYPE;Vinculado\r\nJKL012;BUS (50);Desvinculado\r\n';
const data = parse(fixture);
assert.deepEqual(data, {
  vehicleCount: 3,
  ignoredRows: 1,
  groups: { "BUS (40)": ["DEF456"], "BUS (80)": ["ABC123"], "UNKNOWN FUTURE TYPE": ["GHI789"] },
});
assert.deepEqual(parse(fixture), data, "Parsing must be reproducible without attributing synthetic data to the source");
for (const [rows, error] of [
    ["ABC123;BUS (80);Vinculado\nABC123;BUS (40);Vinculado", /Conflicting plate/],
    ["ABC123;BUS (80);Vinculado\nABC123;BUS (80);Vinculado", /Duplicate plate/],
    ["not-a-plate;BUS (80);Vinculado", /Invalid plate/],
    ["ABC123;;Vinculado", /Missing vehicle type/],
    ['ABC123;"BUS (80);Vinculado', /Unclosed CSV quote/],
    ["ABC123;BUS (80)", /wrong number of columns/],
]) {
  assert.throws(() => parse(rows), error);
}

const folder = mkdtempSync(join(tmpdir(), "paradero-fleet-test-"));
try {
  const input = join(folder, "fixture.csv");
  const output = join(folder, "fleet.json");
  const script = fileURLToPath(new URL("./import-sitp-fleet.mjs", import.meta.url));
  const previous = readFileSync(new URL("../src/server/data/sitp-fleet.json", import.meta.url), "utf8");
  writeFileSync(input, `${header}${fixture}`);
  writeFileSync(output, previous);
  const result = spawnSync(process.execPath, [script, input, output], { encoding: "utf8" });
  assert.notEqual(result.status, 0, "Synthetic CSV must never receive the official source's attribution");
  assert.match(result.stderr, /Source SHA-256 mismatch/);
  assert.equal(readFileSync(output, "utf8"), previous, "Rejected input must preserve the previous snapshot");
} finally {
  assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
  assert.ok(basename(folder).startsWith("paradero-fleet-test-"));
  rmSync(folder, { recursive: true, force: true });
}

console.log("Fleet: exact matches, unknown plates, all size groups and deterministic validated imports pass.");
