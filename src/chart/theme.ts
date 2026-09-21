export type ThemeName = 'dark' | 'light';

export interface ChartTheme {
  name: ThemeName;
  background: string;
  panelBackground: string;
  grid: string;
  gridStrong: string;
  border: string;
  text: string;
  textMuted: string;
  axisText: string;
  up: string;
  down: string;
  upFill: string;
  downFill: string;
  upWick: string;
  downWick: string;
  volumeUp: string;
  volumeDown: string;
  /** Used for the volume silhouette when bars are thinner than a pixel. */
  volumeNeutral: string;
  crosshair: string;
  crosshairLabelBg: string;
  crosshairLabelText: string;
  lastPriceLine: string;
  lastPriceGlow: string;
  accent: string;
}

export const DARK_THEME: ChartTheme = {
  name: 'dark',
  background: '#0e1017',
  panelBackground: '#131722',
  grid: 'rgba(120, 130, 155, 0.10)',
  gridStrong: 'rgba(120, 130, 155, 0.18)',
  border: 'rgba(120, 130, 155, 0.22)',
  text: '#d5d9e3',
  textMuted: '#787b86',
  axisText: '#9aa0ad',
  up: '#26a96c',
  down: '#e2445c',
  upFill: '#26a96c',
  downFill: '#e2445c',
  upWick: '#26a96c',
  downWick: '#e2445c',
  volumeUp: 'rgba(38, 169, 108, 0.42)',
  volumeDown: 'rgba(226, 68, 92, 0.42)',
  volumeNeutral: 'rgba(120, 140, 175, 0.38)',
  crosshair: 'rgba(155, 163, 180, 0.65)',
  crosshairLabelBg: '#2a2e39',
  crosshairLabelText: '#e6e9ef',
  lastPriceLine: '#b0b6c3',
  lastPriceGlow: 'rgba(120, 190, 255, 0.35)',
  accent: '#3b82f6',
};

export const LIGHT_THEME: ChartTheme = {
  name: 'light',
  background: '#ffffff',
  panelBackground: '#f6f7f9',
  grid: 'rgba(60, 70, 90, 0.08)',
  gridStrong: 'rgba(60, 70, 90, 0.16)',
  border: 'rgba(60, 70, 90, 0.18)',
  text: '#1c1f26',
  textMuted: '#6b7280',
  axisText: '#4b5563',
  up: '#0f9960',
  down: '#d1384f',
  upFill: '#0f9960',
  downFill: '#d1384f',
  upWick: '#0f9960',
  downWick: '#d1384f',
  volumeUp: 'rgba(15, 153, 96, 0.35)',
  volumeDown: 'rgba(209, 56, 79, 0.35)',
  volumeNeutral: 'rgba(90, 105, 130, 0.32)',
  crosshair: 'rgba(60, 70, 90, 0.55)',
  crosshairLabelBg: '#3c4250',
  crosshairLabelText: '#ffffff',
  lastPriceLine: '#4b5563',
  lastPriceGlow: 'rgba(59, 130, 246, 0.25)',
  accent: '#2563eb',
};

export function themeByName(name: ThemeName): ChartTheme {
  return name === 'light' ? LIGHT_THEME : DARK_THEME;
}
