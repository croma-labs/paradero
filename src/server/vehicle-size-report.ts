import { z } from "zod";

import { normalizeVehiclePlate, type VehicleSizeReportInput, type VehicleSizeReportResult } from "@/transit/vehicle-size-report";

import { CromaError } from "./croma";
import { lookupVehicleSize } from "./fleet";
import { fileReport } from "./report";

export const vehicleSizeReportInput = z.object({
  plate: z.string().max(32).transform(normalizeVehiclePlate).pipe(z.string().regex(/^[A-Z]{3}\d{3}$/)),
  size: z.enum(["small", "large"]),
  observed: z.literal(true),
  app: z.object({
    version: z.string().min(1).max(20).regex(/^[A-Za-z0-9.+_-]+$/),
    platform: z.enum(["ios", "android", "web"]),
  }).strict(),
}).strict();

export function vehicleSizeReportsAvailable(): boolean {
  return !!process.env.GITHUB_REPORTS_TOKEN?.trim();
}

/** A public observation for maintainers to review, never an automatic change to the fleet register. */
export async function fileVehicleSizeReport(input: VehicleSizeReportInput): Promise<VehicleSizeReportResult> {
  if (!vehicleSizeReportsAvailable()) throw new CromaError("reports_unavailable", "Reports are not configured.", 503);
  if (lookupVehicleSize(input.plate)) throw new CromaError("vehicle_size_known", "This vehicle already has a size in the fleet register.", 409);

  const size = input.size === "large" ? "grande" : "pequeño";
  const issue = await fileReport({
    kind: "other",
    message: [
      `Tamaño de bus ${input.plate}: ${size}.`,
      "Observación comunitaria pendiente de revisión.",
      "La persona indica que está viendo el bus y comprobó que la placa coincide.",
      "No es una confirmación oficial ni cambia el tamaño mostrado en la app.",
    ].join("\n"),
    app: input.app,
  });
  return { ...issue, status: "pending_review" };
}
