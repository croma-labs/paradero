import { findPlace } from "@/server/planner";
import { bad, respond } from "@/server/respond";

export function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 120) return bad("q must be 2 to 120 characters.");
  return respond(async () => {
    const r = await findPlace(url.origin, q);
    return "error" in r ? { candidates: [], error: r.error } : r;
  }, 300);
}
