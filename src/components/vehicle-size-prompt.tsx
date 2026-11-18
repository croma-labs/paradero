import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useT } from "@/i18n";
import { useSizeReported } from "@/lib/vehicle-size-reports";
import { space } from "@/theme/tokens";
import type { Arrival, Feed } from "@/transit/types";
import { canReportVehicleSize, normalizeVehiclePlate } from "@/transit/vehicle-size-report";

import { Button } from "./button";
import { Text } from "./text";

/** A separate action beside an arrival, never a button nested inside the bus row. */
export function VehicleSizePrompt({ arrival, feed }: { arrival: Arrival; feed: Feed }) {
  const t = useT();
  const plate = normalizeVehiclePlate(arrival.plate);
  const reported = useSizeReported(plate);
  const [, tick] = useState(0);
  const eligible = !reported && canReportVehicleSize(arrival, feed);

  useEffect(() => {
    if (!eligible) return;
    const timer = setInterval(() => tick((value) => value + 1), 5_000);
    return () => clearInterval(timer);
  }, [eligible]);

  if (!plate || !eligible) return null;

  return (
    <View style={styles.prompt}>
      <Text variant="caption" tone="muted">{t.vehicleSizeReport.unknown}</Text>
      <Text variant="caption" tone="muted">{t.vehicleSizeReport.plate(plate)}</Text>
      <Button
        variant="quiet"
        height="md"
        label={t.vehicleSizeReport.invite}
        accessibilityHint={t.vehicleSizeReport.plate(plate)}
        onPress={() => {
          if (canReportVehicleSize(arrival, feed)) router.push({ pathname: "/report-bus-size", params: { plate } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: { gap: space[2], paddingVertical: space[3] },
});
