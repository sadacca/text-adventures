import { describe, expect, it } from 'vitest';
import { detectUnknownWord } from '../src/story/oops';

describe('detectUnknownWord (UX-27)', () => {
  it('extracts the word from Infocom-style phrasing', () => {
    expect(detectUnknownWord('I don\'t know the word "sinbad".')).toBe('sinbad');
  });

  it('extracts the word from Inform 6/7 "necessary" phrasing', () => {
    expect(
      detectUnknownWord(
        'That\'s not a verb I recognise. The word "frotz" is not necessary in this story.',
      ),
    ).toBe('frotz');
  });

  it('returns null for unquoted "You can\'t see any such thing"', () => {
    expect(detectUnknownWord("You can't see any such thing.")).toBeNull();
  });

  it('returns null for plain prose that happens to contain the word "word"', () => {
    expect(detectUnknownWord('There is a single word carved into the stone.')).toBeNull();
  });
});
