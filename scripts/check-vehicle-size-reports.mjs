import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

// Load the actual server modules, including their path aliases, without Expo's native runtime.
const root = fileURLToPath(new URL("..", import.meta.url));
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  const module = { exports: {} };
  modules.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const nativeRequire = createRequire(file);
  const require = (specifier) => {
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return nativeRequire(specifier);
    let target = specifier.startsWith("@/") ? join(root, "src", specifier.slice(2)) : resolve(dirname(file), specifier);
    if (!extname(target)) target += ".ts";
    return load(target);
  };
  runInThisContext(`(function(require,module,exports,__filename,__dirname){${source}\n})`, { filename: file })(require, module, module.exports, file, dirname(file));
  return module.exports;
}

const { normalizeVehiclePlate, canReportVehicleSize } = load(join(root, "src/transit/vehicle-size-report.ts"));
assert.equal(normalizeVehiclePlate(" zzz-999 "), "ZZZ999");
for (const value of [null, undefined, "", "ZZZ9990", "ZZZ_999", "ZZZ999/", "Z50-7000", "K635", "name@example.com"]) {
  assert.equal(normalizeVehiclePlate(value), null);
}

const now = Date.parse("2026-11-18T03:00:00Z");
const feed = { live: true, asOf: new Date(now).toISOString() };
const arrival = { canReportVehicleSize: true, vehicleSize: null, basis: "estimated", system: "zonal_urbano", plate: "ZZZ999" };
assert.equal(canReportVehicleSize(arrival, feed, now), true);
assert.equal(canReportVehicleSize({ ...arrival, vehicleSize: undefined, basis: "predicted" }, feed, now), true);
for (const change of [
  { canReportVehicleSize: undefined }, { canReportVehicleSize: false },
  { vehicleSize: { size: "large", asOf: "2024-12" } },
  { basis: "scheduled" }, { system: "transmicable" }, { plate: null }, { plate: "Z50-7000" },
]) assert.equal(canReportVehicleSize({ ...arrival, ...change }, feed, now), false);
for (const change of [
  { live: false }, { asOf: "not-a-date" },
  { asOf: new Date(now - 300_001).toISOString() },
  { asOf: new Date(now + 30_001).toISOString() },
]) assert.equal(canReportVehicleSize(arrival, { ...feed, ...change }, now), false);
assert.equal(canReportVehicleSize(arrival, { ...feed, asOf: new Date(now - 300_000).toISOString() }, now), true);
assert.equal(canReportVehicleSize(arrival, feed, NaN), false);

const previousToken = process.env.GITHUB_REPORTS_TOKEN;
const previousRepo = process.env.REPORTS_REPO;
const originalFetch = globalThis.fetch;
const originalError = console.error;
const sourcePath = join(root, "src/server/data/sitp-fleet.json");
const sourceBefore = readFileSync(sourcePath, "utf8");
let calls = [];
let responseMode = "success";
try {
  process.env.REPORTS_REPO = "community-test/reports";
  delete process.env.GITHUB_REPORTS_TOKEN;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.github.com/repos/community-test/reports/issues", "No real upstream requests are permitted in this test");
    assert.equal(options.method, "POST");
    calls.push(JSON.parse(options.body));
    if (responseMode === "failure") return new Response("mock upstream failure", { status: 500 });
    return Response.json({ number: 7, html_url: "https://github.com/community-test/reports/issues/7" }, { status: 201 });
  };
  const { vehicleSizeReportInput, vehicleSizeReportsAvailable, fileVehicleSizeReport } = load(join(root, "src/server/vehicle-size-report.ts"));
  const { lookupVehicleSize } = load(join(root, "src/server/fleet.ts"));
  const { POST } = load(join(root, "src/app/api/vehicle-size-reports+api.ts"));
  const { allow } = load(join(root, "src/server/report.ts"));
  const input = { plate: " zzz-999 ", size: "small", observed: true, app: { version: "0.0.6", platform: "android" } };
  const parsed = vehicleSizeReportInput.parse(input);
  assert.equal(parsed.plate, "ZZZ999");
  for (const change of [
    { plate: "person@example.com" }, { plate: "ABC1234" }, { plate: null },
    { observed: false }, { observed: undefined }, { size: "medium" }, { size: null },
    { location: { latitude: 4.6, longitude: -74.1 } }, { message: "free text" }, { deviceId: "stable-id" },
    { app: { version: "0.0.6", platform: "android", userId: "someone" } },
    { app: { version: "@someone\n|injection|", platform: "android" } },
    { app: { version: "0.0.6", platform: "desktop" } },
  ]) assert.equal(vehicleSizeReportInput.safeParse({ ...input, ...change }).success, false);

  let requestNumber = 0;
  const post = (body, client = `test-${++requestNumber}`) => POST(new Request("http://localhost/api/vehicle-size-reports", {
    method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": client }, body: JSON.stringify(body),
  }));
  assert.equal(vehicleSizeReportsAvailable(), false);
  process.env.GITHUB_REPORTS_TOKEN = "  ";
  assert.equal(vehicleSizeReportsAvailable(), false);
  assert.equal((await post(input)).status, 503);
  await assert.rejects(fileVehicleSizeReport(parsed), (error) => error.code === "reports_unavailable" && error.status === 503);
  assert.equal(calls.length, 0);

  process.env.GITHUB_REPORTS_TOKEN = "mock-token-only";
  assert.equal(vehicleSizeReportsAvailable(), true);
  assert.equal((await post({ ...input, observed: false })).status, 400);
  const malformed = await POST(new Request("http://localhost/api/vehicle-size-reports", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  assert.equal((await post({ ...input, plate: " wcm-390 " })).status, 409);
  assert.equal(calls.length, 0, "Known or invalid observations must not create issues");

  const response = await post(input);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { number: 7, url: "https://github.com/community-test/reports/issues/7", status: "pending_review" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].title, /ZZZ999: pequeño/);
  assert.match(calls[0].body, /Observación comunitaria pendiente de revisión/);
  assert.match(calls[0].body, /comprobó que la placa coincide/);
  assert.match(calls[0].body, /No es una confirmación oficial/);
  assert.deepEqual(calls[0].labels, ["reporte ciudadano"]);
  assert.doesNotMatch(calls[0].body, /test-|latitude|longitude|deviceId|stable-id/);
  assert.equal(lookupVehicleSize("ZZZ999"), null, "A submitted report must not become a confirmed size");

  await post({ ...input, size: "large" });
  assert.match(calls.at(-1).body, /ZZZ999: grande/);
  const beforeFailure = calls.length;
  responseMode = "failure";
  console.error = () => {};
  const failed = await post(input);
  console.error = originalError;
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error.code, "reports_failed");
  assert.equal(calls.length, beforeFailure + 1);

  // The new endpoint consumes the same per-connection budget as ordinary reports.
  for (let i = 0; i < 5; i++) assert.equal(allow("shared-budget-test"), true);
  const beforeLimited = calls.length;
  const limited = await post(input, "shared-budget-test");
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "too_many");
  assert.equal(calls.length, beforeLimited);
  assert.equal(readFileSync(sourcePath, "utf8"), sourceBefore, "Reports must never rewrite the source register");
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  if (previousToken === undefined) delete process.env.GITHUB_REPORTS_TOKEN;
  else process.env.GITHUB_REPORTS_TOKEN = previousToken;
  if (previousRepo === undefined) delete process.env.REPORTS_REPO;
  else process.env.REPORTS_REPO = previousRepo;
}

console.log("Vehicle size reports: capability, freshness, strict input, review-only submission, shared limits and upstream errors pass; all network calls mocked.");
