/**
 * Turns what a rider says ("Calle 72 # 10-34", "Unicentro", "la estación Héroes", a shared
 * location) into a point, and describes any point back in words a rider can check: the barrio,
 * the nearest TransMilenio station and the nearest SITP stop. Nothing is ever guessed: a place we
 * cannot pin down comes back as "not found", and anything short of certain says so.
 */
import { describeAddress, fold, keyVariants, parseAddress, streetKey, type Address, type Street } from "./address.ts";
import { metres, stopsNear, type Network } from "./network.ts";

export const PLACES_VERSION = 1;
/** Corners closer than this are the same corner. */
const EXACT_GAP_M = 40;
/** Beyond this the two streets do not meet. */
const MAX_GAP_M = 150;
/** Bogotá D.C., Sumapaz included, plus Soacha's TransMilenio: Chía and Funza fall outside. */
const BOGOTA = { minLat: 3.72, maxLat: 4.84, minLon: -74.47, maxLon: -73.98 };
/** A corner this far from every neighbouring corner of the grid is somewhere else with the same numbers. */
const PHANTOM_M = 700;
/** Places riders name that are not Bogotá. Their addresses reuse Bogotá's numbers. */
const MUNICIPALITIES = [
  "soacha", "chia", "cajica", "zipaquira", "funza", "mosquera", "madrid", "cota", "la calera", "sopo", "tocancipa", "facatativa",
  "tenjo", "tabio", "sibate", "fusagasuga", "girardot", "medellin", "cali", "barranquilla", "cartagena",
];
/** One word that names a kind of place, not a place. */
const GENERIC = new Set(["hospital", "clinica", "terminal", "biblioteca", "parque", "universidad", "colegio", "estacion", "portal", "centro", "iglesia", "museo", "estadio", "aeropuerto", "plaza", "mercado", "supermercado", "hotel", "teatro", "cine", "alcaldia", "paradero", "barrio"]);

export interface PlacesFile {
  version: number;
  asOf: string;
  source: string;
  builtAt: string;
  streets: { key: string[]; name: string[]; line: number[][] };
  places: { id: string[]; name: string[]; kind: string[]; weight: number[]; lat: number[]; lon: number[] };
}

export interface Places {
  lines: Map<string, Float64Array[]>;
  names: Map<string, string>;
  file: PlacesFile;
  folded: string[];
  lat: Float64Array;
  lon: Float64Array;
}

export function decodePlaces(file: PlacesFile): Places {
  if (file.version !== PLACES_VERSION) throw new Error(`Places file v${file.version}, expected v${PLACES_VERSION}.`);
  const lines = new Map<string, Float64Array[]>();
  const names = new Map<string, string>();
  file.streets.key.forEach((key, i) => {
    const list = lines.get(key) ?? [];
    list.push(Float64Array.from(file.streets.line[i], (v) => v / 1e5));
    lines.set(key, list);
    if (!names.has(key)) names.set(key, file.streets.name[i]);
  });
  return {
    lines,
    names,
    file,
    folded: file.places.name.map(fold),
    lat: Float64Array.from(file.places.lat, (v) => v / 1e5),
    lon: Float64Array.from(file.places.lon, (v) => v / 1e5),
  };
}

export type Confidence = "exact" | "approximate";

export interface Nearby {
  barrio: string | null;
  /** Nearest TransMilenio station (troncal or TransMiCable). */
  station: { name: string; metres: number } | null;
  /** Nearest SITP street stop. */
  stop: { name: string; code: string; metres: number } | null;
}

export interface Candidate {
  /** Pass this to the planner: it is resolved again on the server, never trusted as coordinates. */
  id: string;
  label: string;
  kind: string;
  lat: number;
  lon: number;
  confidence: Confidence;
  near: Nearby;
  note?: string;
}

