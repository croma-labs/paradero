/// <reference types="node" />
/**
 * A stand-in for Croma's TransMilenio API that answers from a scenario (see scenario.ts and scenarios/).
 * Run it alone with `npm run croma:fake`, or with the app through `npm run dev:fake`.
 *
 * Besides Croma's endpoints it has three of its own, for whoever drives the test:
 *   GET  /__scenario         the scenario it answers from now
 *   PUT  /__scenario         answer from this one instead (JSON body); 400 with the reasons if it doesn't hold together
 *   POST /__scenario/reset   go back to the one it started with
 *
 * Every answer is checked against src/server/schemas.ts, the schemas the app's server reads the real Croma with,
 * so the fake and the app can't drift apart.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import type { z } from "zod";

import * as s from "../../src/server/schemas.ts";
import { compile, DEFAULT_SCENARIO, load, ScenarioError, type ScenarioRoute, type ScenarioStop, type World } from "./scenario.ts";

export const DEFAULT_PORT = 4010;

type Body = Record<string, unknown>;
type Bus = World["scenario"]["buses"][number];

class Failure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const text = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function matches(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  return q.length > 0 && fields.some((f) => f.toLowerCase().includes(q));
}

const summary = (r: ScenarioRoute) => ({ route_id: r.id, short_name: r.code, long_name: r.longName, system: r.system });
/** How arrivals and vehicles name their route. */
const onRoute = (r: ScenarioRoute) => ({ route_id: r.id, route_code: r.code, route_name: r.longName, system: r.system });

