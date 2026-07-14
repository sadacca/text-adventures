import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEngineStore } from '../src/state/engineStore';
import { useUiStore } from '../src/state/uiStore';
import { listGames } from '../src/storage/games';
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
