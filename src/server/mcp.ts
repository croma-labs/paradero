import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { version } from "../../package.json";
import { CromaError } from "./croma";
import { inBogota, validId, validQuery } from "./respond";
import { health, nearby, routeDetail, search, stopDetail } from "./transit";

const INSTRUCTIONS = `Paradero answers questions about public transit in Bogotá: TransMilenio, SITP, alimentadores and TransMiCable.
Find a stop or route with search or find_nearby_stops, then open it with get_stop or get_route.
Honesty first: every time has a basis. "predicted" and "estimated" come from live positions, "scheduled" is the published timetable. Always tell the rider which one it is, and when feed.live is false say that live data is not available right now.
Use the route codes riders see on the bus (code, aliases), never feedCode. Stop, station and route names are never translated.`;

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

/** Rides on the data the rider already sees in the app; an empty result is an answer, a missing one is an error. */
async function answer(load: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await load();
    if (data === null) return failure("not_found", "Not found.");
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
export function mcpServer(): McpServer {
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

  return server;
}