/** The answers for one scenario at one moment. Lookups are safe: compile() already refused names that point nowhere. */
function answers(world: World, now: number) {
  const { feed } = world.scenario;
  const asOf = iso(now - feed.ageSeconds * 1000);
  const stop = (id: string) => world.stop(id) as ScenarioStop;
  const route = (code: string) => world.route(code) as ScenarioRoute;

  const rawStop = (st: ScenarioStop, distance?: number) => ({
    stop_id: st.id,
    name: st.name,
    kind: st.kind,
    latitude: st.lat,
    longitude: st.lon,
    wheelchair_boarding: st.accessible ? "accessible" : "not_accessible",
    distance_m: distance ?? null,
    routes: world.routesAt(st.id).map(summary),
  });

  const rawBus = (bus: Bus) => {
    const [from, to] = bus.between.map(stop);
    return {
      vehicle_id: bus.id,
      label: bus.id,
      license_plate: bus.plate,
      latitude: from.lat + (to.lat - from.lat) * bus.at,
      longitude: from.lon + (to.lon - from.lon) * bus.at,
      ...onRoute(route(bus.route)),
      stop_name: to.name,
      reported_at: iso(now - bus.reportedSecondsAgo * 1000),
    };
  };

  /** Each Croma endpoint: what the app's server expects back, and how this scenario answers it. */
  const endpoints: Record<string, { schema: z.ZodType; answer: (body: Body) => unknown }> = {
    "stops-search": {
      schema: s.stopsSearch,
      answer(body) {
        const perPage = num(body.per_page, 25);
        if (typeof body.latitude === "number" && typeof body.longitude === "number") {
          const here = { lat: body.latitude, lon: body.longitude };
          const near = world.stops
            .map((st) => ({ st, d: metres(here, st) }))
            .filter(({ d }) => d <= num(body.radius_m, 700))
            .sort((a, b) => a.d - b.d);
          return { stops: near.slice(0, perPage).map(({ st, d }) => rawStop(st, d)) };
        }
        const found = world.stops.filter((st) => matches(text(body.query), st.name, ...world.routesAt(st.id).flatMap((r) => [r.code, r.longName])));
        return { stops: found.slice(0, perPage).map((st) => rawStop(st)) };
      },
    },
    "routes-search": {
      schema: s.routesSearch,
      answer(body) {
        const found = world.routes.filter((r) => matches(text(body.query), r.code, r.longName));
        return {
          routes: found.slice(0, num(body.per_page, 15)).map((r) => ({
            ...summary(r),
            first_departure: r.firstDeparture,
            last_departure: r.lastDeparture,
            trips_per_week: r.patterns.reduce((sum, p) => sum + p.tripsPerWeek, 0),
          })),
        };
      },
    },
    stop: {
      schema: s.stopLookup,
      answer(body) {
        const st = world.stop(text(body.stop_id));
        return st ? { found: true, stop: rawStop(st) } : { found: false, stop: null };
      },
    },
    "stop-arrivals": {
      schema: s.arrivals,
      answer(body) {
        const id = text(body.stop_id);
        const arrivals = world.scenario.arrivals
          .filter((a) => a.stop === id)
          .sort((a, b) => a.minutes - b.minutes)
          .slice(0, num(body.limit, 30))
          .map((a) => ({
            predicted_at: iso(now + a.minutes * 60_000),
            minutes_away: a.minutes,
            basis: a.basis,
            delay_seconds: a.delaySeconds,
            ...onRoute(route(a.route)),
            vehicle_label: a.bus,
            license_plate: world.scenario.buses.find((b) => b.id === a.bus)?.plate ?? null,
          }));
        return { as_of: asOf, live: feed.live, found: !!world.stop(id), arrivals };
      },
    },
    alerts: {
      schema: s.alerts,
      answer(body) {
        const codes = typeof body.route === "string" ? [body.route] : world.routesAt(text(body.stop_id)).map((r) => r.code);
        return {
          alerts: world.scenario.alerts
            .filter((a) => a.routes.some((code) => codes.includes(code)))
            .map((a) => ({
              alert_id: a.id,
              effect: a.effect,
              description: a.description,
              active_periods: [{ start: iso(now - 3_600_000), end: iso(now + a.hoursLeft * 3_600_000) }],
              routes: a.routes.map((code) => ({ route_code: code })),
            })),
        };
      },
    },
    vehicles: {
      schema: s.vehicles,
      answer(body) {
        let buses = world.scenario.buses.map(rawBus);
        if (typeof body.route === "string") buses = buses.filter((b) => b.route_code === body.route);
        if (typeof body.latitude === "number" && typeof body.longitude === "number") {
          const here = { lat: body.latitude, lon: body.longitude };
          buses = buses.filter((b) => metres(here, { lat: b.latitude, lon: b.longitude }) <= num(body.radius_m, 3000));
        }
        const perPage = Math.max(1, num(body.per_page, 100));
        const page = Math.max(1, num(body.page, 1));
        return {
          as_of: asOf,
          live: feed.live,
          total_pages: Math.max(1, Math.ceil(buses.length / perPage)),
          vehicles: buses.slice((page - 1) * perPage, page * perPage),
        };
      },
    },
    route: {
      schema: s.route,
      answer(body) {
        const r = world.routes.find((x) => x.id === text(body.route_id));
        if (!r) return { as_of: iso(now), found: false, route: null };
        return {
          as_of: iso(now),
          found: true,
          route: {
            ...summary(r),
            patterns: r.patterns.map((p) => {
              const stops = p.stops.map(stop);
              return {
                trips_per_week: p.tripsPerWeek,
                stops: stops.map((st) => ({ stop_id: st.id, name: st.name, latitude: st.lat, longitude: st.lon })),
                geometry: body.include_geometry === false ? null : { coordinates: stops.map((st) => [st.lon, st.lat]) },
              };
            }),
          },
        };
      },
    },
  };
  return endpoints;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Failure(400, "bad_request", "The body must be JSON.");
  }
}

function describe(world: World): string {
  const where = world.rider ? ` The rider stands at ${world.rider.lat},${world.rider.lon}.` : "";
  return `${world.scenario.about ?? "A scenario"} (stops: ${world.stops.length}, routes: ${world.routes.length}, buses: ${world.scenario.buses.length}).${where}`;
}

