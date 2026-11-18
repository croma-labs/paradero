import { StyleSheet, View } from "react-native";

import { useT } from "@/i18n";
import { alertText } from "@/lib/alerts";
import { signal, usePalette } from "@/theme/colors";
import { radius, space } from "@/theme/tokens";
import type { Alert, RouteRef } from "@/transit/types";

import { Dot } from "./dot";
import { Text } from "./text";

/**
 * Alerts name routes by the feed's joined code (`HK635`), which no rider has seen on a bus. The routes on screen know which halves
 * that code stands for (`K635 · H635`). A code none of them knows is shown as the feed wrote it.
 */
function ridersCodes(codes: string[], routes: RouteRef[]): string[] {
  const byFeed = new Map(routes.map((r) => [r.feedCode, r.code]));
  return [...new Set(codes.map((c) => byFeed.get(c) ?? c))];
}

export function AlertCard({ alerts, routes = [] }: { alerts: Alert[]; routes?: RouteRef[] }) {
  const p = usePalette();
  const t = useT();
  if (alerts.length === 0) return null;
  return (
    <View accessibilityRole="alert" style={[styles.card, { backgroundColor: p.surface }]}>
      <View style={styles.head}>
        <Dot color={signal.late} />
        <Text variant="caption" weight={600}>
          {t.alerts.heading(alerts.length)}
        </Text>
      </View>
      {alerts.slice(0, 3).map((a) => {
        const { title, detail } = alertText(a);
        const codes = ridersCodes(a.routes, routes);
        return (
          <View key={a.id} style={styles.item}>
            <Text variant="headline">
              {title}
              {codes.length > 0 ? `  ·  ${codes.slice(0, 3).join(", ")}` : ""}
            </Text>
            <Text variant="callout" tone="muted">
              {detail}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderCurve: "continuous", padding: space[4], gap: space[3] },
  head: { flexDirection: "row", alignItems: "center", gap: space[2] },
  item: { gap: space[0.5] },
});
