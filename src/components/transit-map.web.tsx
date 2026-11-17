import { Asset } from "expo-asset";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibre } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useAccessibility } from "@/lib/accessibility";
import { useMovingBuses } from "@/lib/moving-buses";
import { systems, usePalette, type Palette } from "@/theme/colors";
import { space } from "@/theme/tokens";

import { Text } from "./text";
import { MAP_CREDIT, type MapHandle, type TransitMapProps } from "./transit-map.types";

/**
 * The web map, drawn with maplibre-gl so it matches the native one: the same CARTO basemaps, stops, route line,
 * way in and moving buses. Native code lives in transit-map.tsx; keep the two in step.
 */
const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const BOUNDS: [number, number, number, number] = [-74.45, 4.3, -73.85, 4.95];
const FIT_MARGIN = { top: 76, right: 56, bottom: 88, left: 56 };
const FIT_UNDER_SHEET = { top: 60, right: 40, bottom: 320, left: 40 };

const BUS_IMAGES: Record<string, number> = {
  "bus-troncal": require("@/assets/images/map/bus-troncal.png"),
  "bus-dual": require("@/assets/images/map/bus-dual.png"),
  "bus-zonal_urbano": require("@/assets/images/map/bus-zonal_urbano.png"),
  "bus-alimentador": require("@/assets/images/map/bus-alimentador.png"),
  "bus-zonal_complementario": require("@/assets/images/map/bus-zonal_complementario.png"),
  "bus-zonal_especial": require("@/assets/images/map/bus-zonal_especial.png"),
  "bus-transmicable": require("@/assets/images/map/bus-transmicable.png"),
  "bus-other": require("@/assets/images/map/bus-other.png"),
};
const BUS_IMAGES_BY_SYSTEM = new Set(Object.keys(systems));

type ZoomWidth = ["interpolate", ["linear"], ["zoom"], number, number, number, number];
const LINE_WIDTH: ZoomWidth = ["interpolate", ["linear"], ["zoom"], 10, 1.25, 16, 3];
const CASING_WIDTH: ZoomWidth = ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 6];
const GLOW_WIDTH: ZoomWidth = ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 14];
const ROUND = { "line-cap": "round", "line-join": "round" } as const;

const FILL_MS = 1_600;
const FILL_HOLD_MS = 900;
const FILL_TIMES = 2;
const FILL_FRAME_MS = 50;
const FILL_EDGE = 0.1;

/**
 * maplibre-gl looks for its worker next to its own file, which a Metro bundle does not have. Fetch the worker for
 * the installed version once and hand it over as a same-origin blob.
 */
let worker: Promise<void> | null = null;
const loadWorker = () =>
  (worker ??= fetch(`https://cdn.jsdelivr.net/npm/maplibre-gl@${maplibregl.getVersion()}/dist/maplibre-gl-worker.mjs`)
    .then((r) => r.text())
    .then((code) => maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([code], { type: "text/javascript" })))));

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const line = (coords?: [number, number][]): GeoJSON.FeatureCollection =>
  coords && coords.length > 1 ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] } : EMPTY;

