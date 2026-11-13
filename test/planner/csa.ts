/**
 * Connection Scan (Dibbelt, Pajor, Strasser, Wagner, "Intriguingly Simple and Fast Transit
 * Routing", 2013): an exact earliest-arrival algorithm built completely differently from RAPTOR.
 * Used only as an oracle in tests, with the same walking and transfer rules.
 */
import { departure, type Network } from "../../src/transit/network.ts";
import { SAME_STOP_TRANSFER_S, type DayTimetable, type Endpoint } from "../../src/transit/raptor.ts";

export interface Connections {
  dep: Int32Array;
  arr: Int32Array;
  from: Int32Array;
  to: Int32Array;
  trip: Int32Array;
}

/** Every stop-to-stop hop of every trip that runs, departing within [from, to], by departure. */
export function connections(net: Network, day: DayTimetable, from: number, to: number): Connections {
  const dep: number[] = [];
  const arr: number[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const trip: number[] = [];
  let id = 0;
  for (let g = 0; g < day.trips.length; g++) {
    const stops = net.patternStops[net.groupPattern[g]];
    for (let j = 0; j < day.trips[g].length; j++, id++) {
      const k = day.trips[g][j];
      const shift = day.shift[g][j];
      for (let pos = 0; pos + 1 < stops.length; pos++) {
        const d = departure(net, g, k, pos) - shift;
        if (d < from || d > to) continue;
        dep.push(d);
        arr.push(departure(net, g, k, pos + 1) - shift);
        a.push(stops[pos]);
        b.push(stops[pos + 1]);
        trip.push(id);
      }
    }
  }
  const order = Array.from(dep.keys()).sort((x, y) => dep[x] - dep[y] || arr[x] - arr[y]);
  return {
    dep: Int32Array.from(order, (i) => dep[i]),
    arr: Int32Array.from(order, (i) => arr[i]),
    from: Int32Array.from(order, (i) => a[i]),
    to: Int32Array.from(order, (i) => b[i]),
    trip: Int32Array.from(order, (i) => trip[i]),
  };
}

/** Earliest arrival at the destination, under the same rules RAPTOR uses. */
export function csa(net: Network, c: Connections, origin: Endpoint[], destination: Endpoint[], departAt: number): number {
  const n = net.stopCount;
  const byWalk = new Float64Array(n).fill(Infinity);
  const byVehicle = new Float64Array(n).fill(Infinity);
  const onTrip = new Set<number>();
  for (const o of origin) byWalk[o.stop] = Math.min(byWalk[o.stop], departAt + o.walk);
  let best = Infinity;
  const access = new Float64Array(byWalk);
  // The walk to the destination starts from getting off a vehicle, or straight from the origin's own stop
  const target = () => {
    let t = Infinity;
    for (const d of destination) t = Math.min(t, Math.min(access[d.stop], byVehicle[d.stop]) + d.walk);
    return t;
  };
  best = target();
  for (let i = 0; i < c.dep.length; i++) {
    if (c.dep[i] >= best) break;
    const s = c.from[i];
    const ready = Math.min(byWalk[s], byVehicle[s] + SAME_STOP_TRANSFER_S);
    if (!onTrip.has(c.trip[i]) && ready > c.dep[i]) continue;
    onTrip.add(c.trip[i]);
    const t = c.to[i];
    if (c.arr[i] < byVehicle[t]) {
      byVehicle[t] = c.arr[i];
      const w = net.walks[t];
      for (let k = 0; k < w.length; k += 2) byWalk[w[k]] = Math.min(byWalk[w[k]], c.arr[i] + w[k + 1]);
      best = Math.min(best, target());
    }
  }
  return best;
}
