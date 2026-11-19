/// <reference types="node" />
/**
 * A scenario is the whole world the fake Croma answers from: stops, routes, the buses on them, what each stop
 * expects next, alerts, and whether the feed is healthy. Agents write one as JSON to set up the case they test,
 * e.g. "the K635 is 3 minutes from Cl. 72 - Kr. 11 and the rider is standing there".
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/, "ids are letters, digits, _ . - (up to 40), like the app accepts");
const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

export const scenarioSchema = z.strictObject({
  /** Free text, shown in the logs: what this world is for. */
  about: z.string().optional(),
  /** Where the rider stands: at a stop, or at a point. The fake only reports it; set the device's location to match. */
  rider: z.union([z.strictObject({ stop: id }), z.strictObject({ lat: z.number(), lon: z.number() })]).optional(),
  /** How the feed looks. Older than 300 s, or `live: false`, and the app says it is showing the timetable. */
  feed: z.strictObject({ live: z.boolean().default(true), ageSeconds: z.number().min(0).default(5) }).default({ live: true, ageSeconds: 5 }),
  /** Endpoints that fail with a 503, as when Croma is down. `"all"` fails every one. */
  down: z.union([z.literal("all"), z.array(z.enum(["stops-search", "routes-search", "stop", "stop-arrivals", "alerts", "vehicles", "route"]))]).default([]),
  stops: z.array(
    z.strictObject({
      id,
      name: z.string(),
      kind: z.enum(["station", "stop"]).default("stop"),
      lat: z.number(),
      lon: z.number(),
      accessible: z.boolean().default(true),
    }),
  ),
  routes: z.array(
    z.strictObject({
      /** The feed's code. Paired SITP routes use the joined one (`HK635`) and name both halves in `longName`. */
      code: z.string().min(1),
      id: id.optional(),
      longName: z.string(),
      system: z.enum(["troncal", "dual", "zonal_urbano", "alimentador", "zonal_complementario", "zonal_especial", "transmicable"]),
      firstDeparture: hhmm.default("05:00:00"),
      lastDeparture: hhmm.default("22:00:00"),
      /** Each way the route runs, as stop ids in order; the busiest first. Its line on the map joins these stops. */
      patterns: z.array(z.strictObject({ tripsPerWeek: z.number().int().default(500), stops: z.array(id).min(2) })).min(1),
    }),
  ),
  /** What a stop expects next. A stop with none shows as having no buses coming. */
  arrivals: z
    .array(
      z.strictObject({
        stop: id,
        route: z.string(),
        minutes: z.number().min(0),
        /** `predicted` and `estimated` come from a bus on the street; `scheduled` is only the timetable. */
        basis: z.enum(["predicted", "estimated", "scheduled"]).default("predicted"),
        delaySeconds: z.number().nullable().default(null),
        /** The bus making this trip, by its id in `buses`. */
        bus: z.string().nullable().default(null),
      }),
    )
    .default([]),
  buses: z
    .array(
      z.strictObject({
        id: z.string(),
        plate: z.string().nullable().default(null),
        route: z.string(),
        /** Two stops of the route; the bus is `at` (0 to 1) of the way from the first to the second, heading to the second. */
        between: z.tuple([id, id]),
        at: z.number().min(0).max(1).default(0.5),
        /** How long ago it reported. After 120 s the app stops drawing it as moving. */
        reportedSecondsAgo: z.number().min(0).default(10),
      }),
    )
    .default([]),
  alerts: z
    .array(
      z.strictObject({
        id: z.string(),
        effect: z.string(),
        /** TransMilenio's format: parts split by a backslash, stops as `072A00_Calle 72`. Two stops read as "between". */
        description: z.string(),
        routes: z.array(z.string()).min(1),
        hoursLeft: z.number().default(2),
      }),
    )
    .default([]),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioStop = Scenario["stops"][number];
export type ScenarioRoute = Scenario["routes"][number] & { id: string };

/** A scenario checked for names that point nowhere, with the lookups the server needs. */
export interface World {
  scenario: Scenario;
  stops: ScenarioStop[];
  routes: ScenarioRoute[];
  stop(id: string): ScenarioStop | undefined;
  route(code: string): ScenarioRoute | undefined;
  routesAt(stopId: string): ScenarioRoute[];
  rider: { lat: number; lon: number } | null;
}

export class ScenarioError extends Error {}

export function compile(input: unknown): World {
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) throw new ScenarioError(z.prettifyError(parsed.error));
  const scenario = parsed.data;

  const stops = new Map(scenario.stops.map((st) => [st.id, st]));
  const routes = new Map(scenario.routes.map((r) => [r.code, { ...r, id: r.id ?? `R-${r.code}` }]));
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => ok || problems.push(message);

  need(stops.size === scenario.stops.length, "two stops share an id");
  need(routes.size === scenario.routes.length, "two routes share a code");
  for (const r of routes.values()) for (const p of r.patterns) for (const st of p.stops) need(stops.has(st), `route ${r.code} stops at ${st}, which is not in stops`);
  for (const a of scenario.arrivals) {
    need(stops.has(a.stop), `an arrival is at ${a.stop}, which is not in stops`);
    need(routes.has(a.route), `an arrival at ${a.stop} is on route ${a.route}, which is not in routes`);
    need(!a.bus || scenario.buses.some((b) => b.id === a.bus), `an arrival at ${a.stop} names bus ${a.bus}, which is not in buses`);
  }
  for (const b of scenario.buses) {
    const route = routes.get(b.route);
    need(!!route, `bus ${b.id} is on route ${b.route}, which is not in routes`);
    need(!route || route.patterns.some((p) => b.between.every((st) => p.stops.includes(st))), `bus ${b.id} is between ${b.between.join(" and ")}, but no pattern of ${b.route} has both`);
  }
  for (const al of scenario.alerts) for (const code of al.routes) need(routes.has(code), `alert ${al.id} is on route ${code}, which is not in routes`);
  const at = scenario.rider && "stop" in scenario.rider ? stops.get(scenario.rider.stop) : undefined;
  need(!(scenario.rider && "stop" in scenario.rider) || !!at, "the rider stands at a stop that is not in stops");
  if (problems.length) throw new ScenarioError(problems.map((p) => `- ${p}`).join("\n"));

  return {
    scenario,
    stops: scenario.stops,
    routes: [...routes.values()],
    stop: (stopId) => stops.get(stopId),
    route: (code) => routes.get(code),
    routesAt: (stopId) => [...routes.values()].filter((r) => r.patterns.some((p) => p.stops.includes(stopId))),
    rider: at ? { lat: at.lat, lon: at.lon } : scenario.rider && "lat" in scenario.rider ? scenario.rider : null,
  };
}

export const DEFAULT_SCENARIO = new URL("./scenarios/default.json", import.meta.url).pathname;

export function load(path: string): World {
  try {
    return compile(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new ScenarioError(`${path} is not a scenario the fake can use:\n${why}`);
  }
}
