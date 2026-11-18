import BottomSheet, { BottomSheetHandle, BottomSheetScrollView, type BottomSheetHandleProps } from "@gorhom/bottom-sheet";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "@/theme/colors";
import { layout, radius, size, space } from "@/theme/tokens";

const SNAPS = ["30%", "58%", "92%"];

/** Map full-bleed behind, a draggable sheet of details over it — the same frame as the home tab, so dragging to see more map works everywhere. */
export function DetailScreen({ map, children }: { map: ReactNode; children: ReactNode }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: p.background }]}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        {map}
      </View>
      <BottomSheet
        accessible={false}
        index={1}
        snapPoints={SNAPS}
        enableDynamicSizing={false}
        topInset={insets.top}
        backgroundStyle={{ backgroundColor: p.background, borderRadius: radius.sheet, boxShadow: p.shadowUp, borderWidth: size.line.hair, borderColor: p.border }}
        handleIndicatorStyle={{ backgroundColor: p.fillStrong, width: size.control.sm }}
        handleComponent={QuietHandle}>
        <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + layout.tabBarClearance }]} showsVerticalScrollIndicator={false}>
          {children}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

/** The grabber is for fingers. Screen readers scroll the sheet's list directly, so the handle stays out of their way. */
function QuietHandle(props: BottomSheetHandleProps) {
  return <BottomSheetHandle {...props} accessible={false} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: layout.gutter, paddingTop: space[6], gap: space[5] },
});
