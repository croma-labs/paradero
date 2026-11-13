/// <reference types="node" />
/**
 * Builds public/network/places.json from OpenStreetMap: every named street of Bogotá under its
 * nomenclature key (so "Calle 72 # 10-34" can be found), plus landmarks and barrios.
 *
 *   node scripts/build-places.ts                     # queries the Overpass API
 *   node scripts/build-places.ts --osm-dir ./osm     # reads streets.json and pois.json from there
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fold, parseStreet, streetKey } from "../src/transit/address.ts";
import { PLACES_VERSION, type PlacesFile } from "../src/transit/places.ts";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const BBOX = "(4.44,-74.25,4.84,-73.98)";
const OUT = "public/network/places.json";
const SIMPLIFY_M = 5;

/** Only Bogotá D.C. (wikidata Q2841): Soacha, Chía and Funza reuse the same street numbers. */
const STREETS_QUERY = `[out:json][timeout:240];area["wikidata"="Q2841"]->.bog;way[highway][name~"^(Calle|Carrera|Avenida|Diagonal|Transversal|Autopista|Circunvalar)",i](area.bog);out tags geom qt;`;
const PLACES_QUERY =
  `[out:json][timeout:240];(` +
  `nwr[amenity~"^(university|college|hospital|clinic|school|library|townhall|marketplace|theatre|cinema|bus_station|courthouse|police|place_of_worship|arts_centre|community_centre|conference_centre|events_venue)$"][name]${BBOX};` +
  `nwr[shop~"^(mall|department_store|supermarket)$"][name]${BBOX};` +
  `nwr[leisure~"^(stadium|park|sports_centre|sports_hall)$"][name]${BBOX};` +
  `nwr[tourism~"^(museum|attraction|zoo|hotel)$"][name]${BBOX};` +
  `nwr[aeroway~"^(aerodrome|terminal)$"][name]${BBOX};` +
  `nwr[office=government][name]${BBOX};` +
  `node[place~"^(neighbourhood|suburb|quarter)$"][name]${BBOX};` +
  `);out center tags qt;`;

/** What a rider would call each kind of place, and how likely it is to be the one they mean. */
const KINDS: [string, string, string, number][] = [
  ["aeroway", "aerodrome", "aeropuerto", 10],
  ["aeroway", "terminal", "aeropuerto", 9],
  // TransMilenio stations come from the GTFS; only intercity terminals are kept from OSM
  ["amenity", "bus_station", "terminal de buses", 7],
  ["amenity", "university", "universidad", 9],
  ["amenity", "college", "institución educativa", 6],
  ["amenity", "hospital", "hospital", 8],
  ["amenity", "clinic", "clínica", 6],
  ["shop", "mall", "centro comercial", 9],
  ["shop", "department_store", "almacén", 5],
  ["shop", "supermarket", "supermercado", 3],
  ["leisure", "stadium", "estadio", 9],
  ["leisure", "sports_hall", "coliseo", 7],
  ["leisure", "sports_centre", "centro deportivo", 5],
  ["leisure", "park", "parque", 6],
  ["tourism", "museum", "museo", 7],
  ["tourism", "attraction", "sitio turístico", 6],
  ["tourism", "zoo", "zoológico", 7],
  ["tourism", "hotel", "hotel", 3],
  ["amenity", "theatre", "teatro", 6],
  ["amenity", "cinema", "cine", 4],
  ["amenity", "library", "biblioteca", 6],
  ["amenity", "marketplace", "plaza de mercado", 6],
  ["amenity", "townhall", "alcaldía", 6],
  ["amenity", "courthouse", "juzgados", 5],
  ["amenity", "police", "policía", 3],
  ["amenity", "events_venue", "sitio de eventos", 7],
  ["amenity", "conference_centre", "centro de convenciones", 7],
  ["amenity", "arts_centre", "centro cultural", 5],
  ["amenity", "community_centre", "centro comunitario", 3],
  ["amenity", "place_of_worship", "iglesia", 3],
  ["amenity", "school", "colegio", 4],
  ["office", "government", "entidad pública", 5],
  ["place", "suburb", "sector", 6],
  ["place", "quarter", "sector", 6],
  ["place", "neighbourhood", "barrio", 6],
];

