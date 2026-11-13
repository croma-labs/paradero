import { bad, inBogota, respond } from "@/server/respond";
import { nearby } from "@/server/transit";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBogota(lat, lon)) return bad("lat and lon must be a point in Bogotá.");
  return respond(() => nearby(lat, lon), 60);
}
