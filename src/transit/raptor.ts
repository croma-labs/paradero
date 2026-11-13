/**
 * RAPTOR (Delling, Pajor, Werneck: "Round-Based Public Transit Routing", 2012), the algorithm
 * behind OpenTripPlanner 2. Round k finds the earliest arrival at every stop using at most k
 * vehicles, so the result is the Pareto set of (arrival time, number of vehicles).
 *
 * Pure and synchronous: the caller passes the network, the day's timetable and the clock.
 */
import { departure, type Network } from "./network.ts";

/** Vehicles per trip by default: up to three transfers. */
export const MAX_RIDES = 4;
const HARD_LIMIT = 8;
/** Getting off one bus and onto another at the same stop is not instant. */
export const SAME_STOP_TRANSFER_S = 60;

const NONE = -1;

export interface DayTimetable {
  /** Per group: the trips that run, as indexes into the group's arrays, earliest first. */
  trips: Int32Array[];
  /** Per group, per entry in `trips`: seconds to subtract (86 400 for yesterday's trips past midnight). */
  shift: Int32Array[];
}

export interface Endpoint {
  stop: number;
  /** Seconds of walking between the point and this stop. */
  walk: number;
}

export interface Query {
  origin: Endpoint[];
  destination: Endpoint[];
  /** Seconds after midnight of the service day. */
  departAt: number;
  maxRides?: number;
  accessibleOnly?: boolean;
}

export interface RideLeg {
  kind: "ride";
  group: number;
  trip: number;
  from: number;
  to: number;
  fromPosition: number;
  toPosition: number;
  departs: number;
  arrives: number;
}

export interface WalkLeg {
  kind: "walk";
  /** Stop index, or -1 for the origin point / the destination point. */
  from: number;
  to: number;
  departs: number;
  arrives: number;
}

export type Leg = RideLeg | WalkLeg;

export interface Journey {
  rides: number;
  departs: number;
  arrives: number;
  legs: Leg[];
}

/** Which trips run on a service day, given the active services today and yesterday. */
export function dayTimetable(net: Network, today: Set<number>, yesterday: Set<number>): DayTimetable {
  const trips: Int32Array[] = [];
  const shift: Int32Array[] = [];
  for (let g = 0; g < net.groupPattern.length; g++) {
    const service = net.groupService[g];
    const start = net.groupStart[g];
    const last = net.patternStops[net.groupPattern[g]].length - 1;
    const t: number[] = [];
    const s: number[] = [];
    for (let k = 0; k < start.length; k++) {
      if (yesterday.has(service[k]) && departure(net, g, k, last) >= 86_400) {
        t.push(k);
        s.push(86_400);
      }
    }
    for (let k = 0; k < start.length; k++) {
      if (today.has(service[k])) {
        t.push(k);
        s.push(0);
      }
    }
    trips.push(Int32Array.from(t));
    shift.push(Int32Array.from(s));
  }
  return { trips, shift };
}

const at = (net: Network, day: DayTimetable, g: number, j: number, pos: number) => departure(net, g, day.trips[g][j], pos) - day.shift[g][j];

/** First trip index in the day's list that leaves `pos` at or after `time`, or -1. */
function earliestTrip(net: Network, day: DayTimetable, g: number, pos: number, time: number): number {
  let lo = 0;
  let hi = day.trips[g].length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(net, day, g, mid, pos) < time) lo = mid + 1;
    else hi = mid;
  }
  return lo < day.trips[g].length ? lo : -1;
}

/**
 * Each stop keeps two labels per round: the earliest arrival on a vehicle and the earliest arrival
 * on foot. Walking only starts from getting off a vehicle (never two walks in a row, the walk to
 * the destination included), and boarding after getting off another vehicle needs
 * SAME_STOP_TRANSFER_S, so the rules are exact.
 */