const NAME_TAGS = ["name", "official_name", "alt_name", "old_name", "loc_name", "short_name", "name:es"];
/** Avenues whose ways carry only their own name in OpenStreetMap, with the grid street they are. */
const GRID_ALIASES: Record<string, string> = { "avenida jimenez": "CL 13", "avenida jimenez de quesada": "CL 13" };

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

type Element = {
  type: string;
  id: number;
  tags: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
};

async function overpass(query: string, cache: string): Promise<Element[]> {
  const dir = arg("osm-dir");
  if (dir && existsSync(join(dir, cache))) return (JSON.parse(readFileSync(join(dir, cache), "utf8")) as { elements: Element[] }).elements;
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": "paradero-build (github.com/croma-labs/paradero)", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
  const text = await res.text();
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, cache), text);
  }
  return (JSON.parse(text) as { elements: Element[] }).elements;
}

/** Douglas–Peucker in metres. */
function simplify(points: { lat: number; lon: number }[], tolerance: number): { lat: number; lon: number }[] {
  if (points.length < 3) return points;
  const k = Math.cos((points[0].lat * Math.PI) / 180) * 111_320;
  const xy = points.map((p) => [p.lon * k, p.lat * 110_540]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - xy[i][1]) - (ax - xy[i][0]) * (by - ay)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

async function main() {
  const streets = await overpass(STREETS_QUERY, "streets-bogota.json");
  const pois = await overpass(PLACES_QUERY, "pois.json");

  const file: PlacesFile = {
    version: PLACES_VERSION,
    asOf: new Date().toISOString().slice(0, 10),
    source: "© OpenStreetMap contributors, ODbL 1.0",
    builtAt: new Date().toISOString(),
    streets: { key: [], name: [], line: [] },
    places: { id: [], name: [], kind: [], weight: [], lat: [], lon: [] },
  };

  let unparsed = 0;
  for (const w of streets) {
    if (!w.geometry || w.geometry.length < 2) continue;
    const keys = new Set<string>();
    for (const tag of NAME_TAGS) {
      for (const value of (w.tags[tag] ?? "").split(";")) {
        if (!value.trim()) continue;
        const street = parseStreet(value);
        if (street) keys.add(streetKey(street));
        else if (GRID_ALIASES[fold(value)]) keys.add(GRID_ALIASES[fold(value)]);
        else if (tag === "name" || tag === "official_name") keys.add(`NOMBRE ${fold(value)}`);
      }
    }
    if (!keys.size) {
      unparsed++;
      continue;
    }
    const line = simplify(w.geometry, SIMPLIFY_M).flatMap((p) => [Math.round(p.lat * 1e5), Math.round(p.lon * 1e5)]);
    for (const key of keys) {
      file.streets.key.push(key);
      file.streets.name.push(w.tags.name);
      file.streets.line.push(line);
    }
  }

  const seen = new Set<string>();
  for (const e of pois) {
    const kind = KINDS.find(([tag, value]) => e.tags[tag] === value);
    const point = e.center ?? (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
    if (!kind || !point) continue;
    const name = e.tags.name.trim();
    if (kind[2] === "terminal de buses" && !fold(name).includes("terminal")) continue;
    // Places famous enough for Wikipedia are the ones riders usually mean
    const fame = (e.tags.wikidata || e.tags.wikipedia ? 2 : 0) + (e.tags.iata ? 2 : 0);
    const dedupe = `${fold(name)}|${kind[2]}|${point.lat.toFixed(3)},${point.lon.toFixed(3)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    file.places.id.push(`${e.type[0]}${e.id}`);
    file.places.name.push(name);
    file.places.kind.push(kind[2]);
    file.places.weight.push(kind[3] + fame);
    file.places.lat.push(Math.round(point.lat * 1e5));
    file.places.lon.push(Math.round(point.lon * 1e5));
  }

  mkdirSync("public/network", { recursive: true });
  const json = JSON.stringify(file);
  writeFileSync(arg("out") ?? OUT, json);
  console.log(
    `Wrote ${arg("out") ?? OUT}: ${(json.length / 1e6).toFixed(1)} MB, ${file.streets.key.length} street lines ` +
      `(${new Set(file.streets.key).size} streets, ${unparsed} names not in the grid), ${file.places.id.length} places`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
