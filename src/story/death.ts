/** UX-28: true when a response contains a classic death/ending banner. Narrow on
 *  purpose: the starred banner is a strong Infocom/Inform convention; prose deaths
 *  without it are accepted misses. Deliberately does NOT match the generic
 *  "*** The story has ended ***" banner, since that also ends *wins* — offering
 *  "undo" over a victory banner would be actively wrong. */
export function detectDeath(text: string): boolean {
  return (
    /\*{2,}\s*you have died\s*\*{2,}/i.test(text) || /\*{2,}\s*you are dead\s*\*{2,}/i.test(text)
  );
}
