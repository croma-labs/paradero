/**
 * Bogotá addresses. The city's nomenclature is a grid: "Calle 72 # 10-34" is on Calle 72, 34 m
 * past its corner with Carrera 10. Calles and diagonales run east–west, carreras and
 * transversales north–south; "Sur" moves a calle south of Calle 1, "Este" moves a carrera east of
 * Carrera 1. Pure: parsing and street keys only, geometry lives in places.ts.
 */

export type StreetType = "CL" | "DG" | "KR" | "TV";

export interface Street {
  type: StreetType;
  number: number;
  /** Letters and "BIS" as written after the number, e.g. "A", "ABIS", "BISA". */
  suffix: string;
  quadrant: "" | "SUR" | "ESTE";
}

export interface Address {
  primary: Street;
  /** The street it crosses: a carrera for a calle and the other way round. */
  cross: Street;
  /** Metres from the corner, the number after the dash. */
  placa: number | null;
  /** Anything written after the address that is not an apartment or similar ("Chía", "Chapinero"…). Never dropped silently. */
  extra: string;
}

/** Text after an address that only says where inside the building: safe to ignore. */
const COMPLEMENT = /^(apto|apartamento|apt|ap|int|interior|torre|to|piso|oficina|ofi|of|local|loc|casa|bloque|bl|edificio|ed|conjunto|consultorio|cons|manzana|mz|lote|lt|porteria)\b/;

