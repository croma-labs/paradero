import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from "expo-router/ui";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StopSignGlyph, TabGlyph } from "@/components/glyphs";
import { ParaderoMark } from "@/components/paradero-mark";
import { Text } from "@/components/text";
import { useT } from "@/i18n";
import { usePalette } from "@/theme/colors";
import { layout, radius, size, space } from "@/theme/tokens";

type Glyph = "nearby" | "saved" | "about" | "search";

/**
 * Native tabs have no web version, so on the web the tabs are drawn here: a bottom bar on narrow screens and,
 * from `layout.wide`, a side rail with labels always visible. Tab content stays in a readable centred column.
 */
export default function TabsLayout() {
  const p = usePalette();
  const t = useT();
  const insets = useSafeAreaInsets();
  const rail = useWindowDimensions().width >= layout.wide;

  const tabs: { name: string; href: "/" | "/saved" | "/about" | "/search"; label: string; icon: Glyph }[] = [
    { name: "(home)", href: "/", label: t.tabs.nearby, icon: "nearby" },
    { name: "(saved)", href: "/saved", label: t.tabs.saved, icon: "saved" },
    { name: "(about)", href: "/about", label: t.tabs.about, icon: "about" },
    { name: "(search)", href: "/search", label: t.tabs.search, icon: "search" },
  ];

  // Tabs only registers triggers from a TabList that is its direct child, so the TabList is the rail itself.
  const list = (
    <TabList
      style={
        rail
          ? [styles.rail, { backgroundColor: p.elevated, borderRightColor: p.separator }]
          : [styles.bar, { backgroundColor: p.elevated, borderTopColor: p.separator, paddingBottom: insets.bottom }]
      }>
      {rail && (
        <View style={styles.brand}>
          <ParaderoMark size={size.icon.lg} color={p.text} ring={p.fillStrong} />
          <Text variant="title">Paradero</Text>
        </View>
      )}
      {tabs.map((tab) => (
        <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
          <Item label={tab.label} icon={tab.icon} rail={rail} />
        </TabTrigger>
      ))}
    </TabList>
  );

  return (
    <Tabs style={[styles.root, { backgroundColor: p.background, flexDirection: rail ? "row" : "column" }]}>
      {rail && list}
      <View style={styles.main}>
        <View style={styles.column}>
          <TabSlot />
        </View>
      </View>
      {!rail && list}
    </Tabs>
  );
}

function Item({ label, icon, rail, isFocused, ref: _ref, ...props }: TabTriggerSlotProps & { label: string; icon: Glyph; rail: boolean }) {
  const p = usePalette();
  const onInk = rail && isFocused;
  const tint = onInk ? p.onInk : isFocused ? p.text : p.faint;
  const side = size.icon.md;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      // TabTrigger's slot merges style as an object, so an array would be dropped.
      style={StyleSheet.flatten([rail ? styles.railItem : styles.barItem, onInk && { backgroundColor: p.ink }])}>
      {!rail && <View style={[styles.indicator, isFocused && { backgroundColor: p.ink }]} />}
      {icon === "nearby" ? (
        <StopSignGlyph size={side} color={tint} cut={onInk ? p.ink : p.elevated} />
      ) : (
        <TabGlyph name={icon} size={side} color={tint} filled={isFocused} />
      )}
      <Text variant={rail ? "headline" : "caption"} weight={isFocused ? 700 : 500} color={tint}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  main: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: layout.content, alignSelf: "center" },
  rail: { flexDirection: "column", justifyContent: "flex-start", width: layout.rail, borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: space[4], paddingVertical: space[6], gap: space[1] },
  brand: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], marginBottom: space[8] },
  railItem: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.control.lg, paddingHorizontal: space[4], borderRadius: radius.md, borderCurve: "continuous" },
  bar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  barItem: { flex: 1, alignItems: "center", gap: space[1], paddingBottom: space[2], minHeight: size.control.lg },
  indicator: { width: space[8], height: size.line.bar, borderBottomLeftRadius: radius.xs, borderBottomRightRadius: radius.xs, marginBottom: space[1] },
});
