import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { version } from "../../package.json";
import { CromaError } from "./croma";
import { findPlace, plan } from "./planner";
import { inBogota, validId, validQuery } from "./respond";
import { health, nearby, routeDetail, search, stopDetail } from "./transit";

const INSTRUCTIONS = `Paradero answers questions about public transit in Bogotá: TransMilenio, SITP, alimentadores and TransMiCable.

Getting somewhere ("estoy en X, voy para Y, ¿qué cojo?"):
1. Resolve both ends with resolve_place. Never invent coordinates, ids or routes, and never plan a trip yourself from what you know about Bogotá.
2. Confirm every end with the rider before planning, reading back its label, barrio and nearest station or stop ("Calle 72 # 10-34, cerca de la estación Calle 72, barrio El Nogal: ¿es ahí?"). If resolve_place returns several candidates, an "approximate" one or a note, read the note and ask which one, or for a nearby corner or landmark. If it returns an error, ask for more detail. A location shared from the rider's device goes through resolve_place too, as "geo:lat,lon".
3. If the rider has not said where they are or where they are going, ask. Addresses outside Bogotá D.C. (Soacha, Chía, Funza…) are not supported: ask for a station or landmark instead.
4. Call plan_trip with the confirmed ids exactly as resolve_place returned them (they are signed; anything else is refused) and present its options as they come, without adding routes, stops or times it did not return.
5. Always say which system each ride is (systemName): TransMilenio (troncal buses on the busway), SITP (zonal buses on the street), alimentadores and TransMiCable are different services. Say where to board from board.where: "estación" means inside a TransMilenio station or portal, through its turnstiles; "paradero" means a stop on the street.
6. Say which times are live: departureBasis "live" means TransMilenio is predicting that bus right now, "scheduled" means the published timetable. Ride times are always from the timetable. Mention any alerts on a ride and any notice.
7. If status is no_route, say there is no reasonable way and do not improvise one. If it is walk, suggest walking.

Stops and routes: find them with search or find_nearby_stops, then open them with get_stop or get_route.
Honesty first: every time has a basis. "predicted" and "estimated" come from live positions, "scheduled" is the published timetable. Always tell the rider which one it is, and when feed.live is false say that live data is not available right now.
Use the route codes riders see on the bus (code, aliases), never feedCode. Stop, station and route names are never translated.`;

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

/** Rides on the data the rider already sees in the app; an empty result is an answer, a missing one is an error. */
async function answer(load: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await load();
    if (data === null) return failure("not_found", "Not found.");
    if (typeof data === "object" && "error" in data && typeof data.error === "string") return failure("bad_request", data.error);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    const e = error instanceof CromaError ? error : new CromaError("internal", "Something went wrong.", 500);
    console.error("[mcp]", e.code, e.message);
    return failure(e.code, e.message);
  }
}

function failure(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] };
}

const id = (what: string) => z.string().refine(validId, `Not a valid ${what} id.`);

/** One server per request: EAS Hosting keeps no state between them, so neither does this. */
export function mcpServer(origin: string): McpServer {
  const server = new McpServer({ name: "paradero", title: "Paradero", version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "find_nearby_stops",
    {
      title: "Nearby stops",
      description: "Stations and stops within about 700 m of a point in Bogotá, nearest first, with the routes that serve each one.",
      inputSchema: {
        lat: z.number().describe("Latitude in Bogotá, between 3.5 and 5.5"),
        lon: z.number().describe("Longitude in Bogotá, between -75 and -73"),
      },
      annotations: READ_ONLY,
    },
    ({ lat, lon }) => {
      if (!inBogota(lat, lon)) return failure("bad_request", "lat and lon must be a point in Bogotá.");
      return answer(() => nearby(Number(lat.toFixed(3)), Number(lon.toFixed(3))));
    },
  );

  server.registerTool(
    "search",
    {
      title: "Search routes and stops",
      description: "Routes and stops by code or name, the way riders write them: K635, B10, Calle 72, Portal Suba.",
      inputSchema: { query: z.string().trim().refine(validQuery, "query must be 2 to 80 characters.").describe("2 to 80 characters") },
      annotations: READ_ONLY,
    },
    ({ query }) => answer(() => search(query)),
  );

  server.registerTool(
    "get_stop",
    {
      title: "Next buses at a stop",
      description:
        "A stop or station with its next arrivals (minutes, basis, delay), the buses heading to it on the routes that serve it, and service alerts.",
      inputSchema: { stop_id: id("stop").describe("A stop id from search or find_nearby_stops") },
      annotations: READ_ONLY,
    },
    ({ stop_id }) => answer(() => stopDetail(stop_id)),
  );

  server.registerTool(
    "get_route",
    {
      title: "Route detail",
      description:
        "A route with its stops in order, first and last departure, the buses on it right now (up to 50, busCount says how many there are) and service alerts.",
      inputSchema: { route_id: id("route").describe("A route id from search or get_stop") },
      annotations: READ_ONLY,
    },
    ({ route_id }) =>
      answer(async () => {
        const detail = await routeDetail(route_id);
        if (!detail) return null;
        const { path: _path, buses, ...rest } = detail;
        return { ...rest, busCount: buses.length, buses: buses.slice(0, 50) };
      }),
  );

  server.registerTool(
    "feed_status",
    {
      title: "Live data status",
      description: "Whether TransMilenio is publishing live bus positions right now, and how fresh they are.",
      annotations: READ_ONLY,
    },
    () => answer(health),
  );

  server.registerTool(
    "resolve_place",
    {
      title: "Find a place",
      description:
        "Turns what the rider said into a place id for plan_trip: a Bogotá address (Calle 72 # 10-34), a corner (Calle 72 con Carrera 10), " +
        "a TransMilenio station, a SITP stop, a landmark (Unicentro, Universidad Nacional), a barrio, or the rider's device location as " +
        "geo:lat,lon. Each candidate comes with its barrio and " +
        "nearest station and stop, so the rider can confirm it. Several candidates, confidence approximate or a note mean: ask the rider.",
      inputSchema: { query: z.string().trim().min(2).max(120).describe("What the rider said, 2 to 120 characters") },
      annotations: READ_ONLY,
    },
    ({ query }) =>
      answer(async () => {
        const r = await findPlace(origin, query);
        return "error" in r ? r : { candidates: r.candidates.map(({ lat: _lat, lon: _lon, ...c }) => c) };
      }),
  );

  server.registerTool(
    "plan_trip",
    {
      title: "Plan a trip",
      description:
        "Up to three ways to get from one confirmed place to another on TransMilenio, SITP, alimentadores and TransMiCable, with up to three " +
        "transfers, walking, waits, alerts and which departures are live. Only pass ids returned by resolve_place and confirmed by the rider.",
      inputSchema: {
        from: z.string().max(200).describe("Place id exactly as resolve_place returned it"),
        to: z.string().max(200).describe("Place id exactly as resolve_place returned it"),
        depart_at: z.string().max(40).optional().describe("When to leave, e.g. 2026-11-11T07:30 (Bogotá time); now if omitted"),
        accessible: z.boolean().optional().describe("Only stops with wheelchair access"),
      },
      annotations: READ_ONLY,
    },
    ({ from, to, depart_at, accessible }) =>
      answer(() => plan(origin, { from, to, at: depart_at, accessible })),
  );

  return server;
}
