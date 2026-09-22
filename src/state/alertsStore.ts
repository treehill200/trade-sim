import { create } from 'zustand';
import { loadLocal, saveLocal } from '@/storage/local';
import type { Cents } from '@/trading/money';

const LS_KEY = 'alerts';

export type AlertDirection = 'above' | 'below';

export interface PriceAlert {
  id: string;
  priceCents: Cents;
  /** Which way the price has to cross to fire it. */
  direction: AlertDirection;
  /** A disarmed alert stays in the list but does not fire. */
  armed: boolean;
  /** When it last fired, if it has. */
  triggeredAt?: number;
  createdAt: number;
}

interface Persisted {
  alerts: PriceAlert[];
  sound: boolean;
  fillSound: boolean;
  announceFills: boolean;
}

export interface AlertsState {
  alerts: PriceAlert[];
  /** Whether a triggered alert also plays a tone. */
  sound: boolean;
  /** Whether a fill plays a short tone. */
  fillSound: boolean;
  /** Whether a fill is also announced out loud. */
  announceFills: boolean;
  add: (priceCents: Cents, direction: AlertDirection) => void;
  remove: (id: string) => void;
  rearm: (id: string) => void;
  setPrice: (id: string, priceCents: Cents) => void;
  toggleSound: () => void;
  toggleFillSound: () => void;
  toggleAnnounceFills: () => void;
  clearTriggered: () => void;
  /**
   * Fire any alert the price crossed, and return them.
   *
   * Takes the range covered since the previous tick so a fast move cannot slip
   * past an alert between two samples.
   */
  check: (lowCents: Cents, highCents: Cents, at: number) => PriceAlert[];
}

let counter = 0;

const defaults: Persisted = { alerts: [], sound: true, fillSound: true, announceFills: false };

function sanitise(raw: unknown): Persisted {
  if (typeof raw !== 'object' || raw === null) return defaults;
  const data = raw as Partial<Persisted>;
  const alerts: PriceAlert[] = [];
  if (Array.isArray(data.alerts)) {
    for (const item of data.alerts) {
      if (typeof item !== 'object' || item === null) continue;
      const a = item as Partial<PriceAlert>;
      if (typeof a.id !== 'string' || !Number.isFinite(a.priceCents)) continue;
      if (a.direction !== 'above' && a.direction !== 'below') continue;
      alerts.push({
        id: a.id,
        priceCents: a.priceCents as number,
        direction: a.direction,
        armed: a.armed !== false,
        ...(Number.isFinite(a.triggeredAt) ? { triggeredAt: a.triggeredAt as number } : {}),
        createdAt: Number.isFinite(a.createdAt) ? (a.createdAt as number) : Date.now(),
      });
    }
  }
  return {
    alerts,
    sound: data.sound !== false,
    fillSound: data.fillSound !== false,
    announceFills: data.announceFills === true,
  };
}

const initial = sanitise(loadLocal<unknown>(LS_KEY, null));

export const useAlerts = create<AlertsState>((set, get) => {
  const persist = (): void => {
    const s = get();
    saveLocal(LS_KEY, {
      alerts: s.alerts,
      sound: s.sound,
      fillSound: s.fillSound,
      announceFills: s.announceFills,
    } satisfies Persisted);
  };

  return {
    alerts: initial.alerts,
    sound: initial.sound,
    fillSound: initial.fillSound,
    announceFills: initial.announceFills,

    add: (priceCents, direction) => {
      counter += 1;
      const alert: PriceAlert = {
        id: `al-${Date.now().toString(36)}-${counter.toString(36)}`,
        priceCents: Math.round(priceCents),
        direction,
        armed: true,
        createdAt: Date.now(),
      };
      set({ alerts: [...get().alerts, alert] });
      persist();
    },

    remove: (id) => {
      set({ alerts: get().alerts.filter((a) => a.id !== id) });
      persist();
    },

    rearm: (id) => {
      set({
        alerts: get().alerts.map((a) => {
          if (a.id !== id) return a;
          // Drop the trigger time rather than setting it to undefined, so the
          // shape stays exactly a PriceAlert.
          const { triggeredAt: _ignored, ...rest } = a;
          return { ...rest, armed: true };
        }),
      });
      persist();
    },

    setPrice: (id, priceCents) => {
      if (!Number.isFinite(priceCents) || priceCents <= 0) return;
      set({
        alerts: get().alerts.map((a) =>
          a.id === id ? { ...a, priceCents: Math.round(priceCents) } : a,
        ),
      });
      persist();
    },

    toggleSound: () => {
      set({ sound: !get().sound });
      persist();
    },

    toggleFillSound: () => {
      set({ fillSound: !get().fillSound });
      persist();
    },

    toggleAnnounceFills: () => {
      set({ announceFills: !get().announceFills });
      persist();
    },

    clearTriggered: () => {
      set({ alerts: get().alerts.filter((a) => a.armed) });
      persist();
    },

    check: (lowCents, highCents, at) => {
      const fired: PriceAlert[] = [];
      const next = get().alerts.map((alert) => {
        if (!alert.armed) return alert;
        const crossed =
          alert.direction === 'above'
            ? highCents >= alert.priceCents
            : lowCents <= alert.priceCents;
        if (!crossed) return alert;
        fired.push(alert);
        // One-shot: it stays in the list, disarmed, until re-armed.
        return { ...alert, armed: false, triggeredAt: at };
      });
      if (fired.length > 0) {
        set({ alerts: next });
        persist();
      }
      return fired;
    },
  };
});

/**
 * A short two-tone chime, synthesised rather than loaded.
 *
 * Shipping an audio file for one beep is not worth the request, and the Web
 * Audio API is blocked until the user has interacted with the page — so every
 * call is wrapped and a failure is simply silence.
 */
export function playAlertTone(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    gain.connect(ctx.destination);

    [880, 1174.66].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.22);
    });
    // Release the context once the sound has finished.
    setTimeout(() => void ctx.close().catch(() => undefined), 800);
  } catch {
    /* audio unavailable or blocked; the toast is still shown */
  }
}

/**
 * A short click, played when an order fills.
 *
 * Deliberately different from the alert chime: lower, shorter, and only one
 * note, so the two are never confused when both happen at once.
 */
export function playFillTone(up: boolean): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    // A rising note for a buy and a falling one for a sell.
    osc.frequency.setValueAtTime(up ? 520 : 660, now);
    osc.frequency.linearRampToValueAtTime(up ? 660 : 520, now + 0.14);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.2);
    setTimeout(() => void ctx.close().catch(() => undefined), 500);
  } catch {
    /* audio unavailable or blocked; the toast still appears */
  }
}

/**
 * Say something out loud, if the browser can and the user asked for it.
 *
 * Speech is queued by the browser, so a burst of fills would read them all
 * back one after another; cancelling first keeps the announcement current,
 * which is what a trader watching a fast market wants.
 */
export function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.volume = 0.9;
    synth.speak(utterance);
  } catch {
    /* speech unavailable; silence is fine */
  }
}
