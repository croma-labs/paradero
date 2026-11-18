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
  /** Per group, per entry in `trips`: the trip's start minus its shift, so the scan reads one array, not three. */
  start: Int32Array[];
  /** Per group, per entry in `trips`: the trip's scale over the pattern's offsets. */
  scale: Int32Array[];
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
  // Flags per service instead of a Set lookup per trip (~180,000 trips a day), and arrays sized up front
  const services = net.services.id.length;
  const runsToday = new Uint8Array(services);
  const ranYesterday = new Uint8Array(services);
  for (const s of today) if (s >= 0 && s < services) runsToday[s] = 1;
  for (const s of yesterday) if (s >= 0 && s < services) ranYesterday[s] = 1;
  const groups = net.groupPattern.length;
  const trips: Int32Array[] = new Array(groups);
  const shift: Int32Array[] = new Array(groups);
  const dayStart: Int32Array[] = new Array(groups);
  const dayScale: Int32Array[] = new Array(groups);
  for (let g = 0; g < groups; g++) {
    const service = net.groupService[g];
    const count = net.groupStart[g].length;
    const lastOffset = net.patternOffsets[net.groupPattern[g]][net.patternStops[net.groupPattern[g]].length - 1];
    const start = net.groupStart[g];
    const scale = net.groupScale[g];
    let n = 0;
    for (let k = 0; k < count; k++) {
      if (ranYesterday[service[k]] && start[k] + Math.round((lastOffset * scale[k]) / 10_000) >= 86_400) n++;
      if (runsToday[service[k]]) n++;
    }
    const t = new Int32Array(n);
    const s = new Int32Array(n);
    let i = 0;
    for (let k = 0; k < count; k++) {
      if (ranYesterday[service[k]] && start[k] + Math.round((lastOffset * scale[k]) / 10_000) >= 86_400) {
        t[i] = k;
        s[i++] = 86_400;
      }
    }
    for (let k = 0; k < count; k++) {
      if (runsToday[service[k]]) t[i++] = k;
    }
    const ds = new Int32Array(n);
    const dc = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      ds[i] = start[t[i]] - s[i];
      dc[i] = scale[t[i]];
    }
    trips[g] = t;
    shift[g] = s;
    dayStart[g] = ds;
    dayScale[g] = dc;
  }
  return { trips, shift, start: dayStart, scale: dayScale };
}

const at = (net: Network, day: DayTimetable, g: number, j: number, pos: number) => departure(net, g, day.trips[g][j], pos) - day.shift[g][j];

/**
 * Each stop keeps two labels per round: the earliest arrival on a vehicle and the earliest arrival
 * on foot. Walking only starts from getting off a vehicle (never two walks in a row, the walk to
 * the destination included), and boarding after getting off another vehicle needs
 * SAME_STOP_TRANSFER_S, so the rules are exact.
 */
