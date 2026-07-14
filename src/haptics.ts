/** Best-effort haptic tick; silently a no-op where unsupported (iOS Safari, desktop). */
export function haptic(pattern: number | number[] = 10) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
