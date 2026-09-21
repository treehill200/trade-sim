import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface SettingsContext {
  /** Instance id whose settings dialog is open, or null. */
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
}

const Ctx = createContext<SettingsContext>({ openId: null, open: () => {}, close: () => {} });

/**
 * Which indicator's settings dialog is open.
 *
 * The gear button lives in a legend drawn over the canvas while the dialog
 * itself belongs to the app shell, so the two need a shared piece of state
 * that neither of them owns.
 */
export function IndicatorSettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);
  const value = useMemo(() => ({ openId, open, close }), [openId, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIndicatorSettings(): SettingsContext {
  return useContext(Ctx);
}