/** Sources and layers, added again whenever the basemap changes (light and dark are different styles). */
function addLayers(map: MapLibre, p: Palette, quietPath: boolean, showCodes: boolean) {
  for (const id of ["path", "approach", "stops", "buses"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY, lineMetrics: id === "approach" });
  const glow = { "line-color": p.ink, "line-width": GLOW_WIDTH, "line-opacity": p.dark ? 0.16 : 0.08, "line-blur": 5 };
  map.addLayer({ id: "path-glow", type: "line", source: "path", layout: ROUND, paint: { ...glow, "line-opacity": quietPath ? 0 : glow["line-opacity"] } });
  map.addLayer({ id: "path-casing", type: "line", source: "path", layout: ROUND, paint: { "line-color": p.background, "line-width": CASING_WIDTH, "line-opacity": quietPath ? 0 : 0.9 } });
  map.addLayer({ id: "path-line", type: "line", source: "path", layout: ROUND, paint: { "line-color": p.ink, "line-width": LINE_WIDTH, "line-opacity": quietPath ? 0.16 : 1 } });
  map.addLayer({ id: "approach-glow", type: "line", source: "approach", layout: ROUND, paint: glow });
  map.addLayer({ id: "approach-casing", type: "line", source: "approach", layout: ROUND, paint: { "line-color": p.background, "line-width": CASING_WIDTH, "line-opacity": 0.9 } });
  map.addLayer({ id: "approach-line", type: "line", source: "approach", layout: ROUND, paint: { "line-color": p.ink, "line-width": LINE_WIDTH } });
  map.addLayer({
    id: "stops-dot",
    type: "circle",
    source: "stops",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["get", "station"], 1.6, 1], 13, ["case", ["get", "station"], 4, 2.5], 17, ["case", ["get", "station"], 9, 6]],
      "circle-color": p.background,
      "circle-stroke-color": p.ink,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["get", "station"], 1.2, 0.8], 13, ["case", ["get", "station"], 3, 2]],
    },
  });
  map.addLayer({
    id: "buses-halo",
    type: "circle",
    source: "buses",
    filter: ["==", ["get", "focus"], 1],
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 16, 26], "circle-color": p.ink, "circle-opacity": p.dark ? 0.2 : 0.1, "circle-blur": 0.5 },
  });
  map.addLayer({
    id: "buses-icon",
    type: "symbol",
    source: "buses",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, ["case", ["==", ["get", "focus"], 1], 0.6, 0.45], 16, ["case", ["==", ["get", "focus"], 1], 1.5, 1.1]],
      "symbol-sort-key": ["get", "focus"],
    },
  });
  if (showCodes)
    map.addLayer({
      id: "buses-code",
      type: "symbol",
      source: "buses",
      minzoom: 13,
      layout: { "text-field": ["get", "code"], "text-font": ["Open Sans Bold"], "text-size": ["case", ["==", ["get", "focus"], 1], 12, 10], "text-offset": [0, 2.2], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": p.text, "text-halo-color": p.background, "text-halo-width": 1.6 },
    });
}

async function addBusImages(map: MapLibre) {
  await Promise.all(
    Object.entries(BUS_IMAGES).map(async ([name, mod]) => {
      if (map.hasImage(name)) return;
      const { data } = await map.loadImage(Asset.fromModule(mod).uri);
      if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio: 2 });
    }),
  );
}

