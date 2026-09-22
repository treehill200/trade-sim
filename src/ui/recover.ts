import { idbClearAll } from '@/storage/idb';
import { clearLocalAll } from '@/storage/local';

/**
 * Throw away everything the app has saved and reload.
 *
 * The escape hatch behind every "start over" button. Whatever went wrong — a
 * half-written checkpoint, a setting the app can no longer read, a browser
 * that ran out of storage mid-write — clearing the lot and starting again is a
 * recovery a non-technical user can actually perform, and it is the only one
 * that cannot leave the app in the same broken state.
 *
 * The reload happens even if clearing failed, because a reload alone fixes a
 * transient failure and there is nothing better to offer if it does not.
 */
export async function startOver(): Promise<void> {
  try {
    clearLocalAll();
    await idbClearAll();
  } catch {
    /* fall through to the reload regardless */
  }
  window.location.reload();
}
