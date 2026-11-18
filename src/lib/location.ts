import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Linking, Platform } from "react-native";

import { queryClient } from "./api";

export const BOGOTA = { lat: 4.6486, lon: -74.0628 };

/** `denied`: the rider has not allowed it. `unavailable`: allowed, but the phone has no position to give (indoors, GPS off). */
export type LocationState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "outside" }
  | { status: "ready"; lat: number; lon: number };

type Reading = { granted: false } | { granted: true; point: { lat: number; lon: number } | null };

/** A position is good for this long. Without one there is nothing to keep: coming back to the app asks again. */
const KEEP = 2 * 60_000;

export const inBogota = (lat: number, lon: number) => lat > 4.4 && lat < 4.85 && lon > -74.3 && lon < -73.95;

/** A fix this fresh is good enough to list nearby stops. */
const RECENT = 2 * 60_000;
/** Android can wait minutes for a new fix indoors; after this, the last known one will do. */
const PATIENCE = 8_000;

function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work.catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), ms))]);
}

/** Reads the position only if the rider already said yes. Asking is always an explicit tap. */
async function locate(): Promise<Reading> {
  const { granted } = await Location.getForegroundPermissionsAsync();
  if (!granted) return { granted: false };
  const position = Platform.OS === "android" ? await locateAndroid() : await locateIos();
  return { granted: true, point: position ? { lat: position.coords.latitude, lon: position.coords.longitude } : null };
}

async function locateIos() {
  // A first fix indoors can take a long while on iOS too. Past the same patience as Android, the last known position will do.
  const fresh = await within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), PATIENCE);
  return fresh ?? (await Location.getLastKnownPositionAsync().catch(() => null));
}

async function locateAndroid() {
  const recent = await Location.getLastKnownPositionAsync({ maxAge: RECENT }).catch(() => null);
  return recent ?? (await within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), PATIENCE)) ?? (await Location.getLastKnownPositionAsync().catch(() => null));
}

/** Shows the system prompt, or opens Settings when the rider said no before and iOS won't ask again. */
export async function askForLocation(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) {
    await queryClient.invalidateQueries({ queryKey: ["location"] });
    return true;
  }
  if (!current.canAskAgain) {
    await Linking.openSettings();
    return false;
  }
  const { granted } = await Location.requestForegroundPermissionsAsync();
  await queryClient.invalidateQueries({ queryKey: ["location"] });
  return granted;
}

export function useLocation() {
  const query = useQuery({
    queryKey: ["location"],
    queryFn: locate,
    // Without a position the answer goes stale at once, so the app asks again when the rider returns to it: from Settings, where
    // they may have just allowed it, or from a pocket after stepping outside. Until now that took a second tap.
    staleTime: (q) => (q.state.data?.granted && q.state.data.point ? KEEP : 0),
    retry: false,
  });
  const reading = query.data;
  const state: LocationState = query.isPending
    ? { status: "loading" }
    : !reading?.granted
      ? { status: "denied" }
      : !reading.point
        ? { status: "unavailable" }
        : inBogota(reading.point.lat, reading.point.lon)
          ? { status: "ready", ...reading.point }
          : { status: "outside" };
  return { state, retry: askForLocation };
}
