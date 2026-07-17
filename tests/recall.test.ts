import { describe, expect, it } from 'vitest';
import { filterTranscript } from '../src/story/recall';
import type { TranscriptEntry } from '../src/storage/db';

const entries: TranscriptEntry[] = [
  { turn: 1, command: 'look', response: 'You are in a Kitchen.\nThere is a MAILBOX here.' },
  { turn: 2, command: 'open mailbox', response: 'Opening the mailbox reveals a leaflet.' },
  { turn: 3, command: 'read leaflet', response: 'Welcome to Zork!' },
];

describe('filterTranscript (UX-33)', () => {
  it('returns [] for a query shorter than 2 characters', () => {
    expect(filterTranscript(entries, 'm')).toEqual([]);
    expect(filterTranscript(entries, '')).toEqual([]);
  });

  it('matches case-insensitively across both command and response', () => {
    // Turn 2 matches in both its command ("open mailbox") and its response text
    // ("Opening the mailbox…"); turn 1 matches only in its (differently-cased) response.
    const results = filterTranscript(entries, 'mailbox');
    expect(results.map((r) => [r.turn, r.field])).toEqual([
      [2, 'command'],
      [2, 'response'],
      [1, 'response'],
    ]);
  });

  it('reports newest-first (by turn, descending)', () => {
    const withDupe: TranscriptEntry[] = [
      { turn: 1, command: 'x leaflet', response: '' },
      { turn: 5, command: 'y leaflet', response: '' },
      { turn: 3, command: 'z leaflet', response: '' },
    ];
    const results = filterTranscript(withDupe, 'leaflet');
    expect(results.map((r) => r.turn)).toEqual([3, 5, 1]);
  });

  it('bolds the exact match span via matchStart/matchEnd offsets', () => {
    const results = filterTranscript(entries, 'mailbox');
    const commandResult = results.find((r) => r.field === 'command')!;
    expect(commandResult.line.slice(commandResult.matchStart, commandResult.matchEnd)).toBe(
      'mailbox',
    );
  });

  it('includes one line of surrounding context for a multi-line response match', () => {
    const results = filterTranscript(entries, 'mailbox');
    const responseResult = results.find((r) => r.turn === 1 && r.field === 'response')!;
    expect(responseResult.line).toBe('There is a MAILBOX here.');
    expect(responseResult.context).toBe('You are in a Kitchen.');
  });

  it('caps total results at 50 across the whole transcript', () => {
    const many: TranscriptEntry[] = Array.from({ length: 60 }, (_, i) => ({
      turn: i + 1,
      command: 'search grating',
      response: 'ok',
    }));
    expect(filterTranscript(many, 'grating')).toHaveLength(50);
  });
});
