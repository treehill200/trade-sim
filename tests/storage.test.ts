import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalAll, loadLocal, removeLocal, saveLocal } from '@/storage/local';

/** A stand-in for localStorage, since the tests run outside a browser. */
class FakeStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

let storage: FakeStorage;

/** lib.dom types `localStorage` as `Storage`; the fake implements the part used here. */
function install(value: FakeStorage | undefined): void {
  (globalThis as { localStorage?: unknown }).localStorage = value;
}

beforeEach(() => {
  storage = new FakeStorage();
  install(storage);
});

afterEach(() => {
  install(undefined);
});

describe('local settings storage', () => {
  it('round-trips a value', () => {
    saveLocal('ui', { theme: 'light' });
    expect(loadLocal('ui', null)).toEqual({ theme: 'light' });
  });

  it('returns the fallback for a key that was never saved', () => {
    expect(loadLocal('missing', 'fallback')).toBe('fallback');
  });

  it('returns the fallback rather than throwing on corrupt JSON', () => {
    storage.setItem('davidsim:ui', '{not json');
    expect(loadLocal('ui', 'fallback')).toBe('fallback');
  });

  it('namespaces every key, so it cannot collide with another app', () => {
    saveLocal('ui', 1);
    expect(storage.key(0)).toBe('davidsim:ui');
  });

  it('removes a single key', () => {
    saveLocal('ui', 1);
    removeLocal('ui');
    expect(loadLocal('ui', null)).toBeNull();
  });

  it('clears every key it owns and leaves other apps alone', () => {
    saveLocal('ui', 1);
    saveLocal('trading', 2);
    saveLocal('drawings', 3);
    saveLocal('alerts', 4);
    storage.setItem('someone-else', 'keep me');
    clearLocalAll();
    expect(storage.length).toBe(1);
    expect(storage.getItem('someone-else')).toBe('keep me');
  });

  it('clears them all even though removing keys shifts the indexes', () => {
    // The regression this guards: iterating by index while removing as you go
    // skips every other key.
    for (let i = 0; i < 12; i += 1) saveLocal(`k${i}`, i);
    clearLocalAll();
    expect(storage.length).toBe(0);
  });

  it('degrades quietly when storage is unavailable', () => {
    install(undefined);
    expect(() => saveLocal('ui', 1)).not.toThrow();
    expect(() => clearLocalAll()).not.toThrow();
    expect(loadLocal('ui', 'fallback')).toBe('fallback');
  });
});
