import { CromaError } from "@/server/croma";
import { allow } from "@/server/report";
import { bad } from "@/server/respond";
import { fileVehicleSizeReport, vehicleSizeReportInput, vehicleSizeReportsAvailable } from "@/server/vehicle-size-report";

export async function POST(request: Request) {
  const parsed = vehicleSizeReportInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad("Send a plate, a small or large size, confirmation that you see this bus, and the app version.");
  if (!vehicleSizeReportsAvailable()) return Response.json({ error: { code: "reports_unavailable", message: "Reports are not configured." } }, { status: 503 });

  const client = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
  if (!allow(client)) return Response.json({ error: { code: "too_many", message: "Try again in a while." } }, { status: 429 });

  try {
    return Response.json(await fileVehicleSizeReport(parsed.data), { status: 201 });
  } catch (error) {
    const e = error instanceof CromaError ? error : new CromaError("internal", "Something went wrong.", 500);
    return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
}
