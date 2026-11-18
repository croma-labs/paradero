import { focusManager, keepPreviousData, QueryClient, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import type { ReportInput, ReportResult } from "@/transit/report";
import type { Feed, Health, Nearby, RouteDetail, SearchResult, Stop, StopDetail } from "@/transit/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      staleTime: 10_000,
    },
  },
});

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** How often an open stop or route asks for fresh positions. The server keeps them for only a few seconds, so a new report shows up within moments. */
const LIVE = 5_000;

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => get<Health>("/api/health"), refetchInterval: 60_000 });
}

export function useNearby(point: { lat: number; lon: number } | null) {
  const lat = point?.lat.toFixed(3);
  const lon = point?.lon.toFixed(3);
  return useQuery({
    queryKey: ["nearby", lat, lon],
    queryFn: () => get<Nearby>(`/api/nearby?lat=${lat}&lon=${lon}`),
    enabled: !!point,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["search", q.toLowerCase()],
    queryFn: () => get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30 * 60_000,
  });
}

const stopQuery = (id: string) => ({ queryKey: ["stop", id], queryFn: () => get<StopDetail>(`/api/stops/${id}`), staleTime: LIVE });
const routeQuery = (id: string) => ({ queryKey: ["route", id], queryFn: () => get<RouteDetail>(`/api/routes/${id}`), staleTime: LIVE });

export function prefetchStop(id: string) {
  void queryClient.prefetchQuery(stopQuery(id));
}

export function prefetchRoute(id: string) {
  void queryClient.prefetchQuery(routeQuery(id));
}

/** A stop we already know from a list, so its screen can open with a name and a map instead of a blank. */
export function knownStop(id: string | undefined): Stop | undefined {
  if (!id) return undefined;
  for (const [, data] of queryClient.getQueriesData<Nearby | SearchResult>({ predicate: (q) => q.queryKey[0] === "nearby" || q.queryKey[0] === "search" })) {
    const hit = data?.stops.find((s) => s.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * How long an answer may go without a newer one and still be called live here. The server's verdict holds for the moment it was
 * given: offline or in a tunnel no newer answer comes, and "2 min" must not keep its live signal while the bus may have long gone.
 */
const QUIET_MS = 30_000;

/**
 * Says live only while answers keep arriving. Every screen reads `feed.live`, so correcting it here is enough for all of them: the
 * map stops drawing buses, the counts show "–" and the notice says since when there is no live data.
 */
function useLiveFeed<T extends { feed: Feed }>(query: UseQueryResult<T, Error>, focused: boolean): UseQueryResult<T, Error> {
  const { data, dataUpdatedAt, refetch } = query;
  const [now, setNow] = useState(Date.now);
  const [shownAt, setShownAt] = useState(Date.now);

  // Back in view after a while: the wait for news starts again and the answer is asked for at once, not on the next tick.
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      setShownAt(Date.now());
      if (first.current) first.current = false;
      else void refetch();
    }, [refetch]),
  );

  useEffect(() => {
    if (!focused || !data) return;
    const tick = setInterval(() => setNow(Date.now()), LIVE);
    return () => clearInterval(tick);
  }, [focused, data]);

  const live = !!data?.feed.live && now - Math.max(dataUpdatedAt, shownAt) <= QUIET_MS;
  const shown = useMemo(() => (data && data.feed.live !== live ? { ...data, feed: { ...data.feed, live } } : data), [data, live]);
  return shown === data ? query : ({ ...query, data: shown } as UseQueryResult<T, Error>);
}

// Only the screen in view asks every few seconds. Screens under it in the stack, and tabs left behind, wait until they are shown again.
export function useStop(id: string | undefined) {
  const focused = useIsFocused();
  return useLiveFeed(useQuery({ ...stopQuery(id ?? ""), enabled: !!id, refetchInterval: focused ? LIVE : false }), focused);
}

export function useRoute(id: string | undefined) {
  const focused = useIsFocused();
  return useLiveFeed(useQuery({ ...routeQuery(id ?? ""), enabled: !!id, refetchInterval: focused ? LIVE : false }), focused);
}

export async function sendReport(input: ReportInput): Promise<ReportResult> {
  const res = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? `http_${res.status}`);
  }
  return res.json() as Promise<ReportResult>;
}
