import { create } from 'zustand';
import type { Timeframe } from '@/engine/timeframes';
import { parseTimeframe } from '@/engine/timeframes';
import type { ThemeName } from '@/chart/theme';
import { parseChartType, type ChartType } from '@/chart/chartTypes';
import { loadLocal, saveLocal } from '@/storage/local';

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
  chartType: 'candles',
  theme: 'dark',
  timeZone: localTimeZone(),
  autoScale: true,
  logScale: false,
  showVolume: true,
  cursorMode: 'cross',
};

const saved = { ...defaults, ...loadLocal<Partial<PersistedUi>>(LS_KEY, {}) };

function persist(state: UiState): void {
  saveLocal(LS_KEY, {
    timeframe: state.timeframe,
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
