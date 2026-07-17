import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEngineStore } from '../src/state/engineStore';
import { useUiStore } from '../src/state/uiStore';
import { addOrTouchGame, listGames } from '../src/storage/games';
import { writeAutosaveGeneration } from '../src/storage/autosaves';
import { saveMap } from '../src/storage/maps';
import { createEmptyGraph } from '../src/map/graph';
import { LibraryScreen } from '../src/library/LibraryScreen';

const engineInitial = useEngineStore.getState();
const uiInitial = useUiStore.getState();

afterEach(() => {
  useEngineStore.setState(engineInitial, true);
  useUiStore.setState(uiInitial, true);
  vi.unstubAllGlobals();
});

describe('LibraryScreen — UX-17 sample game', () => {
  it('shows "Add sample game" on an empty library and loads it on tap', async () => {
    useEngineStore.setState({ openGame: vi.fn() });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([3, 0, 0]).buffer, { status: 200 })),
    );

    render(<LibraryScreen />);
    const button = await screen.findByText('Add sample game');
    fireEvent.click(button);

    await waitFor(async () => {
      const games = await listGames();
      expect(games).toHaveLength(1);
      expect(games[0].title).toBe('Zork I');
    });
    expect(useUiStore.getState().tab).toBe('story');
  });
});

describe('LibraryScreen — UX-34 card stats', () => {
  it('shows rooms explored and turns played once an autosave and map exist', async () => {
    const game = await addOrTouchGame(new Uint8Array([9, 9, 9]), 'played.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 42);
    const graph = createEmptyGraph();
    graph.rooms.a = { id: 'a', name: 'A', pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
    graph.rooms.b = { id: 'b', name: 'B', pos: { x: 1, y: 0 }, posLocked: false, flags: {} };
    graph.rooms.c = { id: 'c', name: 'C', pos: { x: 2, y: 0 }, posLocked: false, flags: {} };
    await saveMap(game.gameId, graph);

    render(<LibraryScreen />);
    expect(await screen.findByText('3 rooms explored · 42 turns')).toBeInTheDocument();
  });

  it('shows no stats line for a game that has never been played', async () => {
    await addOrTouchGame(new Uint8Array([8, 8, 8]), 'unplayed.z5');

    render(<LibraryScreen />);
    const title = await screen.findByText('unplayed');
    const card = title.closest('li')!;
    expect(within(card).queryByText(/rooms explored/)).not.toBeInTheDocument();
  });
});
