import type { VehicleSize } from "@/transit/types";

import fleet from "./data/sitp-fleet.json" with { type: "json" };

/** A rider-facing grouping of the official fleet types, not current occupancy. */
const SIZE_BY_TYPE = new Map<string, VehicleSize["size"]>([
  ["BUS (40)", "small"],
  ["BUS (50)", "small"],
  ["ALIMENTADOR (50)", "small"],
  ["BUS (80)", "large"],
  ["ALIMENTADOR (80)", "large"],
  ["ARTICULADO", "large"],
  ["BIARTICULADO", "large"],
  ["PADRON DUAL", "large"],
]);

const sizeByPlate = new Map<string, VehicleSize["size"]>();
for (const [type, plates] of Object.entries(fleet.groups)) {
  const size = SIZE_BY_TYPE.get(type);
  if (size) for (const plate of plates) sizeByPlate.set(plate, size);
}

/** Exact plate match only. Missing/new vehicles stay unknown, regardless of route or fleet code. */
export function lookupVehicleSize(plate: string | null | undefined): VehicleSize | null {
  if (!plate) return null;
  const normalized = plate.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z]{3}\d{3}$/.test(normalized)) return null;
  const size = sizeByPlate.get(normalized);
  return size ? { size, asOf: fleet.asOf } : null;
}
