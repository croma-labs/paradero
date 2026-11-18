import { useSyncExternalStore } from "react";

import { normalizeVehiclePlate, type VehicleSizeReportInput, type VehicleSizeReportResult } from "@/transit/vehicle-size-report";

import { ApiError } from "./api";

// Only suppress repeat prompts during this app session. These are not votes or identities.
const reported = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSizeReported(plate: string | null): boolean {
  const normalized = normalizeVehiclePlate(plate);
  return useSyncExternalStore(subscribe, () => normalized !== null && reported.has(normalized), () => false);
}

export function markSizeReported(plate: string): void {
  const normalized = normalizeVehiclePlate(plate);
  if (!normalized || reported.has(normalized)) return;
  reported.add(normalized);
  listeners.forEach((listener) => listener());
}

export async function sendVehicleSizeReport(input: VehicleSizeReportInput): Promise<VehicleSizeReportResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("/api/vehicle-size-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? `http_${response.status}`);
    if (body?.status !== "pending_review" || !Number.isSafeInteger(body.number) || body.number < 1 || typeof body.url !== "string") {
      throw new ApiError(502, "unexpected_response");
    }
    return body as VehicleSizeReportResult;
  } finally {
    clearTimeout(timeout);
  }
}
