import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEngineStore } from '../src/state/engineStore';
import { useUiStore } from '../src/state/uiStore';
import { useMapStore } from '../src/state/mapStore';
import { createEmptyGraph, type RoomNode } from '../src/map/graph';
import { GoToSheet } from '../src/story/GoToSheet';

const uiInitial = useUiStore.getState();
const engineInitial = useEngineStore.getState();
const mapInitial = useMapStore.getState();

afterEach(() => {
  useUiStore.setState(uiInitial, true);
  useEngineStore.setState(engineInitial, true);
  useMapStore.setState(mapInitial, true);
});

function mkRoom(id: string, name: string, floor?: number): RoomNode {
  return { id, name, pos: { x: 0, y: 0 }, posLocked: false, flags: {}, floor };
}

/** West of House <-n-> North of House (reachable); Far Room has no edge at all, so
 *  computePath returns null — the "no known path" disabled case. */
function setUpGraph() {
  const graph = createEmptyGraph();
  graph.rooms.west = mkRoom('west', 'West of House');
  graph.rooms.north = mkRoom('north', 'North of House');
  graph.rooms.attic = mkRoom('attic', 'Attic', 1);
  graph.rooms.far = mkRoom('far', 'Far Room');
  graph.edges.push(
    { from: 'west', to: 'north', dir: 'n', status: 'confirmed' },
    { from: 'north', to: 'attic', dir: 'up', status: 'confirmed' },
  );
  graph.currentRoomId = 'west';
  useMapStore.setState({ graph });
}

describe('GoToSheet (UX-31)', () => {
  it('lists named rooms newest-alphabetical excluding the current one, with floor shown when non-zero', () => {
    setUpGraph();
    render(<GoToSheet onClose={vi.fn()} />);
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Attic · Floor 1', 'Far Roomno known path', 'North of House']);
    expect(screen.queryByText('West of House')).not.toBeInTheDocument();
  });

  it('disables a room with no known path and shows a hint', () => {
    setUpGraph();
    render(<GoToSheet onClose={vi.fn()} />);
    const farButton = screen.getByText('Far Room').closest('button')!;
    expect(farButton).toBeDisabled();
    expect(screen.getByText('no known path')).toBeInTheDocument();
  });

  it('tapping a reachable room calls travelTo with the computed path and closes the sheet', async () => {
    setUpGraph();
    const travelTo = vi.fn().mockResolvedValue('completed');
    useEngineStore.setState({ travelTo });
    const onClose = vi.fn();
    render(<GoToSheet onClose={onClose} />);

    fireEvent.click(screen.getByText('North of House').closest('button')!);
    expect(onClose).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(travelTo).toHaveBeenCalledWith([{ dir: 'n', roomId: 'north' }]);
    });
  });
});

describe('uiStore goToSheetOpen (UX-31)', () => {
  it('back-handler flag: set then clear, same pattern as roomEditTarget', () => {
    useUiStore.getState().setGoToSheetOpen(true);
    expect(useUiStore.getState().goToSheetOpen).toBe(true);
    useUiStore.getState().setGoToSheetOpen(false);
    expect(useUiStore.getState().goToSheetOpen).toBe(false);
  });
});
