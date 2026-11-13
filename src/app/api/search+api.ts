import { bad, respond, validQuery } from "@/server/respond";
import { search } from "@/server/transit";

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!validQuery(q)) return bad("q must be 2 to 80 characters.");
  return respond(() => search(q), 300);
}