export const TransitMap = forwardRef<MapHandle, TransitMapProps>(function TransitMap(
  { center, zoom = 15, stops = [], buses = [], path, approach, showUser = true, showCodes = false, focusBusId = null, padding, onStopPress },
  ref,
) {
  const p = usePalette();
  const { reduceMotion } = useAccessibility();
  const glide = reduceMotion ? 0 : 700;
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [ready, setReady] = useState(0);
  const [made, setMade] = useState(false);
  const onStop = useRef(onStopPress);
  onStop.current = onStopPress;

  // One map for the life of the component; the style follows the theme.
  useEffect(() => {
    let gone = false;
    let m: MapLibre | null = null;
    void loadWorker().then(() => {
      if (gone || !box.current) return;
      m = create(box.current);
      map.current = m;
      setMade(true);
    });
    return () => {
      gone = true;
      m?.remove();
      map.current = null;
    };
    // The map is created once; later props are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = (container: HTMLDivElement) => {
    const m = new maplibregl.Map({
      container,
      style: p.dark ? STYLES.dark : STYLES.light,
      center: [center.lon, center.lat],
      zoom,
      minZoom: 10,
      maxBounds: BOUNDS,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.on("click", "stops-dot", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onStop.current?.(id);
    });
    m.on("mouseenter", "stops-dot", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "stops-dot", () => (m.getCanvas().style.cursor = ""));
    return m;
  };

  const quietPath = !!approach;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const build = () => {
      addLayers(m, p, quietPath, showCodes);
      void addBusImages(m).then(() => setReady((n) => n + 1));
    };
    m.setStyle(p.dark ? STYLES.dark : STYLES.light);
    m.once("style.load", build);
    return () => {
      m.off("style.load", build);
    };
  }, [p, quietPath, showCodes, made]);

  useEffect(() => {
    if (padding) map.current?.setPadding(padding);
  }, [padding, made]);

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lon, z = 16) => map.current?.flyTo({ center: [lon, lat], zoom: z, duration: glide }),
    fit: (coords) => {
      if (coords.length < 2) return;
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.current?.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: padding ? FIT_MARGIN : FIT_UNDER_SHEET, duration: glide },
      );
    },
  }));

  const set = (id: string, data: GeoJSON.FeatureCollection) => {
    void (map.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  };

  const stopData = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: "FeatureCollection", features: stops.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { id: s.id, station: s.kind === "station" } })) }),
    [stops],
  );
  useEffect(() => set("stops", stopData), [stopData, ready]);
  useEffect(() => set("path", line(path)), [path, ready]);
  useEffect(() => set("approach", line(approach)), [approach, ready]);

  // The way in fills from the bus to the stop twice, then stays, as on the phone.
  useEffect(() => {
    const m = map.current;
    if (!m || !approach || approach.length < 2 || !m.getLayer("approach-line")) return;
    const paint = (at: number | null) => m.setPaintProperty("approach-line", "line-gradient", ["interpolate", ["linear"], ["-", ["line-progress"], at ?? 2], 0, p.ink, FILL_EDGE, p.faint]);
    paint(null);
    if (reduceMotion) return;
    const began = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - began;
      const k = (elapsed % (FILL_MS + FILL_HOLD_MS)) / FILL_MS;
      const done = elapsed >= FILL_TIMES * (FILL_MS + FILL_HOLD_MS);
      paint(k < 1 && !done ? (1 + FILL_EDGE) * (1 - (1 - k) ** 2) - FILL_EDGE : null);
      if (done) clearInterval(timer);
    }, FILL_FRAME_MS);
    return () => clearInterval(timer);
  }, [approach, focusBusId, reduceMotion, ready, p]);

  const fixes = useMemo(() => buses.map((b) => ({ id: b.id, lat: b.lat, lon: b.lon, reportedAt: b.reportedAt, code: b.code, system: b.system, onItsWay: b.id === focusBusId })), [buses, focusBusId]);
  const moving = useMovingBuses(fixes, path, reduceMotion);
  useEffect(
    () =>
      set("buses", {
        type: "FeatureCollection",
        features: moving.map((b) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: b.at },
          properties: { id: b.id, bearing: b.bearing, code: b.code ?? "", icon: `bus-${b.system && BUS_IMAGES_BY_SYSTEM.has(b.system) ? b.system : "other"}`, focus: b.id === focusBusId ? 1 : 0 },
        })),
      }),
    [moving, focusBusId, ready],
  );

  // The rider's own dot, only when the browser already allows location: the app asks for it elsewhere, in its own words.
  useEffect(() => {
    const m = map.current;
    if (!m || !showUser || !navigator.permissions) return;
    const control = new maplibregl.GeolocateControl({ trackUserLocation: true, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: zoom } });
    let added = false;
    void navigator.permissions.query({ name: "geolocation" }).then((status) => {
      if (status.state !== "granted" || !map.current) return;
      m.addControl(control);
      added = true;
      // The app has its own locate button; this control is only here to draw the dot.
      const button = m.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-geolocate")?.closest<HTMLElement>(".maplibregl-ctrl");
      if (button) button.style.display = "none";
      m.once("idle", () => control.trigger());
    });
    return () => {
      if (added) m.removeControl(control);
    };
  }, [showUser, zoom, made]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <div ref={box} style={{ position: "absolute", inset: 0 }} aria-hidden />
      <View pointerEvents="none" style={[styles.credit, { left: (padding?.left ?? 0) + space[3], bottom: (padding?.bottom ?? 0) + space[2] }]}>
        <Text variant="micro" tone="faint">
          {MAP_CREDIT}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  credit: { position: "absolute" },
});
