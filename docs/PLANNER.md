# Trip planner

"Estoy en Unicentro, voy para la Calle 72 # 10-34: ¿qué cojo?" Paradero answers with up to three options on TransMilenio, SITP, alimentadores and TransMiCable. Each option has its walks, waits, transfers and alerts, and says which times are live. The answer is built only from the official timetable and the live feed, never improvised.

| Surface | What it does |
| --- | --- |
| `GET /api/places?q=` | Turns what a rider says into candidate places, each with a barrio and the nearest station and stop |
| `GET /api/plan?from=&to=&at=&accessible=1` | Plans between two place ids from `/api/places` |
| MCP `resolve_place`, `plan_trip` | The same two functions for AI assistants (see `src/server/mcp.ts` for the rules they get) |

```
GTFS (TransMilenio, official) ─ scripts/build-network.ts ─► public/network/bogota.json  (1.2 MB gzipped)
OpenStreetMap (Overpass)      ─ scripts/build-places.ts  ─► public/network/places.json  (1.1 MB gzipped)
                                                                   │ fetched once per server instance
src/transit/address.ts   Bogotá nomenclature                       ▼
src/transit/places.ts    addresses, landmarks, barrios ──► src/server/planner.ts ──► /api/places, /api/plan, MCP
src/transit/raptor.ts    RAPTOR                              ▲ live first bus, alerts (Croma)
src/transit/itinerary.ts options, sanity, live retiming ─────┘
```

Everything in `src/transit` is pure: no network, no clock. The same code runs in the server, in the tests and in the benchmark. The app could run it offline later.

## The network

`scripts/build-network.ts` finds the newest "GTFS Estáticos" on TransMilenio's open data hub, downloads it and builds one compact file. The 2026-10-27 feed has 8,308 stops, 180,785 trips and 9.4 million stop times.

- **Timetable, exact to 2 seconds.** TransMilenio builds every trip of a stop pattern by scaling one base profile. So a trip is stored as `(start, scale)` over its pattern's offsets. The builder checks every trip against the official stop times and gives a trip its own profile if it would be off by more than 5 s anywhere. On the current feed the worst error is 2 s. The whole timetable takes 1.2 MB gzipped, against 6.9 MB stored stop by stop.
- **FIFO groups.** RAPTOR needs trips of a route that never overtake each other. Trips are split into groups where that holds: 2,748 groups for 1,556 patterns. Offsets never decrease along a pattern, so checking the first and last stop is enough.
- **Calendars.** `calendar.txt` plus `calendar_dates.txt`, so holidays and special days are right. Trips of yesterday's service that run past midnight are part of today.
- **Footpaths.** These connect stops up to 300 m apart, at 1.25 m/s with a detour factor of 1.3, and a transfer takes at least 60 s. Getting in or out of a TransMilenio station adds 180 s (bridge, ramp, turnstile). Platforms of the same station connect with no such cost.
- **Systems.** Each route keeps its agency: troncal, dual, alimentador, zonal urbano/complementario/especial, TransMiCable. That is how every ride says whether it is TransMilenio or SITP.
- **Stop kinds.** A stop is a station (`estación`) when it is a platform inside a station or portal, or when any troncal route serves it; otherwise it is a street stop (`paradero`). Some SITP routes leave from inside portals, and their rides say `estación` too.

## The algorithm

`src/transit/raptor.ts` is RAPTOR (Delling, Pajor and Werneck, 2012), the round-based algorithm behind OpenTripPlanner 2. Round *k* finds the earliest arrival at every stop with at most *k* vehicles. The rounds therefore give the Pareto set of arrival time against number of vehicles, up to 4 vehicles (3 transfers).

Each stop keeps two labels per round: arriving on a vehicle and arriving on foot. That makes the rules exact:

- You walk only after getting off a vehicle, never twice in a row. The walk to the destination also starts where you get off; the only exception is when the origin's own stop is already close to the destination.
- Boarding after getting off another vehicle needs 60 s; boarding after walking does not.
- Access and egress walks reach stops within 800 m, widened to 1,500 m only when fewer than two stops are that close.
- The first walk starts as late as still catches the first vehicle, so "sal a las 7:31" is real.

### Correctness: checked against an independent exact algorithm

`test/planner/oracle.test.ts` implements Connection Scan (Dibbelt, Pajor, Strasser and Wagner, 2013) as an oracle. It is a completely different exact algorithm, with the same walking and transfer rules. On the real network both must agree on the earliest arrival of random trips, at random times of day.

**2,000 of 2,000 random trips agree to the second.** Writing this oracle found three real bugs before they reached anyone:
- A transfer buffer was lost across rounds.
- Two footpaths could chain.
- A walk to the destination could follow another walk.

`npm run check` runs 200 such trips when the data is built.

## From journeys to options

`src/transit/itinerary.ts` turns journeys into what a rider sees:

