import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeAddress, parseAddress, parseStreet, streetKey } from "../../src/transit/address.ts";
import { metres } from "../../src/transit/network.ts";
import { decodePlaces, geocode, PLACES_VERSION, resolve, search, type PlacesFile } from "../../src/transit/places.ts";
import { fixture } from "./fixture.ts";

describe("parseAddress", () => {
  const cases: [string, string | null][] = [
    ["Calle 72 # 10-34", "CL 72|KR 10|34"],
    ["Cl 72 No. 10 - 34", "CL 72|KR 10|34"],
    ["CL 72 10 34", "CL 72|KR 10|34"],
    ["Kr 7 # 45-20", "KR 7|CL 45|20"],
    ["Av. Cra 68 # 13-25", "KR 68|CL 13|25"],
    ["AK 30 # 45-03", "KR 30|CL 45|3"],
    ["Avenida Calle 26 # 69-76", "CL 26|KR 69|76"],
    ["Diagonal 40A Bis # 15-30", "DG 40ABIS|KR 15|30"],
    ["Carrera 7 Bis A # 124-30", "KR 7BISA|CL 124|30"],
    ["Transversal 93 # 53-32", "TV 93|CL 53|32"],
    ["Cra. 7 #32-16, apto 301", "KR 7|CL 32|16"],
    // "Sur" belongs to the calle and "Este" to the carrera, wherever they are written
    ["Calle 13 Sur # 50-10", "CL 13 SUR|KR 50|10"],
    ["Carrera 10 # 15-20 Sur", "KR 10|CL 15 SUR|20"],
    ["Carrera 1 Este # 20-10", "KR 1 ESTE|CL 20|10"],
    ["Calle 20 # 5-10 Este", "CL 20|KR 5 ESTE|10"],
    ["Calle 72 con Carrera 10", "CL 72|KR 10|null"],
    ["Calle 72 con 10", "CL 72|KR 10|null"],
    ["Cl 72 x Kr 10", "CL 72|KR 10|null"],
    ["Calle 72 con Calle 10", null],
    ["Calle 1000 # 2-3", null],
    ["Unicentro", null],
  ];
  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)}`, () => {
      const a = parseAddress(input);
      assert.equal(a ? `${streetKey(a.primary)}|${streetKey(a.cross)}|${a.placa}` : null, expected);
    });
  }

  it("reads Sur and Este only as whole words, and keeps whatever follows", () => {
    const a = parseAddress("Calle 72 # 10-34 Surtimax")!;
    assert.equal(streetKey(a.primary), "CL 72");
    assert.equal(a.extra, "surtimax");
    assert.equal(streetKey(parseAddress("Carrera 7 # 72-41 Esteban")!.primary), "KR 7");
    assert.equal(parseAddress("Calle 72 # 10-34 apto 301")!.extra, "");
    assert.equal(parseAddress("Calle 72 # 10-34 y Calle 80 # 15-20")!.extra, "y calle 80 # 15-20");
  });

  it("writes the address back the way it is written in Bogotá", () => {
    assert.equal(describeAddress(parseAddress("cl 72 #10-4")!), "Calle 72 # 10-04");
    assert.equal(describeAddress(parseAddress("Calle 72 con 10")!), "Calle 72 con Carrera 10");
  });

  it("reads OpenStreetMap street names into the same keys", () => {
    assert.equal(streetKey(parseStreet("Avenida Calle 26")!), "CL 26");
    assert.equal(streetKey(parseStreet("Avenida Carrera 7")!), "KR 7");
    assert.equal(streetKey(parseStreet("Carrera 7 Bis A Este")!), "KR 7BISA ESTE");
    assert.equal(parseStreet("Avenida Boyacá"), null);
  });
});

// A grid around Calle 72: carreras grow westward, about 111 m per 0.001° of longitude here
const H = (lat: number, from: number, to: number) => [Math.round(lat * 1e5), Math.round(from * 1e5), Math.round(lat * 1e5), Math.round(to * 1e5)];
const V = (lon: number, from: number, to: number) => [Math.round(from * 1e5), Math.round(lon * 1e5), Math.round(to * 1e5), Math.round(lon * 1e5)];
const placesFile: PlacesFile = {
  version: PLACES_VERSION,
  asOf: "2026-11-10",
  source: "fixture",
  builtAt: "2026-11-10T00:00:00Z",
  streets: {
    key: ["CL 72", "KR 10", "KR 11", "KR 6", "CL 14", "CL 16", "CL 50", "KR 20", "CL 50", "KR 20", "CL 71", "CL 73", "KR 21", "KR 21", "CL 60", "KR 14"],
    name: ["Calle 72", "Carrera 10", "Carrera 11", "Carrera 6", "Calle 14", "Calle 16", "Calle 50", "Carrera 20", "Calle 50", "Carrera 20", "Calle 71", "Calle 73", "Carrera 21", "Carrera 21", "Calle 60", "Carrera 14"],
    line: [
      H(4.657, -74.07, -74.05),
      V(-74.058, 4.65, 4.665),
      V(-74.059, 4.65, 4.665),
      // Carrera 6 meets Calle 14 and Calle 16 but not Calle 15 (a park in between)
      V(-74.072, 4.59, 4.61),
      H(4.6, -74.08, -74.06),
      H(4.602, -74.08, -74.06),
      // The same Calle 50 / Carrera 20 corner exists in two parts of the city
      H(4.62, -74.09, -74.07),
      V(-74.08, 4.61, 4.63),
      H(4.7, -74.09, -74.07),
      V(-74.08, 4.69, 4.71),
      // The grid around Calle 72 # 10, so the corner is confirmed along both streets
      H(4.656, -74.07, -74.05),
      H(4.658, -74.07, -74.05),
      // Carrera 21 next to both Calle 50 / Carrera 20 corners
      V(-74.081, 4.61, 4.63),
      V(-74.081, 4.69, 4.71),
      // A lone Calle 60 / Carrera 14 corner with no neighbouring streets at all: same numbers, wrong place
      H(4.5, -74.2, -74.18),
      V(-74.19, 4.49, 4.51),
    ],
  },
  places: {
    id: ["w1", "w2", "n3", "n4", "n5"],
    name: ["Unicentro", "Unicentro de Occidente", "Quinta Camacho", "Teusaquillo", "Suba"],
    kind: ["centro comercial", "centro comercial", "barrio", "barrio", "barrio"],
    weight: [11, 9, 6, 6, 6],
    lat: [470_200, 469_000, 465_800, 462_000, 470_000],
    lon: [-7_404_160, -7_412_000, -7_405_900, -7_408_000, -7_408_000],
  },
};
const places = decodePlaces(placesFile);
const net = fixture();

describe("geocode", () => {
  it("finds the corner and walks the placa toward the next carrera", () => {
    const g = geocode(places, parseAddress("Calle 72 # 10-34")!);
    assert.ok("results" in g && g.results.length === 1);
    const r = g.results[0];
    assert.equal(r.confidence, "exact");
    assert.ok(Math.abs(metres(r.lat, r.lon, 4.657, -74.058) - 34) < 3, `placa offset ${metres(r.lat, r.lon, 4.657, -74.058)}`);
    assert.ok(r.lon < -74.058, "moves west, toward Carrera 11");
  });

  it("places a block whose cross street never reaches it between the corners that do", () => {
    // Calle 14 is at 4.600 and Calle 16 at 4.602: "15-50" sits three quarters of the way
    const g = geocode(places, parseAddress("Carrera 6 # 15-50")!);
    assert.ok("results" in g);
    assert.equal(g.results[0].confidence, "approximate");
    assert.ok(Math.abs(g.results[0].lat - 4.6015) < 0.0001, `lat ${g.results[0].lat}`);
  });

  it("returns every place an address exists in, so the rider can choose", () => {
    const g = geocode(places, parseAddress("Calle 50 # 20-10")!);
    assert.ok("results" in g && g.results.length === 2);
    assert.ok(g.results.every((r) => r.confidence === "approximate"));
  });

  it("refuses a lone corner the neighbouring grid does not confirm", () => {
    const g = geocode(places, parseAddress("Calle 60 # 14-10")!);
    assert.ok("error" in g && g.error.includes("no encaja"));
  });

  it("says which street it does not know instead of guessing", () => {
    const g = geocode(places, parseAddress("Calle 72 # 99-10")!);
    assert.ok("error" in g && g.error.includes("Carrera 99"));
  });
});

describe("resolve", () => {
  it("asks which one when an address exists twice", () => {
    const r = resolve(net, places, "Calle 50 # 20-10");
    assert.ok("candidates" in r && r.candidates.length === 2);
    assert.ok(r.candidates.every((c) => c.note?.includes("pregunta cuál")));
    const picked = resolve(net, places, r.candidates[1].id);
    assert.ok("candidates" in picked && picked.candidates.length === 1 && picked.candidates[0].confidence === "exact");
  });

  it("refuses a device location outside Bogotá", () => {
    assert.deepEqual(resolve(net, places, "geo:6.2442,-75.5812"), { error: "Ese punto no está en Bogotá." });
  });

  it("rounds a device location before using it", () => {
    const r = resolve(net, places, "geo:4.6412345,-74.0901234");
    assert.ok("candidates" in r && r.candidates[0].id === "geo:4.6412,-74.0901");
  });

  it("puts the famous place first and is sure of it", () => {
    const found = search(net, places, "unicentro");
    assert.equal(found[0].label, "Unicentro");
    assert.equal(found[0].confidence, "exact");
  });

  it("refuses a device location far from every stop", () => {
    const r = resolve(net, places, "geo:4.45,-74.15");
    assert.ok("error" in r && r.error.includes("1,5 km"));
  });

  it("refuses an address in another municipality instead of placing it in Bogotá", () => {
    const r = resolve(net, places, "Calle 72 # 10-34 Chía");
    assert.ok("error" in r && r.error.includes("Bogotá D.C."));
  });

  it("never drops words after an address silently", () => {
    const r = resolve(net, places, "Calle 72 # 10-34 Surtimax");
    assert.ok("candidates" in r);
    assert.equal(r.candidates[0].confidence, "approximate");
    assert.ok(r.candidates[0].note?.includes("surtimax"));
  });

  it("never treats one generic word as a sure place", () => {
    const found = search(net, places, "unicentro de");
    assert.ok(found.length > 0);
    assert.deepEqual(search(net, places, "barrio").map((c) => c.confidence), search(net, places, "barrio").map(() => "approximate"));
  });

  it("refuses a made-up pick of several addresses", () => {
    assert.ok("error" in resolve(net, places, "addr:Calle 50 # 20-10@"));
    assert.ok("error" in resolve(net, places, "addr:Calle 50 # 20-10@x"));
  });

  it("says it does not know a place rather than inventing one", () => {
    const r = resolve(net, places, "asdfgh");
    assert.ok("error" in r);
  });
});