export function raptor(net: Network, day: DayTimetable, q: Query): Journey[] {
  const n = net.stopCount;
  const rounds = Math.min(q.maxRides ?? MAX_RIDES, HARD_LIMIT);
  const usable = (s: number) => !q.accessibleOnly || net.accessible[s] === 1;

  const byRide: Float64Array[] = [];
  const byWalk: Float64Array[] = [];
  const p: Parents = { rideGroup: [], rideTrip: [], rideFrom: [], rideFromPos: [], rideToPos: [], rideBoardedOff: [], walkFrom: [] };
  for (let k = 0; k <= rounds; k++) {
    byRide.push(new Float64Array(n).fill(Infinity));
    byWalk.push(new Float64Array(n).fill(Infinity));
    p.rideGroup.push(new Int32Array(n).fill(NONE));
    p.rideTrip.push(new Int32Array(n));
    p.rideFrom.push(new Int32Array(n));
    p.rideFromPos.push(new Int32Array(n));
    p.rideToPos.push(new Int32Array(n));
    p.rideBoardedOff.push(new Uint8Array(n));
    p.walkFrom.push(new Int32Array(n).fill(NONE));
  }
  const bestRide = new Float64Array(n).fill(Infinity);
  const bestWalk = new Float64Array(n).fill(Infinity);

  const egress = new Map<number, number>();
  for (const e of q.destination) if (usable(e.stop)) egress.set(e.stop, Math.min(e.walk, egress.get(e.stop) ?? Infinity));

  let marked = new Set<number>();
  for (const o of q.origin) {
    if (!usable(o.stop)) continue;
    const t = q.departAt + o.walk;
    if (t < byWalk[0][o.stop]) {
      byWalk[0][o.stop] = t;
      bestWalk[o.stop] = t;
      marked.add(o.stop);
    }
  }

  const journeys: Journey[] = [];
  let target = Infinity;
  /** When a rider who reached `s` in round k can board, and whether that is after getting off a vehicle. */
  const ready = (k: number, s: number) => {
    const walk = byWalk[k][s];
    const ride = byRide[k][s] + SAME_STOP_TRANSFER_S;
    return walk <= ride ? { time: walk, off: 0 } : { time: ride, off: 1 };
  };

  for (let k = 1; k <= rounds && marked.size; k++) {
    byRide[k].set(byRide[k - 1]);
    byWalk[k].set(byWalk[k - 1]);

    // Groups to scan, from the earliest marked position on each
    const queue = new Map<number, number>();
    for (const s of marked) {
      const list = net.stopGroups[s];
      for (let i = 0; i < list.length; i += 2) {
        const g = list[i];
        const pos = list[i + 1];
        const seen = queue.get(g);
        if (seen === undefined || pos < seen) queue.set(g, pos);
      }
    }

    const improved = new Set<number>();
    for (const [g, start] of queue) {
      const stops = net.patternStops[net.groupPattern[g]];
      let trip = -1;
      let boardStop = -1;
      let boardPos = -1;
      let boardOff = 0;
      for (let pos = start; pos < stops.length; pos++) {
        const s = stops[pos];
        if (trip >= 0 && usable(s)) {
          const arrive = at(net, day, g, trip, pos);
          if (arrive < bestRide[s] && arrive < target) {
            byRide[k][s] = arrive;
            bestRide[s] = arrive;
            p.rideGroup[k][s] = g;
            p.rideTrip[k][s] = trip;
            p.rideFrom[k][s] = boardStop;
            p.rideFromPos[k][s] = boardPos;
            p.rideToPos[k][s] = pos;
            p.rideBoardedOff[k][s] = boardOff;
            improved.add(s);
          }
        }
        if (!usable(s)) continue;
        const r = ready(k - 1, s);
        if (r.time < Infinity && (trip < 0 || r.time <= at(net, day, g, trip, pos))) {
          const t = earliestTrip(net, day, g, pos, r.time);
          if (t >= 0 && (trip < 0 || t < trip)) {
            trip = t;
            boardStop = s;
            boardPos = pos;
            boardOff = r.off;
          }
        }
      }
    }

    // One walk after getting off, never two
    const walked = new Set<number>();
    for (const s of improved) {
      const w = net.walks[s];
      for (let i = 0; i < w.length; i += 2) {
        const to = w[i];
        const arrive = byRide[k][s] + w[i + 1];
        if (arrive < bestWalk[to] && arrive < bestRide[to] + SAME_STOP_TRANSFER_S && arrive < target && usable(to)) {
          byWalk[k][to] = arrive;
          bestWalk[to] = arrive;
          p.walkFrom[k][to] = s;
          walked.add(to);
        }
      }
    }

    // Did this round reach the destination sooner?
    let arrive = Infinity;
    let end = -1;
    let endOnFoot = false;
    for (const [s, walk] of egress) {
      // The last walk starts where the rider gets off: never after another walk (only at the origin stop with no vehicle at all)
      const onFoot = byWalk[0][s] <= byRide[k][s];
      const t = (onFoot ? byWalk[0][s] : byRide[k][s]) + walk;
      if (t < arrive) {
        arrive = t;
        end = s;
        endOnFoot = onFoot;
      }
    }
    if (end >= 0 && arrive < target) {
      target = arrive;
      journeys.push(rebuild(net, day, q, k, end, endOnFoot, egress.get(end)!, byRide, byWalk, p));
    }

    marked = new Set([...improved, ...walked]);
  }
  return journeys;
}