1. **Pareto set.** Takes the fastest journey, plus the ones with fewer vehicles if they arrive at most 15 minutes later.
2. **Later departures.** Re-plans from just after the best option's first bus, so the rider sees what comes next.
3. **Sanity checks.** An option is refused, not shown, when:
   - time goes backwards;
   - it waits more than an hour between vehicles;
   - a ride ends less than 150 m from where it started;
   - it gets off and back on the same route;
   - it walks more than 2.5 km;
   - it lasts more than 4.5 hours;
   - the distance ridden exceeds 2.5 × the straight-line trip + 3 km.
4. **Ranking.** Options are ranked by arrival. Any option that another beats on arrival, vehicles and walking at once is dropped, unless it leaves later. Each kept option says why it is there: `fastest`, `fewer_transfers`, `next_departure` or `alternative`.

When nothing runs now, or the first bus is more than an hour away, the answer is `no_service_now` with the next departure. When the day is over, it offers tomorrow's first option, searched from midnight because service starts before dawn, and says so. A date with no published timetable says that. Under 900 m it suggests walking. If nothing reasonable exists, it says so and returns no options.

## Live

Only TransMilenio's predictions are live, and only for leaving now (±20 minutes):

- For each option's first bus, the planner reads `stop-arrivals` at the boarding stop. It takes the prediction for **that very bus**: same route, and its own timetable time (`predicted_at` minus `delay_seconds`) within 90 s of the planned departure. This keeps a "next departure" option on its own bus, and it keeps routes with several stop patterns apart.
- It re-times the option: the first ride moves to the prediction, and every later connection is re-checked against the timetable. A connection that is now missed is re-planned onto the next trip.
- If a live bus would break the sanity checks, the timetable option stays as it was.

Every ride says `departureBasis: "live" | "scheduled"`, decided per option. Ride times are always from the timetable. When TransMilenio is not publishing live data, every time is scheduled and the answer says so. Alerts for each ride's route come from Croma. Live data and alerts wait at most 1.5 s and 1.2 s, and the plan never waits on them.

## Places and addresses

The point of this part: never send anyone somewhere they did not mean.

**Addresses** (`src/transit/address.ts`) follow Bogotá's grid. "Calle 72 # 10-34" is on Calle 72, 34 m past its corner with Carrera 10. The parser reads every way riders and forms write this:
- `Cl`, `Cra`, `Kr`, `AK`, `AC`, `Dg`, `Tv`;
- `No.`, `#`, dashes or spaces;
- letters and `Bis`;
- `Sur`, which always belongs to the calle, and `Este`, which always belongs to the carrera, both only as whole words ("Surtimax" is not *Sur*);
- corners such as "Calle 72 con 10" or "Cl 72 x Kr 10".

Anything written after the address is kept. Apartment details are ignored. Another municipality (Chía, Soacha, Zipaquirá…) is refused. Anything else makes the candidate `approximate`, with a note naming the words that were not used, so nothing is dropped silently.

**Geocoding** (`src/transit/places.ts`) works on OpenStreetMap streets. Only streets inside Bogotá D.C. are used, because Soacha, Chía and Funza reuse the same numbers. Every street is indexed under its nomenclature key, from all its name tags.
- **The point.** It is where the two streets meet, moved along the street by the placa toward the next cross street.
- **Checked against the neighbouring grid.** A corner must have corners with neighbouring numbers close by, along both streets. Bogotá reuses numbers (Usme pueblo has its own grid), and a street can be missing from the map. A corner the grid does not confirm is dropped, or comes back `approximate` with a note. With no barrio within 1.5 km it is never `exact`.
- **Blocks whose cross street never physically reaches them** (a park, a campus) are placed by interpolating between the neighbouring corners that do.
- **An address that exists in two parts of the city** comes back as two candidates with their barrios, so the rider chooses.
- **A street that does not exist** is an error that names it. Nothing is guessed.

**Landmarks and barrios** come from OpenStreetMap: about 8,700 universities, malls, hospitals, parks, stadiums, museums, terminals, barrios and so on. Places with a Wikipedia entry rank higher. TransMilenio stations and SITP stops come from the GTFS, by name or SITP code. These are never `exact`, so the rider is asked:
- one generic word ("Hospital", "Terminal");
- a station named like a bigger place, such as "Universidad Nacional" (the station or the campus);
- two candidates close in score.

**The confirmation contract.** Every candidate carries its barrio, the nearest TransMilenio station and the nearest SITP stop, so a rider can recognise it.
- **Signed ids.** Ids leave the server signed with HMAC-SHA-256 (`PARADERO_PLACE_SECRET`, or a key derived from `CROMA_API_KEY`). `/api/plan` and `plan_trip` refuse any other id, and resolve the signed one again on the server, so an assistant cannot plan from a place it made up.
- **Device locations.** These go through `resolve_place` as `geo:lat,lon`. They are rounded to 4 decimals, and are refused outside Bogotá D.C. or more than 1.5 km from any stop. The MCP instructions tell assistants to:
- read every end back and get a yes before planning;
- ask when there are several candidates, an approximate one or a note;
- never plan from what they know of Bogotá.

