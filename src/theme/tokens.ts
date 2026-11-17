/** The 4-point grid. Keys are steps, so space[4] is 16. Every gap, padding and margin comes from here. */
export const space = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

export const radius = { xs: 4, sm: 6, md: 10, lg: 16, xl: 20, sheet: 20, pill: 999 } as const;

/** Fixed dimensions, named by role so the same thing is the same size on every screen. */
export const size = {
  icon: { xs: 12, sm: 16, md: 20, lg: 24 },
  control: { sm: 36, md: 48, lg: 56 },
  tile: { sm: 36, md: 44, lg: 52, xl: 72 },
  glyph: { sm: 16, md: 20, lg: 24, xl: 32 },
  dot: { sm: 6, md: 8 },
  line: { hair: 1, rule: 2, bar: 3 },
} as const;

/** Screen-level measures shared by every layout. */
export const layout = {
  gutter: space[4],
  tabBarClearance: 120,
  sheetOverlap: 28,
  cardWidth: 228,
  readable: 320,
  shadowBleed: space[6],
  screenEnd: 80,
  badgeColumn: 116,
  mapInset: { top: 96, right: space[6], bottom: space[10], left: space[6] },
  sheetMap: 0.38,
  /** Web: the widest a reading column gets (onboarding, forms) and the widest a tab's content gets. */
  column: 560,
  content: 720,
  /** Web: from this width the tabs move to a side rail of `rail` width. */
  wide: 900,
  rail: 240,
} as const;

/** Instrument Sans for everything people read or tap; DM Mono for codes, times and labels. */
export const fonts = {
  400: "InstrumentSans_400Regular",
  500: "InstrumentSans_500Medium",
  600: "InstrumentSans_600SemiBold",
  700: "InstrumentSans_700Bold",
  mono: "DMMono_500Medium",
  chrome: "VictorMono-Bold",
} as const;

/** Familjen Grotesk for titles: the signage voice of a metro map. */
export const displayFonts = {
  400: "FamiljenGrotesk_400Regular",
  500: "FamiljenGrotesk_500Medium",
  600: "FamiljenGrotesk_600SemiBold",
  700: "FamiljenGrotesk_700Bold",
} as const;

export type Weight = 400 | 500 | 600 | 700;

interface Style {
  fontSize: number;
  lineHeight: number;
  weight: Weight | "mono" | "chrome";
  tracking: number;
  upper?: boolean;
  /** Set in Familjen Grotesk instead of Instrument Sans. */
  display?: boolean;
}

/**
 * Trazo's voice: solid Familjen Grotesk titles like station signs, Instrument Sans to read,
 * DM Mono in wide capitals for labels, Victor Mono for Croma's frame (corners, footers, the web address).
 */
export const type = {
  poster: { fontSize: 44, lineHeight: 46, weight: 700, tracking: -1.3, display: true },
  hero: { fontSize: 56, lineHeight: 58, weight: 700, tracking: -1.7, display: true },
  heading: { fontSize: 34, lineHeight: 36, weight: 700, tracking: -1, display: true },
  display: { fontSize: 30, lineHeight: 32, weight: 700, tracking: -0.9, display: true },
  title: { fontSize: 21, lineHeight: 26, weight: 600, tracking: -0.4, display: true },
  headline: { fontSize: 16, lineHeight: 21, weight: 500, tracking: -0.3 },
  body: { fontSize: 16, lineHeight: 23, weight: 400, tracking: -0.2 },
  callout: { fontSize: 15, lineHeight: 21, weight: 400, tracking: -0.15 },
  caption: { fontSize: 13, lineHeight: 17, weight: 500, tracking: -0.05 },
  micro: { fontSize: 10, lineHeight: 13, weight: 500, tracking: 0 },
  eyebrow: { fontSize: 11, lineHeight: 15, weight: "mono", tracking: 1.8, upper: true },
  chrome: { fontSize: 11, lineHeight: 15, weight: "chrome", tracking: 2.6, upper: true },
} as const satisfies Record<string, Style>;

export type TypeVariant = keyof typeof type;