const CALLE_FAMILY: StreetType[] = ["CL", "DG"];
const CARRERA_FAMILY: StreetType[] = ["KR", "TV"];

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[º°.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TYPE_WORDS: [RegExp, StreetType][] = [
  [/^(avenida calle|av calle|avenida cl|av cl|ac|a calle)$/, "CL"],
  [/^(avenida carrera|av carrera|avenida cra|av cra|av kr|avenida kr|ak|a carrera)$/, "KR"],
  [/^(calle|cl|cll|cal|clle)$/, "CL"],
  [/^(carrera|cra|cr|kr|kra|carr|crr|cara)$/, "KR"],
  [/^(diagonal|dg|diag)$/, "DG"],
  [/^(transversal|tv|tr|trans|transv|tranv)$/, "TV"],
];

const TYPE_PATTERN =
  "avenida calle|av calle|avenida cl|av cl|avenida carrera|av carrera|avenida cra|av cra|av kr|avenida kr|a calle|a carrera|ac|ak|" +
  "calle|cll|clle|cal|cl|carrera|carr|cra|crr|kra|kr|cr|diagonal|diag|dg|transversal|transv|tranv|trans|tv|tr";

function typeOf(word: string): StreetType | null {
  const w = word.trim();
  for (const [re, t] of TYPE_WORDS) if (re.test(w)) return t;
  return null;
}

const SUFFIX = "((?:\\s*(?:bis|[a-h])(?![a-z]))*)";
/** "Sur" or "Este" as a whole word: "Surtimax" or "Esteban" after an address are not quadrants. */
const QUADRANT = "(?:\\s*(sur|este)(?![a-z]))?";

function suffixOf(raw: string | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

const family = (t: StreetType) => (CALLE_FAMILY.includes(t) ? CALLE_FAMILY : CARRERA_FAMILY);
const crossType = (t: StreetType): StreetType => (CALLE_FAMILY.includes(t) ? "KR" : "CL");

/** Street name as OpenStreetMap or a rider writes it ("Avenida Calle 26", "Carrera 7 Bis A Este"). */
export function parseStreet(name: string): Street | null {
  const re = new RegExp(`^(?:avenida\\s+)?(${TYPE_PATTERN})\\s*(\\d{1,3})${SUFFIX}${QUADRANT}$`);
  const m = re.exec(fold(name));
  if (!m) return null;
  const type = typeOf(m[1]);
  if (!type) return null;
  return { type, number: Number(m[2]), suffix: suffixOf(m[3]), quadrant: (m[4]?.toUpperCase() ?? "") as Street["quadrant"] };
}

/** "CL 72A BIS SUR": the key streets are indexed under. */
export function streetKey(s: Street): string {
  return [s.type, `${s.number}${s.suffix}`, s.quadrant].filter(Boolean).join(" ");
}

/** The same street under the sibling type (a calle written as diagonal and so on), most likely first. */
export function keyVariants(s: Street): string[] {
  return [s.type, ...family(s.type).filter((t) => t !== s.type)].map((type) => streetKey({ ...s, type }));
}

/**
 * Parses "Calle 72 # 10-34", "Cl 72 No. 10 - 34 Sur", "KR 7 45 20", "Calle 72 con Carrera 10",
 * "Calle 72 con 10". Returns null when it is not an address.
 */
export function parseAddress(input: string): Address | null {
  const s = fold(input)
    .replace(/\b(numero|nro|no|n)\b/g, "#")
    .replace(/\s*-\s*/g, "-")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const head = new RegExp(`^(?:avenida\\s+)?(${TYPE_PATTERN})\\s*(\\d{1,3})${SUFFIX}${QUADRANT}\\s*`);
  const h = head.exec(s);
  if (!h) return null;
  const type = typeOf(h[1]);
  if (!type) return null;
  const primary: Street = { type, number: Number(h[2]), suffix: suffixOf(h[3]), quadrant: (h[4]?.toUpperCase() ?? "") as Street["quadrant"] };
  let rest = s.slice(h[0].length).trim();

  // "con Carrera 10", "x 10", "y Kr 10"
  const corner = new RegExp(`^(?:con|x|y|esquina|esq)\\s+(?:(${TYPE_PATTERN})\\s*)?(\\d{1,3})${SUFFIX}${QUADRANT}(?![\\d])`).exec(rest);
  if (corner) {
    const ct = corner[1] ? typeOf(corner[1]) : crossType(type);
    if (!ct || family(ct) === family(type)) return null;
    return {
      primary,
      cross: { type: ct, number: Number(corner[2]), suffix: suffixOf(corner[3]), quadrant: (corner[4]?.toUpperCase() ?? "") as Street["quadrant"] },
      placa: null,
      extra: extraOf(rest.slice(corner[0].length)),
    };
  }

  // "# 10-34", "#10 34", "10-34", "10 34", optionally followed by "sur"/"este" and anything else (apto, interior…)
  rest = rest.replace(/^#\s*/, "");
  const plate = new RegExp(`^(\\d{1,3})${SUFFIX}(?:-|\\s)(\\d{1,3})\\b${QUADRANT}`).exec(rest);
  const bare = plate ? null : new RegExp(`^(\\d{1,3})${SUFFIX}${QUADRANT}$`).exec(rest);
  const m = plate ?? bare;
  if (!m) return null;
  const cross: Street = { type: crossType(type), number: Number(m[1]), suffix: suffixOf(m[2]), quadrant: "" };
  const trailing = ((plate ? plate[4] : bare?.[3]) ?? "").toUpperCase();
  // A trailing "Sur" belongs to the calle, a trailing "Este" to the carrera, whichever of the two that is
  if (trailing === "SUR") (family(type) === CALLE_FAMILY ? primary : cross).quadrant = "SUR";
  if (trailing === "ESTE") (family(type) === CARRERA_FAMILY ? primary : cross).quadrant = "ESTE";
  return { primary, cross, placa: plate ? Number(plate[3]) : null, extra: plate ? extraOf(rest.slice(plate[0].length)) : "" };
}

function extraOf(text: string): string {
  const t = text.replace(/^[\s,;.-]+/, "").trim();
  return !t || COMPLEMENT.test(t) ? "" : t;
}

export function describeStreet(s: Street): string {
  const word = { CL: "Calle", DG: "Diagonal", KR: "Carrera", TV: "Transversal" }[s.type];
  const suffix = s.suffix.replace(/BIS/g, " Bis ").replace(/\s+/g, " ").trim();
  return [word, `${s.number}${suffix && !suffix.startsWith("Bis") ? suffix : ""}`, suffix.startsWith("Bis") ? suffix : "", s.quadrant === "SUR" ? "Sur" : s.quadrant === "ESTE" ? "Este" : ""]
    .filter(Boolean)
    .join(" ");
}

export function describeAddress(a: Address): string {
  const cross = `${a.cross.number}${a.cross.suffix.replace(/BIS/g, " Bis ").replace(/\s+/g, " ").trim()}`;
  const quad = a.cross.quadrant === "SUR" ? " Sur" : a.cross.quadrant === "ESTE" ? " Este" : "";
  return a.placa == null ? `${describeStreet(a.primary)} con ${describeStreet(a.cross)}` : `${describeStreet(a.primary)} # ${cross}-${String(a.placa).padStart(2, "0")}${quad}`;
}
