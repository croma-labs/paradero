import type { System } from "@/transit/types";

/**
 * Every colour in the app, as plain data. `scripts/check-contrast.ts` measures these pairs against
 * WCAG 2.2 AA on every check, so a colour that would fail someone with low vision cannot ship.
 */
export interface Palette {
  background: string;
  surface: string;
  elevated: string;
  fill: string;
  fillStrong: string;
  text: string;
  muted: string;
  faint: string;
  separator: string;
  border: string;
  ink: string;
  onInk: string;
  shadow: string;
  shadowSoft: string;
  shadowUp: string;
}

/** Signal colours, used only as small dots, never as fills. */
export const signal = {
  live: "#34C759",
  late: "#F2A33D",
  alert: "#E5484D",
};

/** Trazo light: map paper, ink lines, warm greys. Colour on screen is kept for the network. */
export const LIGHT: Palette = {
  background: "#F0ECE2",
  surface: "#E4DFD2",
  elevated: "#FFFDF8",
  fill: "rgba(31,31,35,0.05)",
  fillStrong: "rgba(31,31,35,0.10)",
  text: "#1F1F23",
  muted: "#3E3D39",
  faint: "#5E5C55",
  separator: "#DAD4C6",
  border: "#CFC8B8",
  ink: "#1F1F23",
  onInk: "#F7F5EF",
  shadow: "0 16px 32px -12px rgba(31,31,35,0.14)",
  shadowSoft: "0 2px 8px -2px rgba(31,31,35,0.08)",
  shadowUp: "0 -1px 2px rgba(31,31,35,0.05), 0 -14px 36px -14px rgba(31,31,35,0.20)",
};

/** Trazo night: the same map after dark. Paper and ink swap; line colours stay. */
export const DARK: Palette = {
  background: "#16171B",
  surface: "#1F2026",
  elevated: "#1B1C21",
  fill: "rgba(240,236,226,0.05)",
  fillStrong: "rgba(240,236,226,0.10)",
  text: "#F0ECE2",
  muted: "#CFC8B8",
  faint: "#A3A094",
  separator: "#2A2C33",
  border: "#3A3C45",
  ink: "#F0ECE2",
  onInk: "#16171B",
  shadow: "0 1px 2px rgba(0,0,0,0.6)",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.5)",
  shadowUp: "inset 0 1px 0 rgba(255,255,255,0.07), 0 -14px 36px -12px rgba(0,0,0,0.85)",
};

/** High contrast, light: pure black on white, no fades, borders you can see. */
export const HIGH_LIGHT: Palette = {
  background: "#FFFFFF",
  surface: "#F0F0F0",
  elevated: "#FFFFFF",
  fill: "rgba(0,0,0,0.08)",
  fillStrong: "rgba(0,0,0,0.16)",
  text: "#000000",
  muted: "#1F1F1F",
  faint: "#3D3D3D",
  separator: "#5C5C5C",
  border: "#000000",
  ink: "#000000",
  onInk: "#FFFFFF",
  shadow: "0 0 0 rgba(0,0,0,0)",
  shadowSoft: "0 0 0 rgba(0,0,0,0)",
  shadowUp: "0 0 0 rgba(0,0,0,0)",
};

/** High contrast, dark: pure white on black, no fades, borders you can see. */
export const HIGH_DARK: Palette = {
  background: "#000000",
  surface: "#141414",
  elevated: "#000000",
  fill: "rgba(255,255,255,0.12)",
  fillStrong: "rgba(255,255,255,0.22)",
  text: "#FFFFFF",
  muted: "#E6E6E6",
  faint: "#C7C7C7",
  separator: "#8F8F8F",
  border: "#FFFFFF",
  ink: "#FFFFFF",
  onInk: "#000000",
  shadow: "0 0 0 rgba(0,0,0,0)",
  shadowSoft: "0 0 0 rgba(0,0,0,0)",
  shadowUp: "0 0 0 rgba(0,0,0,0)",
};

/** Over photography the theme does not apply: the image sets the contrast. */
export const photo = {
  text: "#FFFFFF",
  track: "rgba(255,255,255,0.35)",
  cut: "rgba(0,0,0,0.35)",
  scrim: "#000000",
} as const;

/**
 * Each part of the network is a line on the map. `dot` is the bright line colour for marks and the map;
 * `fill` is the deep tone a route badge sits on, dark enough for `lineText` to pass AA.
 */
export const systems: Record<System, { label: string; dot: string; fill: string }> = {
  troncal: { label: "TransMilenio", dot: "#E2403A", fill: "#B42A25" },
  dual: { label: "Dual", dot: "#F2892B", fill: "#A3500F" },
  zonal_urbano: { label: "SITP zonal", dot: "#2F6BD6", fill: "#1F4FA8" },
  alimentador: { label: "Alimentador", dot: "#3FA45B", fill: "#2A7A41" },
  zonal_complementario: { label: "Complementario", dot: "#F2C230", fill: "#7A5A00" },
  zonal_especial: { label: "Especial", dot: "#7B52C1", fill: "#5E3A9E" },
  transmicable: { label: "TransMiCable", dot: "#1D9C9C", fill: "#12706F" },
  other: { label: "Otro", dot: "#8A8778", fill: "#5E5C55" },
};

/** Text and marks on a route badge's line colour, the same in every theme. */
export const lineText = "#FFFDF8";
