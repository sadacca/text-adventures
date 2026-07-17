import { useDialogStore } from '../state/dialogStore.js';
import { useEngineStore } from '../state/engineStore.js';
import { haptic } from '../haptics.js';
import { isLongTrip, type TravelStep } from './travel.js';

/**
 * Shared by MapScreen's tap-to-travel and the Story tab's "Go to…" sheet (UX-31): warns
 * before a long trip with the same copy either surface would otherwise duplicate, then
 * drives `travelTo` and returns a toast message for the caller's own toast UI — null on
 * a completed trip (nothing to say) or a cancelled confirm (the player backed out).
 */
export async function confirmAndTravel(path: TravelStep[]): Promise<string | null> {
  if (path.length === 0) return null;
  if (isLongTrip(path)) {
    const proceed = await useDialogStore.getState().ask({
      kind: 'confirm',
      title: `This trip is ${path.length} turns`,
      body: 'Lamp/hunger timers burn down. Continue?',
      confirmLabel: 'Travel',
    });
    if (!proceed) return null;
  }
  const result = await useEngineStore.getState().travelTo(path);
  if (result === 'completed') {
    haptic(30);
    return null;
  }
  haptic([30, 60, 30]);
  if (result === 'blocked') return 'Travel stopped — something unexpected happened.';
  if (result === 'question') return 'Travel stopped — the game is asking a question.';
  return 'Travel stopped — the game wants a keypress.';
}