export interface FakeCroma {
  server: Server;
  url: string;
}

export function startFakeCroma({ port = DEFAULT_PORT, scenario = DEFAULT_SCENARIO, log = true } = {}): Promise<FakeCroma> {
  const initial = load(scenario);
  let world = initial;
  console.log(`[fake-croma] ${describe(world)}`);

  async function handle(req: IncomingMessage): Promise<{ status: number; json: unknown }> {
    const url = new URL(req.url ?? "/", "http://fake-croma");
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /health") return { status: 200, json: { ok: true, about: world.scenario.about ?? null, rider: world.rider } };
    if (route === "GET /__scenario") return { status: 200, json: world.scenario };
    if (route === "POST /__scenario/reset") {
      world = initial;
      console.log(`[fake-croma] Back to the starting scenario. ${describe(world)}`);
      return { status: 200, json: { ok: true, rider: world.rider } };
    }
    if (route === "PUT /__scenario") {
      try {
        world = compile(await readJson(req));
      } catch (error) {
        if (error instanceof ScenarioError) throw new Failure(400, "bad_scenario", error.message);
        throw error;
      }
      console.log(`[fake-croma] New scenario. ${describe(world)}`);
      return { status: 200, json: { ok: true, rider: world.rider } };
    }

    const endpoint = /^\/co\/transmilenio\/([a-z-]+)\/v1$/.exec(url.pathname)?.[1] ?? "";
    const spec = answers(world, Date.now())[endpoint];
    if (req.method !== "POST" || !spec) throw new Failure(404, "not_found", `The fake Croma has no ${route}.`);
    if (!/^Bearer \S+/.test(req.headers.authorization ?? "")) throw new Failure(401, "unauthorized", "Send any key as `Authorization: Bearer <key>`.");

    const body = await readJson(req);
    if (log) console.log(`[fake-croma] ${endpoint} ${JSON.stringify(body)}`);
    const { down } = world.scenario;
    if (down === "all" || down.includes(endpoint as never)) throw new Failure(503, "unavailable", `${endpoint} is down in this scenario.`);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Failure(400, "bad_request", "The body must be a JSON object.");

    const parsed = spec.schema.safeParse(spec.answer(body as Body));
    if (!parsed.success) {
      // The fake no longer answers in the shape the app expects: say so loudly instead of handing the app bad data.
      console.error(`[fake-croma] ${endpoint} answer doesn't match src/server/schemas.ts:`, parsed.error.issues);
      throw new Failure(500, "fake_out_of_date", `The fake ${endpoint} answer doesn't match src/server/schemas.ts.`);
    }
    return { status: 200, json: { data: parsed.data } };
  }

  const server = createServer((req, res) => {
    handle(req)
      .catch((error: unknown) => {
        const f = error instanceof Failure ? error : new Failure(500, "internal", error instanceof Error ? error.message : String(error));
        if (f.status === 500) console.error(`[fake-croma] ${f.code}: ${f.message}`);
        return { status: f.status, json: { error: { code: f.code, message: f.message } } };
      })
      .then(({ status, json }) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}` });
    });
  });
}

/** `--scenario <file>` from the command line, else FAKE_CROMA_SCENARIO, else the default. The rest of the arguments are returned untouched. */
export function scenarioArg(argv: string[]): { scenario: string; rest: string[] } {
  const at = argv.indexOf("--scenario");
  if (at === -1) return { scenario: process.env.FAKE_CROMA_SCENARIO || DEFAULT_SCENARIO, rest: argv };
  const file = argv[at + 1];
  if (!file) throw new Error("--scenario needs a file.");
  return { scenario: file, rest: [...argv.slice(0, at), ...argv.slice(at + 2)] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { scenario } = scenarioArg(process.argv.slice(2));
  const { url } = await startFakeCroma({ port: Number(process.env.FAKE_CROMA_PORT) || DEFAULT_PORT, scenario });
  console.log(`[fake-croma] Answering as Croma on ${url}.`);
}
