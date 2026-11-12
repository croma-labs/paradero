import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { PressableScale } from "pressto";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { toast } from "sonner-native";

import { useT } from "@/i18n";
import { announce, useLargeText } from "@/lib/accessibility";
import { knownStop, useRoute, useStop } from "@/lib/api";
import { spokenCode } from "@/lib/format";
import { useLocation } from "@/lib/location";
import { toggleStop } from "@/lib/saved";
import { usePalette } from "@/theme/colors";
import { layout, radius, size, space } from "@/theme/tokens";
import { wayTowards } from "@/transit/follow";
import { metresBetween } from "@/transit/path";
import type { Arrival, StopDetail } from "@/transit/types";

import { AlertCard } from "./alert-card";
import { ArrivalRow } from "./arrival-row";
import { Button } from "./button";
import { Chip } from "./chip";
import { FeedStatus } from "./feed-status";
import { Icon, icons } from "./icon";
import { NextBus } from "./next-bus";
import { RouteBadge } from "./route-badge";
import { RouteRow } from "./route-row";
import { SkeletonList } from "./skeleton";
import { Empty } from "./state";
import { StopTile } from "./stop-row";
import { Text } from "./text";
import type { MapHandle, TransitMapProps } from "./transit-map.types";

/** A rider this close to the stop is kept in the frame with the bus, to judge the walk against the wait. Further away, the map would zoom out too far to read. */
const RIDER_IN_FRAME_M = 1_500;
/** How long the map rests after framing a bus before it will move again on its own. */
const FRAME_REST_MS = 20_000;

const keyOf = (a: Arrival) => `${a.routeId ?? a.code}-${a.plate ?? a.vehicle ?? a.at}`;

/**
 * A stop, its arrivals and the bus the map follows, for whichever screen holds the map: the stop's own screen, or the home sheet.
 * `map` is that screen's map, framed on the stop, the followed bus and the rider.
 */
export function useStopView(id: string | undefined, map: RefObject<MapHandle | null>) {
  const { data, isLoading, isError, refetch } = useStop(id);
  const early = useMemo(() => knownStop(id), [id]);
  const stop = data?.stop ?? early;
  const [only, setOnly] = useState<string | null>(null);

  const codes = useMemo(() => [...new Set((data?.arrivals ?? []).map((a) => a.code))], [data]);
  const arrivals = (data?.arrivals ?? []).filter((a) => !only || a.code === only);
  const [next, ...later] = arrivals;

  // The bus the map follows: the next one, until the rider picks another.
  const [picked, setPicked] = useState<string | null>(null);
  // Another stop starts over: every route, the next bus.
  const [shown, setShown] = useState(id);
  if (id !== shown) {
    setShown(id);
    setOnly(null);
    setPicked(null);
  }
  const followed = arrivals.find((a) => keyOf(a) === picked) ?? next;
  const live = !!data?.feed.live && followed?.basis !== "scheduled";
  const { data: route } = useRoute(live ? (followed?.routeId ?? undefined) : undefined);
  const focus = live && followed?.plate ? (route?.buses.find((b) => b.plate === followed.plate) ?? null) : null;
  const way = useMemo(() => (route && stop ? wayTowards(route.patterns ?? [{ path: route.path }], stop, focus) : undefined), [route, stop, focus]);
  const buses =
    route && live && followed ? route.buses.map((b) => ({ ...b, code: followed.code, system: followed.system })) : data?.feed.live ? data.incoming.filter((b) => !only || b.code === only) : [];

  // The map frames the stop, the bus and the rider when it starts following a bus: on arriving, when the rider picks one, and when the one
  // followed has come and the next takes its place. Buses trading places in the list from one report to the next must not shake it, so it rests between moves.
  const { state: place } = useLocation();
  const rider = place.status === "ready" && stop && metresBetween([place.lon, place.lat], [stop.lon, stop.lat]) <= RIDER_IN_FRAME_M ? place : null;
  const framed = useRef<{ bus: string | null; at: number }>({ bus: null, at: 0 });
  useEffect(() => {
    framed.current = { bus: null, at: 0 };
  }, [id]);
  useEffect(() => {
    if (!focus || !stop || place.status === "loading" || framed.current.bus === focus.id) return;
    if (Date.now() - framed.current.at < FRAME_REST_MS) return;
    framed.current = { bus: focus.id, at: Date.now() };
    map.current?.fit([[stop.lon, stop.lat], [focus.lon, focus.lat], ...(rider ? [[rider.lon, rider.lat] as [number, number]] : [])]);
  }, [focus, stop, rider, place.status, map]);

  const follow = (a: Arrival) => {
    void Haptics.selectionAsync();
    framed.current = { bus: null, at: 0 };
    setPicked(keyOf(a));
  };

  const mapProps: Pick<TransitMapProps, "path" | "approach" | "system" | "buses" | "showCodes" | "focusBusId"> = {
    path: way?.line,
    approach: way?.approach,
    system: followed?.system,
    buses,
    showCodes: !route,
    focusBusId: focus?.id ?? null,
  };

  return { data, isLoading, isError, refetch, stop, only, setOnly, codes, next, later, followed, focus, follow, mapProps };
}

