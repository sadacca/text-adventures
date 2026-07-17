import { describe, expect, it } from 'vitest';
import { detectDeath } from '../src/story/death';

describe('detectDeath (UX-28)', () => {
  it('matches the classic "you have died" banner', () => {
    expect(detectDeath('    **** You have died ****\n\n')).toBe(true);
  });

  it('matches the "you are dead" variant', () => {
    expect(detectDeath('*** You are dead ***')).toBe(true);
  });

  it('does not match the generic story-ended banner (also used for wins)', () => {
    expect(detectDeath('*** The story has ended ***')).toBe(false);
  });

  it('does not match plain prose', () => {
    expect(detectDeath('You are standing in an open field.')).toBe(false);
  });
});
