import { bad } from "@/server/respond";
import { allow, fileReport, reportInput } from "@/server/report";
import { CromaError } from "@/server/croma";

/** A message of 2000 characters with its context fits well under this, even in multi-byte scripts. */
const MAX_BODY_BYTES = 16_384;

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad("Send the report as JSON.");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return bad("The report is too long.");
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return bad("The report is too long.");

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = reportInput.safeParse(body);
  if (!parsed.success) return bad("Send a kind, a message of 8 to 2000 characters and the app version.");

  // Only the address the edge saw. `x-forwarded-for` is written by the client and would let anyone skip the limit.
  const client = request.headers.get("cf-connecting-ip") ?? "local";
  if (!allow(client)) return Response.json({ error: { code: "too_many", message: "Try again in a while." } }, { status: 429 });

  try {
    return Response.json(await fileReport(parsed.data), { status: 201 });
  } catch (error) {
    const e = error instanceof CromaError ? error : new CromaError("internal", "Something went wrong.", 500);
    if (!(error instanceof CromaError)) console.error("[report]", error);
    return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
}
