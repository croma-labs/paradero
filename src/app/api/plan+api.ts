import { plan } from "@/server/planner";
import { bad, respond } from "@/server/respond";

/** GET /api/plan?from=<place id>&to=<place id>&at=<ISO>&accessible=1. Place ids come from /api/places. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";
  if (!from || !to || from.length > 200 || to.length > 200) return bad("from and to must be place ids from /api/places.");
  const at = url.searchParams.get("at") ?? undefined;
  // Leaving now can carry live times, shared for 3 s like the other live answers (#36). A later trip is timetable only.
  const maxAge = at ? 15 : 3;
  let rejected: string | null = null;
  const response = await respond(async () => {
    const r = await plan(url.origin, { from, to, at, accessible: url.searchParams.get("accessible") === "1" });
    if ("error" in r) {
      rejected = r.error;
      return null;
    }
    return r;
  }, maxAge);
  return rejected ? bad(rejected) : response;
}