export const inBogota = (lat: number, lon: number) => lat > BOGOTA.minLat && lat < BOGOTA.maxLat && lon > BOGOTA.minLon && lon < BOGOTA.maxLon;

// ---------- Streets and corners ----------

function closest(a: Float64Array, b: Float64Array): { gap: number; lat: number; lon: number } {
  // Nearest approach between two polylines, from their segments
  let best = { gap: Infinity, lat: 0, lon: 0 };
  for (let i = 0; i + 3 < a.length; i += 2) {
    for (let j = 0; j + 3 < b.length; j += 2) {
      const hit = segments(a[i], a[i + 1], a[i + 2], a[i + 3], b[j], b[j + 1], b[j + 2], b[j + 3]);
      if (hit.gap < best.gap) best = hit;
    }
  }
  return best;
}

function segments(a1: number, o1: number, a2: number, o2: number, b1: number, p1: number, b2: number, p2: number) {
  const k = Math.cos((a1 * Math.PI) / 180) * 111_320;
  const ax = o1 * k;
  const ay = a1 * 110_540;
  const ux = o2 * k - ax;
  const uy = a2 * 110_540 - ay;
  const bx = p1 * k;
  const by = b1 * 110_540;
  const vx = p2 * k - bx;
  const vy = b2 * 110_540 - by;
  const den = ux * vy - uy * vx;
  if (den !== 0) {
    const t = ((bx - ax) * vy - (by - ay) * vx) / den;
    const s = ((bx - ax) * uy - (by - ay) * ux) / den;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return { gap: 0, lat: (ay + t * uy) / 110_540, lon: (ax + t * ux) / k };
  }
  // No crossing: nearest endpoint to the other segment
  const project = (px: number, py: number, qx: number, qy: number, wx: number, wy: number) => {
    const len = wx * wx + wy * wy || 1;
    const t = Math.max(0, Math.min(1, ((px - qx) * wx + (py - qy) * wy) / len));
    const x = qx + t * wx;
    const y = qy + t * wy;
    return { gap: Math.hypot(px - x, py - y), x: (px + x) / 2, y: (py + y) / 2 };
  };
  const options = [
    project(ax, ay, bx, by, vx, vy),
    project(ax + ux, ay + uy, bx, by, vx, vy),
    project(bx, by, ax, ay, ux, uy),
    project(bx + vx, by + vy, ax, ay, ux, uy),
  ];
  const o = options.reduce((m, x) => (x.gap < m.gap ? x : m));
  return { gap: o.gap, lat: o.y / 110_540, lon: o.x / k };
}

interface Corner {
  gap: number;
  lat: number;
  lon: number;
  typed: boolean;
}

/** Every place where two streets meet, one per area: the same pair can meet in two parts of the city. */
function corners(p: Places, a: Street, b: Street): Corner[] {
  const av = keyVariants(a);
  const bv = keyVariants(b);
  const hits: Corner[] = [];
  const collect = (ka: string, kb: string, typed: boolean) => {
    for (const la of p.lines.get(ka) ?? []) {
      for (const lb of p.lines.get(kb) ?? []) {
        const c = closest(la, lb);
        if (c.gap <= MAX_GAP_M) hits.push({ ...c, typed });
      }
    }
  };
  collect(av[0], bv[0], true);
  // Sibling types (a calle written as diagonal) only when the street as written does not meet
  if (!hits.some((h) => h.gap <= EXACT_GAP_M)) {
    for (let i = 0; i < av.length; i++) for (let j = 0; j < bv.length; j++) if (i || j) collect(av[i], bv[j], false);
  }
  hits.sort((x, y) => x.gap + (x.typed ? 0 : 25) - (y.gap + (y.typed ? 0 : 25)));
  const out: Corner[] = [];
  for (const h of hits) if (!out.some((o) => metres(o.lat, o.lon, h.lat, h.lon) < 800)) out.push(h);
  return out;
}

export interface Geocoded {
  lat: number;
  lon: number;
  confidence: Confidence;
}

