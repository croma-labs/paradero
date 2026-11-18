import type { Arrival, Feed } from "./types";

export interface VehicleSizeReportInput {
  plate: string;
  size: "small" | "large";
  observed: true;
  app: { version: string; platform: "ios" | "android" | "web" };
}

export interface VehicleSizeReportResult {
  number: number;
  url: string;
  status: "pending_review";
}

const FRESH_FOR_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 30_000;

/** Plates identify the vehicle; a route or fleet-number prefix must never stand in for one. */
export function normalizeVehiclePlate(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const plate = input.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z]{3}\d{3}$/.test(plate) ? plate : null;
}

/** The server must opt in. Missing capability means an older or unconfigured server. */
export function canReportVehicleSize(arrival: Arrival, feed: Feed, now = Date.now()): boolean {
  if (arrival.canReportVehicleSize !== true || arrival.vehicleSize != null) return false;
  if (arrival.basis === "scheduled" || arrival.system === "transmicable" || !normalizeVehiclePlate(arrival.plate)) return false;
  if (!feed.live || !Number.isFinite(now)) return false;
  const asOf = Date.parse(feed.asOf);
  const age = now - asOf;
  return Number.isFinite(asOf) && age >= -CLOCK_SKEW_MS && age <= FRESH_FOR_MS;
}
