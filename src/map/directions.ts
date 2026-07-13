import type { Direction } from './graph.js';

interface DirectionInfo {
  opposite: Direction;
  /** Grid offset applied by the layout pass (Task 1.8); null = no directional offset. */
  offset: { dx: number; dy: number } | null;
}

const DIRECTION_TABLE: Record<Direction, DirectionInfo> = {
  n: { opposite: 's', offset: { dx: 0, dy: -1 } },
  s: { opposite: 'n', offset: { dx: 0, dy: 1 } },
  e: { opposite: 'w', offset: { dx: 1, dy: 0 } },
  w: { opposite: 'e', offset: { dx: -1, dy: 0 } },
  ne: { opposite: 'sw', offset: { dx: 1, dy: -1 } },
  nw: { opposite: 'se', offset: { dx: -1, dy: -1 } },
  se: { opposite: 'nw', offset: { dx: 1, dy: 1 } },
  sw: { opposite: 'ne', offset: { dx: -1, dy: 1 } },
  up: { opposite: 'down', offset: { dx: 0.5, dy: -1.35 } },
  down: { opposite: 'up', offset: { dx: -0.5, dy: 1.35 } },
  in: { opposite: 'out', offset: null },
  out: { opposite: 'in', offset: null },
};

export const ALL_DIRECTIONS: Direction[] = Object.keys(DIRECTION_TABLE) as Direction[];

/** Player input, case-insensitive, either an abbreviation/word or "go <word>". */
const ALIASES: Record<string, Direction> = {
  n: 'n',
  north: 'n',
  s: 's',
  south: 's',
  e: 'e',
  east: 'e',
  w: 'w',
  west: 'w',
  ne: 'ne',
  northeast: 'ne',
  nw: 'nw',
  northwest: 'nw',
  se: 'se',
  southeast: 'se',
  sw: 'sw',
  southwest: 'sw',
  u: 'up',
  up: 'up',
  d: 'down',
  down: 'down',
  in: 'in',
  enter: 'in',
  out: 'out',
  exit: 'out',
  leave: 'out',
};

/**
 * Returns the canonical Direction for a player command, or null if the command isn't a
 * mappable direction (e.g. "climb tree", "enter house" with an object — SPECS.md §2).
 */
export function normalizeDirection(input: string): Direction | null {
  let text = input.trim().toLowerCase();
  if (text.startsWith('go ')) text = text.slice(3).trim();
  return ALIASES[text] ?? null;
}

export function opposite(dir: Direction): Direction {
  return DIRECTION_TABLE[dir].opposite;
}

export function gridOffset(dir: Direction): { dx: number; dy: number } | null {
  return DIRECTION_TABLE[dir].offset;
}
