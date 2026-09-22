/** localStorage helpers for small settings, safe when storage is unavailable. */

const PREFIX = 'davidsim:';

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or private mode: settings simply do not persist */
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * Remove every setting this app has saved, leaving any other site data alone.
 *
 * Used by the "start over" recovery button, so it must not depend on a list of
 * keys that a future store could forget to add itself to.
 */
export function clearLocalAll(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* storage unavailable: there is nothing saved to clear */
  }
}