/** Points for a Bogotá address (more than one when the address exists in two places), or why it could not be placed. */
export function geocode(p: Places, a: Address): { results: Geocoded[] } | { error: string } {
  const primaryKnown = keyVariants(a.primary).some((k) => p.lines.has(k));
  const crossKnown = keyVariants(a.cross).some((k) => p.lines.has(k));
  if (!primaryKnown) return { error: `No encuentro la ${streetLabel(a.primary)} en el mapa de Bogotá.` };
  if (!crossKnown) {
    // Some grid numbers only exist in addresses: the block is still between its neighbours
    const between = interpolate(p, a);
    return between ? { results: [between] } : { error: `No encuentro la ${streetLabel(a.cross)} en el mapa de Bogotá.` };
  }
  const found = corners(p, a.primary, a.cross);
  if (!found.length) {
    // The grid still numbers a block whose cross street never reaches it (a park, a campus):
    // place it between the nearest corners that do exist on the same street.
    const between = interpolate(p, a);
    if (between) return { results: [between] };
    return { error: `No encontré el cruce de la ${streetLabel(a.primary)} con la ${streetLabel(a.cross)} en el mapa.` };
  }

  // A corner the neighbouring grid does not confirm is the same numbers in another part of the city
  const close = (m: number | null) => m !== null && m <= PHANTOM_M;
  const checked = found
    .map((c) => {
      const n = neighbours(p, a, c);
      return { c, both: close(n.along) && close(n.across), one: close(n.along) || close(n.across) };
    })
    .filter((x) => x.one);
  if (!checked.length) {
    const between = interpolate(p, a);
    if (between) return { results: [between] };
    return { error: `El cruce de la ${streetLabel(a.primary)} con la ${streetLabel(a.cross)} que encuentro no encaja con las calles vecinas, así que no lo voy a usar.` };
  }

  const results = checked.map(({ c, both }) => {
    let lat = c.lat;
    let lon = c.lon;
    let placed = a.placa == null || a.placa < 30;
    if (a.placa != null && a.placa > 0) {
      // The placa counts metres from this corner toward the next cross street
      const next = corners(p, a.primary, { ...a.cross, number: a.cross.number + 1, suffix: "" })
        .map((n) => ({ n, d: metres(c.lat, c.lon, n.lat, n.lon) }))
        .filter((x) => x.d > 0 && x.d < 400)
        .sort((x, y) => x.d - y.d)[0];
      if (next && a.placa <= next.d + 20) {
        const t = Math.min(a.placa / next.d, 1);
        lat = c.lat + (next.n.lat - c.lat) * t;
        lon = c.lon + (next.n.lon - c.lon) * t;
        placed = true;
      }
    }
    const confidence: Confidence = checked.length === 1 && c.gap <= EXACT_GAP_M && c.typed && both && placed ? "exact" : "approximate";
    return { lat, lon, confidence };
  });
  return { results };
}

/**
 * How well the grid around a corner agrees with it: the nearest corner with a neighbouring number
 * along the primary street, and along the cross street. A real corner has both close by; the same
 * numbers reused in another part of the city usually have neither.
 */
function neighbours(p: Places, a: Address, c: Corner): { along: number | null; across: number | null } {
  const nearest = (pairs: [Street, Street][]) => {
    let best: number | null = null;
    for (const [x, y] of pairs) {
      if (x.number < 0 || y.number < 0) continue;
      for (const n of corners(p, x, y)) {
        if (!n.typed) continue;
        const m = metres(c.lat, c.lon, n.lat, n.lon);
        if (best === null || m < best) best = m;
      }
    }
    return best;
  };
  const steps = [-2, -1, 1, 2];
  return {
    along: nearest(steps.map((d) => [a.primary, { ...a.cross, number: a.cross.number + d, suffix: "" }])),
    across: nearest(steps.map((d) => [{ ...a.primary, number: a.primary.number + d, suffix: "" }, a.cross])),
  };
}

