/**
 * Small integer hashing helpers.
 *
 * These are for values that need to be reproducible from their coordinates
 * rather than from a sequence — a price level's resting size in the order
 * book, for instance, which must look the same every frame without the book
 * being simulated order by order.
 *
 * The mixer is a 32-bit variant of MurmurHash3's finalizer: fast in JS
 * (every operation stays in int32) with good avalanche behaviour.
 */

/** Mix a 32-bit integer into a well-distributed 32-bit integer. */
export function mix32(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Derive a 32-bit seed from an arbitrary string, so seeds can be words. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}
