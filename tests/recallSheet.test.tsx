import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '../src/state/uiStore';
import { appendTranscriptEntry } from '../src/storage/transcripts';
import { RecallSheet } from '../src/story/RecallSheet';

const uiInitial = useUiStore.getState();

afterEach(() => {
  useUiStore.setState(uiInitial, true);
});

describe('RecallSheet (UX-33)', () => {
  it('shows nothing before 2 characters, then matching results after debounce', async () => {
    const gameId = 'game-recall-render';
    await appendTranscriptEntry(gameId, {
      turn: 4,
      command: 'open mailbox',
      response: 'Opening the mailbox reveals a leaflet.',
    });
    render(<RecallSheet gameId={gameId} onClose={() => {}} />);

    const input = screen.getByPlaceholderText('Search commands and text…');
    fireEvent.change(input, { target: { value: 'm' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText('Turn 4')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'mailbox' } });
    await screen.findAllByText('Turn 4', {}, { timeout: 1000 });
    // Both the command ("open mailbox") and the response line match this single entry.
    expect(screen.getAllByText('Turn 4')).toHaveLength(2);
    expect(screen.getAllByText('mailbox')).toHaveLength(2);
  });

  it('shows the empty state for a 2+ char query with no matches', async () => {
    const gameId = 'game-recall-empty';
    await appendTranscriptEntry(gameId, { turn: 1, command: 'look', response: 'A room.' });
    render(<RecallSheet gameId={gameId} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('Search commands and text…'), {
      target: { value: 'grating' },
    });
    expect(await screen.findByText('No matches yet.', {}, { timeout: 1000 })).toBeInTheDocument();
  });
});

describe('uiStore recallSheetOpen (UX-33)', () => {
  it('back-handler flag: set then clear, same pattern as goToSheetOpen', () => {
    useUiStore.getState().setRecallSheetOpen(true);
    expect(useUiStore.getState().recallSheetOpen).toBe(true);
    useUiStore.getState().setRecallSheetOpen(false);
    expect(useUiStore.getState().recallSheetOpen).toBe(false);
  });
});
