import { describe, expect, it } from 'vitest';
import { ALL_DIRECTIONS, gridOffset, normalizeDirection, opposite } from '../src/map/directions';

describe('normalizeDirection', () => {
  it('accepts abbreviations and full words, case-insensitively', () => {
    expect(normalizeDirection('n')).toBe('n');
    expect(normalizeDirection('North')).toBe('n');
    expect(normalizeDirection('SOUTHWEST')).toBe('sw');
    expect(normalizeDirection('u')).toBe('up');
    expect(normalizeDirection('Down')).toBe('down');
    expect(normalizeDirection('enter')).toBe('in');
    expect(normalizeDirection('exit')).toBe('out');
    expect(normalizeDirection('leave')).toBe('out');
  });

  it('accepts a "go " prefix', () => {
    expect(normalizeDirection('go north')).toBe('n');
    expect(normalizeDirection('Go Up')).toBe('up');
  });

  it('rejects non-directional and object-taking movement commands', () => {
    expect(normalizeDirection('take lamp')).toBeNull();
    expect(normalizeDirection('climb tree')).toBeNull();
    expect(normalizeDirection('enter house')).toBeNull();
    expect(normalizeDirection('')).toBeNull();
  });
});

describe('opposite', () => {
  it('is its own inverse for every direction', () => {
    for (const dir of ALL_DIRECTIONS) {
      expect(opposite(opposite(dir))).toBe(dir);
    }
  });

  it('matches the compass pairs in SPECS.md §2', () => {
    expect(opposite('n')).toBe('s');
    expect(opposite('e')).toBe('w');
    expect(opposite('ne')).toBe('sw');
    expect(opposite('nw')).toBe('se');
    expect(opposite('up')).toBe('down');
    expect(opposite('in')).toBe('out');
  });
});

describe('gridOffset', () => {
  it('gives compass directions unit offsets', () => {
    expect(gridOffset('n')).toEqual({ dx: 0, dy: -1 });
    expect(gridOffset('se')).toEqual({ dx: 1, dy: 1 });
  });

  it('gives up/down/in/out their SPECS.md-documented special-case offsets', () => {
    expect(gridOffset('up')).toEqual({ dx: 0.5, dy: -1.35 });
    expect(gridOffset('down')).toEqual({ dx: -0.5, dy: 1.35 });
    expect(gridOffset('in')).toBeNull();
    expect(gridOffset('out')).toBeNull();
  });
});