export type StopView = ReturnType<typeof useStopView>;

/** Saving a stop is the same gesture on its own screen and in the home sheet. */
export function useSaveStop() {
  const t = useT();
  return (stop: StopDetail["stop"]) => {
    const added = toggleStop(stop);
    void Haptics.notificationAsync(added ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    if (added) toast.success(t.stop.saved.title, { description: t.stop.saved.body });
    else toast(t.stop.removed);
    announce(added ? `${t.stop.saved.title}. ${t.stop.saved.body}` : t.stop.removed);
  };
}

/** Everything about a stop below the map: its name, the next buses, the routes that call there. */
export function StopDetails({ view, actions }: { view: StopView; actions?: ReactNode }) {
  const p = usePalette();
  const t = useT();
  const large = useLargeText();
  const { data, isLoading, isError, refetch, stop, only, setOnly, codes, next, later, followed, focus, follow } = view;

  return (
    <>
      {stop && (
        <View style={styles.header}>
          <StopTile kind={stop.kind} tier="lg" />
          <View style={styles.titles}>
            <Text variant="title" accessibilityRole="header" numberOfLines={large ? undefined : 2}>
              {stop.name}
            </Text>
            <View style={styles.meta}>
              <Text variant="caption" tone="muted">
                {stop.kind === "station" ? t.stop.station : t.stop.sitp}
              </Text>
              {stop.accessible && (
                <View style={styles.meta}>
                  <Icon name={icons.wheelchair} color={p.faint} size="xs" />
                  <Text variant="caption" tone="muted">
                    {t.common.accessible}
                  </Text>
                </View>
              )}
            </View>
          </View>
          {actions}
        </View>
      )}
      {isLoading && <SkeletonList rows={5} kind="arrival" />}
      {isError && !data && <Empty title={t.stop.failed.title} body={t.stop.failed.body} action={t.common.retry} onAction={() => void refetch()} />}

      {data && (
        <>
          {codes.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={styles.bleed}>
              <Chip label={t.stop.all} accessibilityLabel={`${t.stop.all}, ${t.stop.allLabel}`} selected={!only} onPress={() => setOnly(null)} />
              {codes.map((c) => {
                const a = data.arrivals.find((x) => x.code === c)!;
                const on = only === c;
                return (
                  <PressableScale
                    key={c}
                    accessibilityRole="button"
                    accessibilityLabel={`${c}, ${t.stop.only(spokenCode(c))}`}
                    accessibilityState={{ selected: on }}
                    hitSlop={space[1]}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setOnly(on ? null : c);
                    }}
                    style={[styles.chip, { borderColor: on ? p.ink : only ? p.separator : "transparent" }]}>
                    <RouteBadge code={c} system={a.system} />
                  </PressableScale>
                );
              })}
            </ScrollView>
          )}

          {next ? <NextBus arrival={next} following={!!focus && followed === next} onPress={() => follow(next)} /> : <Empty title={t.stop.none.title} body={t.stop.none.body} />}

          {/* Each live arrival already says so; the notice is for when times fall back to the timetable. */}
          {!data.feed.live && <FeedStatus feed={data.feed} />}
          <AlertCard alerts={data.alerts} />

          {later.length > 0 && (
            <View>
              <Text variant="title" style={styles.heading}>
                {t.stop.later}
              </Text>
              {later.slice(0, 10).map((a, i) => (
                <ArrivalRow key={`${a.code}-${a.at}-${i}`} arrival={a} first={i === 0} index={i} following={!!focus && followed === a} onPress={() => follow(a)} />
              ))}
            </View>
          )}

          <View>
            <Text variant="title" style={styles.heading}>
              {t.stop.routesHere}
            </Text>
            <View style={styles.bleed}>
              {data.stop.routes.map((r) => (
                <RouteRow key={r.id} route={r} />
              ))}
            </View>
          </View>
        </>
      )}
      {stop && <Button variant="quiet" height="md" label={t.stop.report} onPress={() => router.push({ pathname: "/report", params: { stopId: stop.id, stopName: stop.name } })} />}
    </>
  );
}

/** A round icon button for the sheet, where there is no header to hold it. */
export function SheetButton({ icon, label, selected, onPress }: { icon: (typeof icons)[keyof typeof icons]; label: string; selected?: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} hitSlop={space[1]} onPress={onPress} style={[styles.round, { backgroundColor: p.surface }]}>
      <Icon name={icon} color={p.text} size="sm" />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space[3] },
  titles: { flex: 1, gap: space[1] },
  meta: { flexDirection: "row", alignItems: "center", gap: space[1.5], flexWrap: "wrap" },
  bleed: { marginHorizontal: -layout.gutter },
  filters: { gap: space[2], alignItems: "center", paddingHorizontal: layout.gutter },
  chip: { padding: space[0.5], borderRadius: radius.md, borderWidth: size.line.rule, borderCurve: "continuous" },
  heading: { marginBottom: space[1] },
  round: { width: size.control.sm, height: size.control.sm, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
