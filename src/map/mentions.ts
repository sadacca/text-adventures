import type { Direction } from './graph.js';

/**
 * Task 1.10 detection heuristic, deliberately narrow: only the 8 unambiguous full
 * compass words. Single letters (n/e/s/w), "up"/"down"/"in"/"out", and synonyms are
 * excluded on purpose — ordinary prose is full of them ("pick up", "sit down", "in the
 * corner") and a false suggestion is worse than a missed one. Word-boundary matching
 * means "northern", "westward", and "northeast" do NOT match "north"/"west"/"east".
 */
const MENTION_WORDS: [RegExp, Direction][] = [
  [/\bnortheast\b/, 'ne'],
  [/\bnorthwest\b/, 'nw'],
  [/\bsoutheast\b/, 'se'],
  [/\bsouthwest\b/, 'sw'],
  [/\bnorth\b/, 'n'],
  [/\bsouth\b/, 's'],
  [/\beast\b/, 'e'],
  [/\bwest\b/, 'w'],
];

/** Directions mentioned in a chunk of game prose, deduped, in MENTION_WORDS order. */
export function detectMentionedDirections(text: string): Direction[] {
  const lower = text.toLowerCase();
  return MENTION_WORDS.filter(([re]) => re.test(lower)).map(([, dir]) => dir);
}