export function raptor(net: Network, day: DayTimetable, q: Query): Journey[] {
  const n = net.stopCount;
  const rounds = Math.min(q.maxRides ?? MAX_RIDES, HARD_LIMIT);
  const accessibleOnly = q.accessibleOnly === true;
  const accessible = net.accessible;
  const usable = (s: number) => !accessibleOnly || accessible[s] === 1;

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
  const egress = new Map<number, number>();
  for (const e of q.destination) if (usable(e.stop)) egress.set(e.stop, Math.min(e.walk, egress.get(e.stop) ?? Infinity));
  const egressStop = Int32Array.from(egress.keys());
  const egressWalk = Float64Array.from(egress.values());

  // Sets of stops as a flag per stop plus a list in insertion order: same order a Set would iterate in,
  // without allocating one per round (Hermes has no JIT to remove that cost).
  const markedFlag = new Uint8Array(n);
  let marked = new Int32Array(n);
  let markedCount = 0;
  const improvedFlag = new Uint8Array(n);
  const improved = new Int32Array(n);
  const walkedFlag = new Uint8Array(n);
  const walked = new Int32Array(n);
  let spare = new Int32Array(n);

  for (const o of q.origin) {
    if (!usable(o.stop)) continue;
    const t = q.departAt + o.walk;
    if (t < byWalk[0][o.stop]) {
      byWalk[0][o.stop] = t;
      if (!markedFlag[o.stop]) {
        markedFlag[o.stop] = 1;
        marked[markedCount++] = o.stop;
      }
    }
  }

  // Groups to scan in a round, with the earliest marked position on each (-1: not queued)
  const groupCount = net.groupPattern.length;
  const queuePos = new Int32Array(groupCount).fill(-1);
  const queue = new Int32Array(groupCount);

  const journeys: Journey[] = [];
  let target = Infinity;
  const walkOrigin = byWalk[0];

  for (let k = 1; k <= rounds && markedCount; k++) {
    const rideK = byRide[k];
    const walkK = byWalk[k];
    const ridePrev = byRide[k - 1];
    const walkPrev = byWalk[k - 1];
    // Each round starts from the previous one, so rideK and walkK are also the best arrival found so far
    rideK.set(ridePrev);
    walkK.set(walkPrev);
    const pGroup = p.rideGroup[k];
    const pTrip = p.rideTrip[k];
    const pFrom = p.rideFrom[k];
    const pFromPos = p.rideFromPos[k];
    const pToPos = p.rideToPos[k];
    const pOff = p.rideBoardedOff[k];
    const pWalk = p.walkFrom[k];

    let queued = 0;
    for (let m = 0; m < markedCount; m++) {
      const list = net.stopGroups[marked[m]];
      for (let i = 0; i < list.length; i += 2) {
        const g = list[i];
        const pos = list[i + 1];
        const seen = queuePos[g];
        if (seen === -1) {
          queuePos[g] = pos;
          queue[queued++] = g;
        } else if (pos < seen) queuePos[g] = pos;
      }
    }

    let improvedCount = 0;
    for (let qi = 0; qi < queued; qi++) {
      const g = queue[qi];
      const start = queuePos[g];
      queuePos[g] = -1;
      const dayTrips = day.trips[g];
      const tripCount = dayTrips.length;
      if (tripCount === 0) continue; // the group does not run on this day
      const pattern = net.groupPattern[g];
      const stops = net.patternStops[pattern];
      const offsets = net.patternOffsets[pattern];
      const dayStart = day.start[g];
      const dayScale = day.scale[g];
      // Same value as departure(net, g, dayTrips[j], pos) - day.shift[g][j], read from the day's own arrays.
      // ((offset × scale + 5 000) / 10 000) | 0 is Math.round(offset × scale / 10 000) without a call per stop:
      // equal for every product ≥ 0 whose result fits 32 bits, which networkProblems() checks when the file is built.
      let trip = -1;
      let tripStart = 0;
      let tripScale = 0;
      let boardStop = -1;
      let boardPos = -1;
      let boardOff = 0;
      for (let pos = start; pos < stops.length; pos++) {
        const s = stops[pos];
        if (accessibleOnly && accessible[s] !== 1) continue;
        const offset = offsets[pos];
        let here = Infinity;
        if (trip >= 0) {
          here = tripStart + (((offset * tripScale + 5_000) / 10_000) | 0);
          if (here < rideK[s] && here < target) {
            rideK[s] = here;
            pGroup[s] = g;
            pTrip[s] = trip;
            pFrom[s] = boardStop;
            pFromPos[s] = boardPos;
            pToPos[s] = pos;
            pOff[s] = boardOff;
            if (!improvedFlag[s]) {
              improvedFlag[s] = 1;
              improved[improvedCount++] = s;
            }
          }
        }
        // Boarding is only tried where the previous round improved something. At any other stop the same
        // boarding was already tried when the stop was last improved, and it reached every later stop of the
        // group no sooner than what is recorded now (labels and target only go down), so it changes nothing.
        if (!markedFlag[s]) continue;
        // When a rider who reached s in the previous round can board, and whether that is after getting off a vehicle
        const walk = walkPrev[s];
        const ride = ridePrev[s] + SAME_STOP_TRANSFER_S;
        const ready = walk <= ride ? walk : ride;
        // Boarding at `ready` or later reaches every later stop no sooner than `ready` (offsets never go back and
        // scales are not negative, see networkProblems), so from `target` on it cannot improve anything.
        if (ready < target && (trip < 0 || ready <= here)) {
          // Earliest trip leaving pos at or after `ready`. Only an earlier trip than the current one can
          // change anything, and trips of a group never overtake each other: when the one before the
          // current trip has already left, no earlier trip exists and the search is skipped.
          let lo = 0;
          let hi = tripCount;
          if (trip >= 0) {
            if (trip === 0) continue;
            if (dayStart[trip - 1] + (((offset * dayScale[trip - 1] + 5_000) / 10_000) | 0) < ready) continue;
            hi = trip - 1;
          } else {
            // Not on a trip yet: when the group's last trip has already left, no trip is left today
            if (dayStart[tripCount - 1] + (((offset * dayScale[tripCount - 1] + 5_000) / 10_000) | 0) < ready) continue;
          }
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (dayStart[mid] + (((offset * dayScale[mid] + 5_000) / 10_000) | 0) < ready) lo = mid + 1;
            else hi = mid;
          }
          if (lo < tripCount && (trip < 0 || lo < trip)) {
            trip = lo;
            tripStart = dayStart[lo];
            tripScale = dayScale[lo];
            boardStop = s;
            boardPos = pos;
            boardOff = walk <= ride ? 0 : 1;
          }
        }
      }
    }

    // One walk after getting off, never two
    let walkedCount = 0;
    for (let m = 0; m < improvedCount; m++) {
      const s = improved[m];
      const w = net.walks[s];
      const from = rideK[s];
      for (let i = 0; i < w.length; i += 2) {
        const to = w[i];
        const arrive = from + w[i + 1];
        if (arrive < target && arrive < walkK[to] && arrive < rideK[to] + SAME_STOP_TRANSFER_S && (!accessibleOnly || accessible[to] === 1)) {
          walkK[to] = arrive;
          pWalk[to] = s;
          if (!walkedFlag[to]) {
            walkedFlag[to] = 1;
            walked[walkedCount++] = to;
          }
        }
      }
    }

    // Did this round reach the destination sooner?
    let arrive = Infinity;
    let end = -1;
    let endOnFoot = false;
    let endWalk = 0;
    for (let i = 0; i < egressStop.length; i++) {
      const s = egressStop[i];
      // The last walk starts where the rider gets off: never after another walk (only at the origin stop with no vehicle at all)
      const onFoot = walkOrigin[s] <= rideK[s];
      const t = (onFoot ? walkOrigin[s] : rideK[s]) + egressWalk[i];
      if (t < arrive) {
        arrive = t;
        end = s;
        endOnFoot = onFoot;
        endWalk = egressWalk[i];
      }
    }
    if (end >= 0 && arrive < target) {
      target = arrive;
      journeys.push(rebuild(net, day, q, k, end, endOnFoot, endWalk, byRide, byWalk, p));
    }

    // Next round: the stops improved by a vehicle, then those reached on foot, each once
    for (let m = 0; m < markedCount; m++) markedFlag[marked[m]] = 0;
    const next = spare;
    let nextCount = 0;
    for (let m = 0; m < improvedCount; m++) {
      const s = improved[m];
      improvedFlag[s] = 0;
      markedFlag[s] = 1;
      next[nextCount++] = s;
    }
    for (let m = 0; m < walkedCount; m++) {
      const s = walked[m];
      walkedFlag[s] = 0;
      if (!markedFlag[s]) {
        markedFlag[s] = 1;
        next[nextCount++] = s;
      }
    }
    spare = marked;
    marked = next;
    markedCount = nextCount;
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