Measured on published addresses of well-known places, against where OpenStreetMap maps the place itself:

| Address | Place | Distance | Confidence |
| --- | --- | --- | --- |
| Carrera 11 # 82-71 | C.C. Andino | 28 m | exact |
| Carrera 6 # 15-88 | Museo del Oro | 36 m (interpolated) | approximate |
| Calle 11 # 4-14 | Biblioteca Luis Ángel Arango | 60 m | exact |
| Avenida Carrera 15 # 124-30 | Unicentro | 198 m (centroid of a large mall) | exact |
| Carrera 30 # 57-60 | Estadio El Campín | 198 m | approximate |
| Carrera 7 # 40-62 | Hospital San Ignacio | 221 m (interpolated) | approximate |
| Carrera 1 # 18A-12 | Universidad de los Andes | 224 m | exact |

Approximate means the rider is asked to confirm. Being conservative is the point: a wrong "exact" sends someone to the wrong side of the city.

## Benchmarks

`npm run bench:planner` plans 1,000 random trips over 2 km, from points near random stops, on the 2026-10-27 feed. It runs the full pipeline: alternatives, sanity checks and ranking. Measured on an Apple Silicon laptop, Node 22.

| When | Answered | p50 | p95 | Fastest option, median |
| --- | --- | --- | --- | --- |
| Weekday 7:30 | 99.7 % | 79 ms | 188 ms | 66 min |
| Weekday 13:00 | 99.9 % | 80 ms | 169 ms | 66 min |
| Sunday 10:00 | 99.8 % | 81 ms | 174 ms | 64 min |
| Weekday 22:45 | 98.6 % | 67 ms | 134 ms | 53 min |

Late at night the unanswered trips are those with no service left. The server answers them with tomorrow's first option. Building the day's timetable takes about 7 ms, and decoding the network about 12–40 ms per server instance.

## Compared with OpenTripPlanner 2

| | OpenTripPlanner 2 | Paradero |
| --- | --- | --- |
| Transit algorithm | RAPTOR (Range/Multi-criteria) | RAPTOR, checked against Connection Scan on 2,000 trips |
| Timetable | Full GTFS | Full GTFS, every trip, ≤2 s from the official stop times |
| Real time | GTFS-RT TripUpdates on every trip | Live prediction for each option's first bus. Later legs re-checked on the timetable and marked scheduled |
| Walking | Street network from OSM | Straight line × 1.3, plus station entry and exit time |
| Addresses | None built in (needs Pelias, Photon or Nominatim) | Bogotá nomenclature parser and geocoder, with ambiguity and confirmation |
| Answers for AI assistants | None | MCP tools with confirmation and honesty rules |
| Infrastructure | JVM server, several GB of RAM, graph build | The existing serverless deploy; 2.3 MB of static data |

**When to switch:**
- if street-accurate walking matters (hills, rivers, highways that straight lines cross);
- if live data for every leg becomes available as GTFS-RT;
- if 4+ transfers are needed.

The planner sits behind `options()` in `src/transit/itinerary.ts`, so another engine can replace it without touching the API, the MCP or the app.

## Limits, said plainly

- **Walking is a straight line** × 1.3, so a footbridge or a long block can make a walk longer than shown.
- **Only the first bus is live.** Later legs are the timetable.
- **No fares**, and no TuLlave transfer window yet.
- **No "arrive by"** yet: it would be reverse RAPTOR.
- **Landmarks are as good as OpenStreetMap.** Some (Movistar Arena, for example) are missing as places but found as stations, or by address.
- **Addresses outside Bogotá D.C.** (Soacha, Chía…) are not geocoded. Assistants are told to ask for a station or landmark instead.
- **Named avenues.** Avenues mapped only by their own name are not grid streets in the index ("Avenida Jiménez" is aliased to Calle 13), so some real corners come back "not found", never as a wrong place.
- **Accessibility.** TransMilenio's GTFS marks every stop accessible, so `accessible=1` cannot narrow anything until the feed does.
- **Corrupt names.** Stop names are shown as the feed has them, including a few broken ones.

## Running it

```bash
npm run network         # latest GTFS + OpenStreetMap → public/network (about 2 minutes)
npm run test:planner    # unit tests; the oracle runs too when the data is built
ORACLE_QUERIES=2000 npm run test:planner
npm run bench:planner
```

`npm run deploy:api` builds the data before exporting, so each deploy plans on the newest published timetable. The server reads the data from `PARADERO_NETWORK_URL`, by default `https://paradero.expo.app/network`, never from the request's Host (the local server only in development).

A `depart_at`/`at` without an offset is Bogotá time. A bare date is refused.

## Data and licences

- **Timetable:** TransMilenio S.A. open data (static GTFS).
- **Places and streets:** © OpenStreetMap contributors, under the ODbL 1.0. `public/network/places.json` is a derived database under the same licence.
- **Live predictions and alerts:** Croma.
