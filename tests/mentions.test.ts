import { describe, expect, it } from 'vitest';
import { detectMentionedDirections } from '../src/map/mentions';

describe('detectMentionedDirections', () => {
  it('finds a simple compass mention', () => {
    expect(detectMentionedDirections('There is a passage to the west.')).toEqual(['w']);
  });

  it('does not match direction words as substrings of other words', () => {
    expect(detectMentionedDirections('A chilly northern wind blows westward.')).toEqual([]);
  });

  it('finds and dedupes multiple mentions, in MENTION_WORDS order', () => {
    expect(detectMentionedDirections('Passages lead northeast and south.')).toEqual(['ne', 's']);
  });

  it('still matches a negated mention (accepted limitation)', () => {
    expect(detectMentionedDirections('No exit to the south.')).toEqual(['s']);
  });
});
