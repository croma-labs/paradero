import { createContext, useContext } from "react";
import { Text as RNText, StyleSheet, type TextProps as RNTextProps } from "react-native";

import { LANGUAGES, useLanguage } from "@/i18n";
import { useAccessibility } from "@/lib/accessibility";
import { usePalette } from "@/theme/colors";
import { displayFonts, fonts, type, type TypeVariant, type Weight } from "@/theme/tokens";

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  weight?: Weight;
  tone?: "default" | "muted" | "faint" | "inverse";
  color?: string;
  tabular?: boolean;
}

const LARGE: ReadonlySet<TypeVariant> = new Set(["poster", "hero", "heading", "display"]);
const HEADERS: ReadonlySet<TypeVariant> = new Set(["poster", "hero", "heading", "display", "title"]);

/** With the phone's Bold Text on, every weight steps up one, because custom fonts do not do it themselves. */
const BOLDER: Record<Weight, Weight> = { 400: 500, 500: 600, 600: 700, 700: 700 };

/** Spans inside a title are not headers of their own. */
const Nested = createContext(false);

/** One type scale for the whole app, so every screen reads like the same product. */
export function Text({ variant = "body", weight, tone = "default", color, tabular, style, children, ...rest }: TextProps) {
  const p = usePalette();
  const { boldText } = useAccessibility();
  const nested = useContext(Nested);
  const voice = LANGUAGES[useLanguage()].tag;
  const t: { fontSize: number; lineHeight: number; weight: Weight | "mono" | "chrome"; tracking: number; upper?: boolean; display?: boolean } = type[variant];
  const base = weight ?? t.weight;
  const family = typeof base === "number" ? (t.display ? displayFonts : fonts)[boldText ? BOLDER[base] : base] : fonts[base];
  const tint = color ?? (tone === "muted" ? p.muted : tone === "faint" ? p.faint : tone === "inverse" ? p.onInk : p.text);

  return (
    <RNText
      maxFontSizeMultiplier={LARGE.has(variant) ? 1.6 : 2.4}
      accessibilityRole={HEADERS.has(variant) && !nested ? "header" : undefined}
      accessibilityLanguage={voice}
      {...rest}
      style={[
        { fontFamily: family, fontSize: t.fontSize, lineHeight: t.lineHeight, letterSpacing: t.tracking, color: tint, fontVariant: tabular ? ["tabular-nums"] : undefined },
        t.upper && styles.upper,
        style,
      ]}>
      <Nested.Provider value>{children}</Nested.Provider>
    </RNText>
  );
}

const styles = StyleSheet.create({
  upper: { textTransform: "uppercase" },
});