/** Linear position between the closest lower and higher numbered corners on the primary street. */
function interpolate(p: Places, a: Address): Geocoded | null {
  const target = a.cross.number + Math.min(a.placa ?? 0, 99) / 100;
  const near: { number: number; c: Corner }[] = [];
  for (let d = -3; d <= 3; d++) {
    const number = a.cross.number + d;
    if (number < 0 || d === 0) continue;
    for (const c of corners(p, a.primary, { ...a.cross, number, suffix: "" })) if (c.typed) near.push({ number, c });
  }
  let best: { lo: (typeof near)[number]; hi: (typeof near)[number]; d: number } | null = null;
  for (const lo of near) {
    for (const hi of near) {
      if (!(lo.number < target && hi.number > target)) continue;
      const d = metres(lo.c.lat, lo.c.lon, hi.c.lat, hi.c.lon);
      // Corners a few blocks apart on the same stretch, not in two parts of the city
      if (d > 120 * (hi.number - lo.number) || (best && d >= best.d)) continue;
      best = { lo, hi, d };
    }
  }
  if (!best) return null;
  const t = (target - best.lo.number) / (best.hi.number - best.lo.number);
  return {
    lat: best.lo.c.lat + (best.hi.c.lat - best.lo.c.lat) * t,
    lon: best.lo.c.lon + (best.hi.c.lon - best.lo.c.lon) * t,
    confidence: "approximate",
  };
}

