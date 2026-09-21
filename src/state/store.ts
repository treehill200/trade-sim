import { create } from 'zustand';
import type { Timeframe } from '@/engine/timeframes';
import { parseTimeframe } from '@/engine/timeframes';
import type { ThemeName } from '@/chart/theme';
import { loadLocal, saveLocal } from '@/storage/local';

export type CursorMode = 'cross' | 'dot' | 'arrow';

export interface UiState {
  timeframe: Timeframe;
  theme: ThemeName;
  timeZone: string;
  autoScale: boolean;
  logScale: boolean;
  showVolume: boolean;
  cursorMode: CursorMode;
  setTimeframe: (tf: Timeframe) => void;
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
  theme: saved.theme,
  timeZone: saved.timeZone,
  autoScale: saved.autoScale,
  logScale: saved.logScale,
  showVolume: saved.showVolume,
  cursorMode: saved.cursorMode,
  setTimeframe: (tf) => {
    set({ timeframe: tf });
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
