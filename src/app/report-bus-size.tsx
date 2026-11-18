import { useMutation } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
import { PressableScale } from "pressto";
import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";

import { Button } from "@/components/button";
import { Chip } from "@/components/chip";
import { Icon, icons } from "@/components/icon";
import { Text } from "@/components/text";
import { useT, type Messages } from "@/i18n";
import { announce } from "@/lib/accessibility";
import { ApiError } from "@/lib/api";
import { markSizeReported, sendVehicleSizeReport, useSizeReported } from "@/lib/vehicle-size-reports";
import { usePalette } from "@/theme/colors";
import { layout, radius, size, space } from "@/theme/tokens";
import { normalizeVehiclePlate, type VehicleSizeReportInput } from "@/transit/vehicle-size-report";

function failureText(error: unknown, messages: Messages["vehicleSizeReport"]): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return messages.known;
    if (error.status === 429) return messages.tooMany;
    if (error.status === 503) return messages.unavailable;
  }
  return messages.failed;
}

export default function ReportBusSize() {
  const t = useT();
  const p = usePalette();
  const params = useLocalSearchParams<{ plate?: string | string[] }>();
  const plate = normalizeVehiclePlate(typeof params.plate === "string" ? params.plate : null);

  useEffect(() => {
    if (!plate) announce(t.vehicleSizeReport.invalidPlate);
  }, [plate, t.vehicleSizeReport.invalidPlate]);

  if (!plate) {
    return (
      <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={styles.content}>
        <Text variant="title">{t.vehicleSizeReport.title}</Text>
        <Text variant="callout" tone="muted" accessibilityRole="alert">{t.vehicleSizeReport.invalidPlate}</Text>
        <Button label={t.common.close} onPress={() => router.back()} />
      </ScrollView>
    );
  }

  // A different plate always starts with no answer and no confirmation.
  return <VehicleSizeForm key={plate} plate={plate} />;
}

function VehicleSizeForm({ plate }: { plate: string }) {
  const t = useT();
  const p = usePalette();
  const messages = t.vehicleSizeReport;
  const reported = useSizeReported(plate);
  const [answer, setAnswer] = useState<VehicleSizeReportInput["size"] | null>(null);
  const [observed, setObserved] = useState(false);
  const submitting = useRef(false);
  const send = useMutation({
    mutationFn: sendVehicleSizeReport,
    retry: false,
    onSuccess: (_result, input) => {
      markSizeReported(input.plate);
      announce(`${messages.thanks}. ${messages.pending}`);
    },
    onError: (error) => announce(failureText(error, messages)),
    onSettled: () => { submitting.current = false; },
  });

  const known = send.error instanceof ApiError && send.error.status === 409;
  const submit = () => {
    if (!answer || !observed || reported || known || submitting.current || send.isPending) return;
    submitting.current = true;
    announce(messages.sending);
    send.mutate({
      plate,
      size: answer,
      observed: true,
      app: { version: Constants.expoConfig?.version ?? "0", platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web" },
    });
  };

  if (send.data || reported) {
    return (
      <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={styles.content}>
        <Text variant="heading">{messages.thanks}</Text>
        <Text variant="headline">{messages.plate(plate)}</Text>
        <Text variant="callout" tone="muted">{messages.pending}</Text>
        <Button label={t.common.done} onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title">{messages.title}</Text>
        <Button variant="quiet" height="md" label={messages.cancel} disabled={send.isPending} onPress={() => router.back()} />
      </View>

      <View style={[styles.plate, { backgroundColor: p.surface, borderColor: p.border }]}>
        <Text variant="title">{messages.plate(plate)}</Text>
        <Text variant="callout" tone="muted">{messages.help}</Text>
      </View>

      {send.isPending ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={messages.sending} accessibilityState={{ busy: true }}>
          <Text variant="callout" tone="muted">{messages.sending}</Text>
        </View>
      ) : (
        <>
          <Text variant="headline">{messages.question}</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={messages.question} style={styles.choices}>
            {(["large", "small"] as const).map((value) => (
              <Chip key={value} radio label={t.vehicleSize[value]} selected={answer === value} onPress={() => { if (!submitting.current) setAnswer(value); }} />
            ))}
          </View>

          <PressableScale
            accessible
            accessibilityRole="checkbox"
            accessibilityLabel={messages.confirm}
            accessibilityState={{ checked: observed }}
            onPress={() => { if (!submitting.current) setObserved((value) => !value); }}
            style={styles.confirm}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.checkbox, { borderColor: p.border, backgroundColor: observed ? p.ink : p.surface }]}>
              {observed && <Icon name={icons.check} color={p.onInk} size="sm" />}
            </View>
            <Text variant="callout" style={styles.grow}>{messages.confirm}</Text>
          </PressableScale>
        </>
      )}

      <Text variant="caption" tone="muted">{messages.public}</Text>

      {send.error && (
        <Text variant="callout" tone="muted" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {failureText(send.error, messages)}
        </Text>
      )}

      <Button
        label={send.isPending ? messages.sending : messages.send}
        accessibilityHint={!answer || !observed ? messages.sendHint : undefined}
        disabled={!answer || !observed || send.isPending || known}
        onPress={submit}
      />
      <Button variant="quiet" height="md" label={messages.dontKnow} disabled={send.isPending} onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: layout.gutter, paddingTop: space[6], paddingBottom: layout.screenEnd, gap: space[5] },
  header: { gap: space[2], alignItems: "flex-start" },
  plate: { padding: space[4], gap: space[2], borderRadius: radius.lg, borderCurve: "continuous", borderWidth: size.line.hair },
  choices: { gap: space[3] },
  confirm: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.control.md, paddingVertical: space[3] },
  checkbox: { width: size.icon.lg, height: size.icon.lg, borderWidth: size.line.hair, borderRadius: radius.xs, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1 },
});