interface Parents {
  rideGroup: Int32Array[];
  rideTrip: Int32Array[];
  rideFrom: Int32Array[];
  rideFromPos: Int32Array[];
  rideToPos: Int32Array[];
  /** 1 when the rider boarded right after getting off another vehicle. */
  rideBoardedOff: Uint8Array[];
  walkFrom: Int32Array[];
}

function rebuild(
  net: Network,
  day: DayTimetable,
  q: Query,
  round: number,
  end: number,
  endOnFoot: boolean,
  egress: number,
  byRide: Float64Array[],
  byWalk: Float64Array[],
  p: Parents,
): Journey {
  // Reaching the destination on foot only happens straight from the origin's own stop
  const reached = endOnFoot ? byWalk[0][end] : byRide[round][end];
  const legs: Leg[] = [{ kind: "walk", from: end, to: -1, departs: reached, arrives: reached + egress }];
  let k = endOnFoot ? 0 : round;
  let s = end;
  let onFoot = endOnFoot;
  let rides = 0;
  while (k > 0) {
    if (onFoot) {
      const from = p.walkFrom[k][s];
      if (from === NONE) {
        k--;
        continue;
      }
      legs.push({ kind: "walk", from, to: s, departs: byRide[k][from], arrives: byWalk[k][s] });
      s = from;
      onFoot = false;
      continue;
    }
    const g = p.rideGroup[k][s];
    if (g === NONE) {
      k--;
      continue;
    }
    const trip = p.rideTrip[k][s];
    const fromPos = p.rideFromPos[k][s];
    const toPos = p.rideToPos[k][s];
    legs.push({
      kind: "ride",
      group: g,
      trip: day.trips[g][trip],
      from: p.rideFrom[k][s],
      to: s,
      fromPosition: fromPos,
      toPosition: toPos,
      departs: at(net, day, g, trip, fromPos),
      arrives: at(net, day, g, trip, toPos),
    });
    rides++;
    onFoot = p.rideBoardedOff[k][s] === 0;
    s = p.rideFrom[k][s];
    k--;
  }
  const access = q.origin.filter((o) => o.stop === s).reduce((m, o) => Math.min(m, o.walk), Infinity);
  legs.reverse();
  const firstRide = legs.find((l) => l.kind === "ride");
  // Leave as late as still catches the first vehicle
  const leave = (firstRide ? firstRide.departs : byWalk[0][s]) - access;
  legs.unshift({ kind: "walk", from: -1, to: s, departs: leave, arrives: leave + access });
  return { rides, departs: leave, arrives: reached + egress, legs };
}