function streetLabel(s: Street): string {
  return streetKey(s)
    .replace(/^CL/, "Calle")
    .replace(/^KR/, "Carrera")
    .replace(/^DG/, "Diagonal")
    .replace(/^TV/, "Transversal")
    .replace(/BIS/, " Bis ")
    .replace(/SUR$/, "Sur")
    .replace(/ESTE$/, "Este")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Describing a point ----------

export function describe(net: Network, p: Places, lat: number, lon: number): Nearby {
  let barrio: string | null = null;
  let barrioM = 1500;
  for (let i = 0; i < p.file.places.id.length; i++) {
    const kind = p.file.places.kind[i];
    if (kind !== "barrio" && kind !== "sector") continue;
    const m = metres(lat, lon, p.lat[i], p.lon[i]);
    if (m < barrioM) {
      barrioM = m;
      barrio = p.file.places.name[i];
    }
  }
  let station: Nearby["station"] = null;
  let stop: Nearby["stop"] = null;
  for (let s = 0; s < net.stopCount; s++) {
    const m = metres(lat, lon, net.lat[s], net.lon[s]);
    if (m > 1500) continue;
    const isStation = net.kind[s] !== "street" && net.parent[s] < 0;
    if (isStation && (!station || m < station.metres)) station = { name: net.stopName[s], metres: Math.round(m) };
    if (net.kind[s] === "street" && net.stopGroups[s].length && (!stop || m < stop.metres)) stop = { name: net.stopName[s], code: net.stopCode[s], metres: Math.round(m) };
  }
  return { barrio, station, stop };
}

// ---------- Searching by name ----------

const STOPWORDS = new Set(["el", "la", "los", "las", "de", "del", "en", "a", "al", "y", "estacion", "paradero", "portal", "centro", "comercial", "cc", "c c", "universidad", "u"]);
const tokens = (s: string) =>
  fold(s)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter(Boolean);

function matches(query: string[], name: string): number {
  const words = tokens(name);
  let hits = 0;
  for (const q of query) {
    if (words.some((w) => w === q || (q.length >= 4 && w.startsWith(q)))) hits++;
    else if (!STOPWORDS.has(q)) return 0;
  }
  return hits;
}

export function search(net: Network, p: Places, query: string, limit = 5): Candidate[] {
  const q = tokens(query);
  if (!q.length || q.every((t) => STOPWORDS.has(t))) return [];
  const folded = q.join(" ");
  type Hit = { id: string; label: string; kind: string; lat: number; lon: number; score: number };
  const hits: Hit[] = [];

  for (let i = 0; i < p.file.places.id.length; i++) {
    const m = matches(q, p.file.places.name[i]);
    if (!m) continue;
    const exact = tokens(p.file.places.name[i]).join(" ") === folded;
    hits.push({
      id: `place:${p.file.places.id[i]}`,
      label: p.file.places.name[i],
      kind: p.file.places.kind[i],
      lat: p.lat[i],
      lon: p.lon[i],
      score: p.file.places.weight[i] + m + (exact ? 6 : 0) - tokens(p.file.places.name[i]).length * 0.2,
    });
  }
  for (let s = 0; s < net.stopCount; s++) {
    const station = net.kind[s] !== "street" && net.parent[s] < 0;
    const street = net.kind[s] === "street" && net.stopGroups[s].length > 0;
    if (!station && !street) continue;
    const byCode = street && net.stopCode[s] && fold(net.stopCode[s]) === folded;
    const m = byCode ? q.length : matches(q, net.stopName[s]);
    if (!m) continue;
    const exact = byCode || tokens(net.stopName[s]).join(" ") === folded;
    hits.push({
      id: `stop:${net.stopId[s]}`,
      label: net.stopName[s],
      kind: station ? (net.kind[s] === "cable" ? "estación de TransMiCable" : "estación de TransMilenio") : "paradero SITP",
      lat: net.lat[s],
      lon: net.lon[s],
      score: (station ? 9 : 4) + m + (exact ? 6 : 0) - tokens(net.stopName[s]).length * 0.2,
    });
  }

  hits.sort((a, b) => b.score - a.score);
  const out: Hit[] = [];
  for (const h of hits) {
    // The same place mapped twice is one answer
    if (out.some((o) => fold(o.label) === fold(h.label) && metres(o.lat, o.lon, h.lat, h.lon) < 400)) continue;
    out.push(h);
    if (out.length === limit) break;
  }
  const top = out[0]?.score ?? 0;
  const meaningful = q.filter((t) => !STOPWORDS.has(t));
  const generic = meaningful.length === 0 || (meaningful.length === 1 && GENERIC.has(meaningful[0])) || q.every((t) => GENERIC.has(t) || STOPWORDS.has(t));
  // A station named like a bigger place ("Universidad Nacional", the station and the campus) is not a sure answer
  const shadowed = !!out[0]?.id.startsWith("stop:") && out.slice(1).some((o) => !o.id.startsWith("stop:") && matches(q, o.label) > 0);
  const clear = !generic && !shadowed && (out.length === 1 || (out[1] && top - out[1].score >= 3));
  return out.map((h, i) => ({
    id: h.id,
    label: h.label,
    kind: h.kind,
    lat: h.lat,
    lon: h.lon,
    confidence: i === 0 && clear ? "exact" : "approximate",
    near: describe(net, p, h.lat, h.lon),
  }));
}

// ---------- One entry point ----------

export type Resolved = { candidates: Candidate[] } | { error: string };

/** Everything a rider can type. Coordinates are only accepted as "geo:lat,lon" from a device. */
export function resolve(net: Network, p: Places, input: string): Resolved {
  const text = input.trim();
  const geo = /^geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (geo) {
    const lat = Number(Number(geo[1]).toFixed(4));
    const lon = Number(Number(geo[2]).toFixed(4));
    if (!inBogota(lat, lon)) return { error: "Ese punto no está en Bogotá." };
    if (!stopsNear(net, lat, lon, 1500).some((x) => net.stopGroups[x.stop].length)) return { error: "Ese punto está a más de 1,5 km de cualquier estación o paradero." };
    return { candidates: [{ id: `geo:${lat},${lon}`, label: "Tu ubicación", kind: "ubicación", lat, lon, confidence: "exact", near: describe(net, p, lat, lon) }] };
  }
  const id = /^(stop|place|addr):(.+)$/.exec(text);
  if (id) return byId(net, p, id[1], id[2]);

  const address = parseAddress(text);
  if (address) return fromAddress(net, p, address);
  const found = search(net, p, text);
  if (!found.length) return { error: `No encuentro "${text}". Prueba con una dirección (Calle 72 # 10-34), un cruce (Calle 72 con Carrera 10) o el nombre de una estación.` };
  return { candidates: found };
}

function fromAddress(net: Network, p: Places, a: Address): Resolved {
  const town = MUNICIPALITIES.find((m) => new RegExp(`\\b${m}\\b`).test(fold(a.extra)));
  if (town) return { error: "Solo entiendo direcciones de Bogotá D.C. Para otro municipio, dame una estación o un sitio conocido." };
  const g = geocode(p, a);
  if ("error" in g) return { error: `${g.error} Revisa la dirección o dame un cruce cercano o un sitio conocido. Solo entiendo direcciones de Bogotá.` };
  const label = describeAddress(a);
  const several = g.results.length > 1;
  const ignored = a.extra ? `Leí "${label}" y no tuve en cuenta "${a.extra}": confirma que es esa dirección, en Bogotá.` : undefined;
  const candidates = g.results.map((r, i): Candidate => {
    const near = describe(net, p, r.lat, r.lon);
    // Out in the countryside (no barrio within 1.5 km) a grid address is never certain
    const sure = r.confidence === "exact" && !ignored && near.barrio !== null;
    let note: string | undefined;
    if (ignored) note = ignored;
    else if (several) note = `Esa dirección existe en ${g.results.length} partes de Bogotá: pregunta cuál.`;
    else if (!sure) note = "No pude confirmar este punto con las calles vecinas: confirma el barrio y la estación cercana.";
    return {
      id: several ? `addr:${label}@${i}` : `addr:${label}`,
      label,
      kind: "dirección",
      lat: r.lat,
      lon: r.lon,
      confidence: sure ? "exact" : "approximate",
      near,
      note,
    };
  });
  return { candidates };
}

function byId(net: Network, p: Places, kind: string, value: string): Resolved {
  if (kind === "addr") {
    // "Calle 10 # 3-16@1" picks the second of several places with that address
    const [text, pick] = value.split("@");
    if (pick !== undefined && !/^\d{1,2}$/.test(pick)) return { error: "Dirección inválida." };
    const a = parseAddress(text);
    if (!a) return { error: "Dirección inválida." };
    const r = fromAddress(net, p, a);
    if ("error" in r || pick === undefined) return r;
    const chosen = r.candidates[Number(pick)];
    return chosen ? { candidates: [{ ...chosen, confidence: "exact", note: undefined }] } : { error: "Dirección inválida." };
  }
  if (kind === "stop") {
    const s = net.stopIndex.get(value);
    if (s === undefined) return { error: "Ese paradero no existe." };
    const station = net.kind[s] !== "street";
    return {
      candidates: [
        {
          id: `stop:${value}`,
          label: net.stopName[s],
          kind: station ? "estación de TransMilenio" : "paradero SITP",
          lat: net.lat[s],
          lon: net.lon[s],
          confidence: "exact",
          near: describe(net, p, net.lat[s], net.lon[s]),
        },
      ],
    };
  }
  const i = p.file.places.id.indexOf(value);
  if (i < 0) return { error: "Ese lugar no existe." };
  return {
    candidates: [
      {
        id: `place:${value}`,
        label: p.file.places.name[i],
        kind: p.file.places.kind[i],
        lat: p.lat[i],
        lon: p.lon[i],
        confidence: "exact",
        near: describe(net, p, p.lat[i], p.lon[i]),
      },
    ],
  };
}
