import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This snapshot is deliberately pinned. Updating it requires reviewing a new
// official resource and changing its hash, date and attribution together.
const EXPECTED_SHA256 = "a45f941da2f773fee99fabb045d4a3372b73f0e7338d04e74b5d4f2e1c3248e6";
const SOURCE = {
  name: "Flota Vinculada del SITP - Diciembre 2024",
  publisher: "Empresa de Transporte del Tercer Milenio - Transmilenio S.A.",
  datasetUrl: "https://datosabiertos.bogota.gov.co/dataset/flota-vinculada-del-sitp",
  url: "https://datosabiertos.bogota.gov.co/dataset/7fb3cb57-761a-4f6b-8a25-99e6de9e1672/resource/0aa8c4ed-b26c-40ce-ac51-2b3fc425cd87/download/flota-vinculada-del-sitp-diciembre-2024.csv",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closedQuote = true; }
    } else if (char === ";") {
      row.push(cell); cell = ""; closedQuote = false;
    } else if (char === "\n" || char === "\r") {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = []; cell = ""; closedQuote = false;
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else if (char === '"' && cell === "" && !closedQuote) {
      quoted = true;
    } else {
      if (closedQuote || char === '"') throw new Error("Malformed CSV quote.");
      cell += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

/** Parse and validate data without claiming an official source or date. */
export function parseFleetCsv(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // The December 2024 resource uses Windows-1252, with accented zone names.
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  const columns = ["matricula", "descripcion_tipo", "descripcion_estado_vinculacion"];
  if (!header || new Set(header).size !== header.length || columns.some((name) => !header.includes(name))) {
    throw new Error(`CSV must have unique columns including ${columns.join(", ")}.`);
  }
  const [plateColumn, typeColumn, statusColumn] = columns.map((name) => header.indexOf(name));
  const plates = new Map();
  let ignoredRows = 0;
  for (const [index, row] of rows.entries()) {
    if (row.length !== header.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    if (row[statusColumn].trim() !== "Vinculado") { ignoredRows++; continue; }
    const plate = row[plateColumn].trim().toUpperCase();
    const type = row[typeColumn].trim();
    if (!/^[A-Z]{3}\d{3}$/.test(plate)) throw new Error(`Invalid plate at row ${index + 2}.`);
    if (!type) throw new Error(`Missing vehicle type at row ${index + 2}.`);
    if (plates.has(plate)) {
      throw new Error(`${plates.get(plate) === type ? "Duplicate" : "Conflicting"} plate ${plate} at row ${index + 2}.`);
    }
    plates.set(plate, type);
  }
  if (!plates.size) throw new Error("No linked vehicles found in the CSV.");
  const types = [...new Set(plates.values())].sort();
  const groups = Object.fromEntries(types.map((type) => [type, [...plates].filter(([, value]) => value === type).map(([plate]) => plate).sort()]));
  return { vehicleCount: plates.size, ignoredRows, groups };
}

function snapshot(bytes) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== EXPECTED_SHA256) {
    throw new Error(`Source SHA-256 mismatch: expected ${EXPECTED_SHA256}, got ${sha256}. Review a new official resource before changing its hash, date and attribution.`);
  }
  const parsed = parseFleetCsv(bytes);
  return {
    source: SOURCE,
    asOf: "2024-12",
    license: {
      id: "CC-BY-4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
      attribution: "Transmilenio S.A., Flota Vinculada del SITP, Diciembre 2024. Datos Abiertos Bogotá. CC BY 4.0.",
      changes: "Extracted plates of linked vehicles, grouped by the source's vehicle type and sorted. Other source columns omitted.",
    },
    sha256,
    ...parsed,
  };
}

async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (extra.length || input === "--help") {
    console.log("Usage: node scripts/import-sitp-fleet.mjs [local-december-2024.csv] [output.json]\nWithout an input file, downloads the pinned official December 2024 CSV. All inputs must match its reviewed SHA-256.");
    if (extra.length) process.exitCode = 1;
    return;
  }
  if (input && /^https?:\/\//i.test(input)) throw new Error("Pass a local CSV path; remote input is restricted to the pinned official source.");
  let bytes;
  if (input) bytes = await readFile(input);
  else {
    const response = await fetch(SOURCE.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Official CSV returned HTTP ${response.status}.`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const result = snapshot(bytes);
  const target = output ? resolve(output) : fileURLToPath(new URL("../src/server/data/sitp-fleet.json", import.meta.url));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Fleet: ${result.vehicleCount} plates, ${Object.keys(result.groups).length} source types, ${result.ignoredRows} unlinked rows ignored. SHA-256 ${result.sha256}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
