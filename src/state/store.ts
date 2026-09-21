import { create } from 'zustand';
import type { Timeframe } from '@/engine/timeframes';
import { parseTimeframe } from '@/engine/timeframes';
import type { ThemeName } from '@/chart/theme';
import { parseChartType, type ChartType } from '@/chart/chartTypes';
import { loadLocal, saveLocal } from '@/storage/local';
import { indicatorDef } from '@/indicators/defs';
import {
  defaultColors,
  defaultParams,
  defaultWidths,
  type IndicatorInstance,
} from '@/indicators/types';

export type CursorMode = 'cross' | 'dot' | 'arrow';

export type DateRange = '1D' | '5D' | '1M' | 'All';

export interface UiState {
  timeframe: Timeframe;
  chartType: ChartType;
  theme: ThemeName;
  timeZone: string;
  autoScale: boolean;
  logScale: boolean;
  showVolume: boolean;
  cursorMode: CursorMode;
  /** Date-range shortcut currently in effect, cleared as soon as you zoom. */
  activeRange: DateRange | null;
  /** Configured indicators, in the order they were added. */
  indicators: IndicatorInstance[];
  /** Height of each indicator pane as a fraction of the plot area. */
  paneRatios: Record<string, number>;
  addIndicator: (defId: string) => void;
  removeIndicator: (id: string) => void;
  updateIndicator: (id: string, patch: Partial<IndicatorInstance>) => void;
  toggleIndicator: (id: string) => void;
  setPaneRatios: (ratios: Record<string, number>) => void;
  setTimeframe: (tf: Timeframe) => void;
  setActiveRange: (r: DateRange | null) => void;
  setChartType: (t: ChartType) => void;
  setTheme: (t: ThemeName) => void;
  setTimeZone: (tz: string) => void;
  toggleAutoScale: () => void;
  toggleLogScale: () => void;
  toggleVolume: () => void;
  setCursorMode: (m: CursorMode) => void;
}

const LS_KEY = 'ui';

interface PersistedUi {
  timeframe: string;
  indicators: IndicatorInstance[];
  paneRatios: Record<string, number>;
  chartType: string;
  theme: ThemeName;
  timeZone: string;
  autoScale: boolean;
  logScale: boolean;
  showVolume: boolean;
  cursorMode: CursorMode;
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const defaults: PersistedUi = {
  timeframe: '1m',
  indicators: [],
  paneRatios: {},
  chartType: 'candles',
  theme: 'dark',
  timeZone: localTimeZone(),
  autoScale: true,
  logScale: false,
  showVolume: true,
  cursorMode: 'cross',
};

const saved = { ...defaults, ...loadLocal<Partial<PersistedUi>>(LS_KEY, {}) };

/**
 * Drop saved indicators that no longer exist and fill in anything missing.
 *
 * Saved layouts outlive code changes: an indicator can be renamed or removed,
 * or gain a new setting, and a half-built instance would otherwise crash the
 * chart on load.
 */
function sanitiseIndicators(list: unknown): IndicatorInstance[] {
  if (!Array.isArray(list)) return [];
  const out: IndicatorInstance[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Partial<IndicatorInstance>;
    const def = typeof item.defId === 'string' ? indicatorDef(item.defId) : undefined;
    if (!def || typeof item.id !== 'string') continue;
    out.push({
      id: item.id,
      defId: def.id,
      params: { ...defaultParams(def), ...(item.params ?? {}) },
      colors: { ...defaultColors(def), ...(item.colors ?? {}) },
      widths: { ...defaultWidths(def), ...(item.widths ?? {}) },
      visible: item.visible !== false,
    });
  }
  return out;
}

function persist(state: UiState): void {
  saveLocal(LS_KEY, {
    timeframe: state.timeframe,
    indicators: state.indicators,
    paneRatios: state.paneRatios,
    chartType: state.chartType,
    theme: state.theme,
    timeZone: state.timeZone,
    autoScale: state.autoScale,
    logScale: state.logScale,
    showVolume: state.showVolume,
    cursorMode: state.cursorMode,
  } satisfies PersistedUi);
}

export const useUi = create<UiState>((set, get) => ({
  timeframe: parseTimeframe(saved.timeframe) ?? '1m',
  chartType: parseChartType(saved.chartType) ?? 'candles',
  theme: saved.theme,
  timeZone: saved.timeZone,
  autoScale: saved.autoScale,
  logScale: saved.logScale,
  showVolume: saved.showVolume,
  cursorMode: saved.cursorMode,
  activeRange: null,
  indicators: sanitiseIndicators(saved.indicators),
  paneRatios: saved.paneRatios ?? {},
  addIndicator: (defId) => {
    const def = indicatorDef(defId);
    if (!def) return;
    const instance: IndicatorInstance = {
      id: `${defId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      defId,
      params: defaultParams(def),
      colors: defaultColors(def),
      widths: defaultWidths(def),
      visible: true,
    };
    set({ indicators: [...get().indicators, instance] });
    persist(get());
  },
  removeIndicator: (id) => {
    const paneRatios = { ...get().paneRatios };
    delete paneRatios[id];
    set({ indicators: get().indicators.filter((i) => i.id !== id), paneRatios });
    persist(get());
  },
  updateIndicator: (id, patch) => {
    set({ indicators: get().indicators.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
    persist(get());
  },
  toggleIndicator: (id) => {
    set({
      indicators: get().indicators.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
    });
    persist(get());
  },
  setPaneRatios: (paneRatios) => {
    set({ paneRatios });
    persist(get());
  },
  setActiveRange: (activeRange) => {
    if (get().activeRange !== activeRange) set({ activeRange });
  },
  setTimeframe: (tf) => {
    set({ timeframe: tf });
    persist(get());
  },
  setChartType: (chartType) => {
    set({ chartType });
    persist(get());
  },
  setTheme: (theme) => {
    set({ theme });
    persist(get());
  },
  setTimeZone: (timeZone) => {
    set({ timeZone });
    persist(get());
  },
  toggleAutoScale: () => {
    set({ autoScale: !get().autoScale });
    persist(get());
  },
  toggleLogScale: () => {
    set({ logScale: !get().logScale });
    persist(get());
  },
  toggleVolume: () => {
    set({ showVolume: !get().showVolume });
    persist(get());
  },
  setCursorMode: (cursorMode) => {
    set({ cursorMode });
    persist(get());
  },
}));
