import { create } from 'zustand';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface Notice {
  id: string;
  tone: NoticeTone;
  title: string;
  body?: string;
  createdAt: number;
}

interface NoticesState {
  notices: Notice[];
  push: (notice: Omit<Notice, 'id' | 'createdAt'>) => void;
  dismiss: (id: string) => void;
}

/** How many notices stay on screen at once; older ones drop off the top. */
const MAX_VISIBLE = 4;

let counter = 0;

export const useNotices = create<NoticesState>((set, get) => ({
  notices: [],
  push: (notice) => {
    counter += 1;
    const full: Notice = { ...notice, id: `n${counter}`, createdAt: Date.now() };
    set({ notices: [...get().notices, full].slice(-MAX_VISIBLE) });
  },
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
}));

/** Convenience for code outside React. */
export function notify(notice: Omit<Notice, 'id' | 'createdAt'>): void {
  useNotices.getState().push(notice);
}
