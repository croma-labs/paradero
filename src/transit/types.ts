export const SYSTEMS = [
  "troncal",
  "dual",
  "zonal_urbano",
  "alimentador",
  "zonal_complementario",
  "zonal_especial",
  "transmicable",
  "other",
] as const;

export type System = (typeof SYSTEMS)[number];

export type Basis = "predicted" | "estimated" | "scheduled";

/** Size derived from an exact plate match in the published fleet register, not live occupancy. */
export interface VehicleSize {
  size: "small" | "large";
  /** Month of the source register, YYYY-MM. */
  asOf: string;
}

export interface Feed {
  asOf: string;
  live: boolean;
}

export interface RouteRef {
  id: string;
  feedCode: string;
  code: string;
  aliases: string[];
  name: string;
  system: System;
  variant: string | null;
}

export interface Stop {
  id: string;
  name: string;
  kind: "station" | "stop";
  lat: number;
  lon: number;
  accessible: boolean;
  distanceM: number | null;
  routes: RouteRef[];
}

export interface Arrival {
  routeId: string | null;
  code: string;
  aliases: string[];
  name: string;
  system: System;
  minutes: number | null;
  at: string | null;
  basis: Basis;
  delaySeconds: number | null;
  vehicle: string | null;
  /** The bus's plate, to find it on the map. Absent from servers before 0.0.5. */
  plate?: string | null;
  /** Absent from older servers; null when the vehicle is not in the fleet register. */
  vehicleSize?: VehicleSize | null;
  /** Explicit server opt-in for reporting an unknown size; absent on older servers. */
  canReportVehicleSize?: boolean;
}

export interface Alert {
  id: string;
  effect: string;
  /** Spanish sentences, kept for app versions that predate translations. */
  title: string;
  detail: string;
  /** Where it happens, as stop names. Two places mean "between", one means "near". */
  places?: string[];
  /** TransMilenio's own words when it names no stops. Shown as written, like stop names. */
  note?: string | null;
  routes: string[];
  until: string | null;
}

export interface Bus {
  id: string;
  lat: number;
  lon: number;
  nextStop: string | null;
  plate: string | null;
  reportedAt: string | null;
  vehicleSize?: VehicleSize | null;
}

export interface IncomingBus extends Bus {
  code: string;
  system: System;
}

export interface StopDetail {
  feed: Feed;
  stop: Stop;
  arrivals: Arrival[];
  incoming: IncomingBus[];
  alerts: Alert[];
}

export interface RouteDetail {
  feed: Feed;
  route: RouteRef & {
    firstDeparture: string | null;
    lastDeparture: string | null;
    tripsPerWeek: number | null;
  };
  path: [number, number][];
  /** Every way the route runs, the busiest first: its line and its stops in order. Absent from servers before 0.0.5. */
  patterns?: { path: [number, number][]; stops: string[] }[];
  stops: { id: string; name: string; lat: number; lon: number }[];
  buses: Bus[];
  alerts: Alert[];
}

export interface Nearby {
  stops: Stop[];
}

export interface SearchResult {
  stops: Stop[];
  routes: RouteRef[];
}

export interface Health {
  feed: Feed;
}
