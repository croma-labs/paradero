import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import type { RouteRef, Stop } from "@/transit/types";

export interface RecentRoute {
  type: "route";
  route: Pick<RouteRef, "id" | "code" | "name" | "system">;
}

export interface RecentStop {
  type: "stop";
  /** Kept without its distance: how far it was when the rider opened it says nothing about now. */
  stop: Stop;
}

/** A route or stop the rider opened from search. Kept on the phone only: it is never sent to the server. */
export type Recent = RecentRoute | RecentStop;

const KEY = "recents.v1";
const LIMIT = 8;
const listeners = new Set<() => void>();

function read(): Recent[] {
  try {
    const stored: unknown = JSON.parse(Storage.getItemSync(KEY) ?? "[]");
    return Array.isArray(stored) ? (stored as Recent[]) : [];
  } catch {
    return [];
  }
}

let snapshot = read();

function write(next: Recent[]) {
  snapshot = next;
  Storage.setItemSync(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const idOf = (item: Recent) => (item.type === "route" ? item.route.id : item.stop.id);

/** Newest first, at most eight. */
export function useRecents(): Recent[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Puts the item first. One already in the list moves up instead of showing twice. */
export function addRecent(item: Recent) {
  const id = idOf(item);
  const fresh: Recent =
    item.type === "route"
      ? { type: "route", route: { id: item.route.id, code: item.route.code, name: item.route.name, system: item.route.system } }
      : { type: "stop", stop: { ...item.stop, distanceM: null } };
  write([fresh, ...snapshot.filter((r) => !(r.type === item.type && idOf(r) === id))].slice(0, LIMIT));
}

export function clearRecents() {
  write([]);
}
