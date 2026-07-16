import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEngineStore } from '../src/state/engineStore';
import { useUiStore } from '../src/state/uiStore';
import { useMapStore } from '../src/state/mapStore';
import { createEmptyGraph, type RoomNode } from '../src/map/graph';
import { MapScreen } from '../src/map/MapScreen';

const uiInitial = useUiStore.getState();
const engineInitial = useEngineStore.getState();
const mapInitial = useMapStore.getState();

afterEach(() => {
  useUiStore.setState(uiInitial, true);
  useEngineStore.setState(engineInitial, true);
  useMapStore.setState(mapInitial, true);
});

function mkRoom(id: string, name: string, pos: { x: number; y: number }, floor?: number): RoomNode {
  return { id, name, pos, posLocked: false, flags: {}, floor };
}

/** A one-floor graph, or a two-floor graph (landing/hall on floor 0, loft on floor 1,
 *  linked by a confirmed `up` edge) depending on `floors`. */
function setUpMap(floors: 1 | 2) {
  const graph = createEmptyGraph();
  graph.rooms.landing = mkRoom('landing', 'Landing', { x: 0, y: 0 }, 0);
  graph.rooms.hall = mkRoom('hall', 'Hall', { x: 0, y: -1 }, 0);
  graph.edges.push(
    { from: 'landing', to: 'hall', dir: 'n', status: 'confirmed' },
    { from: 'hall', to: 'landing', dir: 's', status: 'confirmed' },
  );
  if (floors === 2) {
    graph.rooms.loft = mkRoom('loft', 'Loft', { x: 0, y: 0 }, 1);
    graph.edges.push(
      { from: 'landing', to: 'loft', dir: 'up', status: 'confirmed' },
      { from: 'loft', to: 'landing', dir: 'down', status: 'inferred' },
    );
  }
  graph.currentRoomId = 'landing';
  useMapStore.setState({ graph });
  useEngineStore.setState({
    gameId: 'game-1',
    inputType: 'line',
    traveling: false,
    travelTo: vi.fn().mockResolvedValue('completed'),
  });
}

describe('MapScreen: Batch 4 / UX-21 floor switcher', () => {
  it('shows no floor switcher for a single-floor map', () => {
    setUpMap(1);
    render(<MapScreen />);
    expect(screen.queryByRole('toolbar', { name: 'Floor' })).not.toBeInTheDocument();
  });

  it('shows a floor switcher with one chip per floor once the map has 2+', () => {
    setUpMap(2);
    render(<MapScreen />);
    const toolbar = screen.getByRole('toolbar', { name: 'Floor' });
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByText('Ground')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('tapping a floor chip changes which rooms render, and shows the return-to-current control', () => {
    setUpMap(2);
    render(<MapScreen />);

    // Starts auto-following the current room's floor (Landing/Hall, ground floor).
    expect(screen.getByText('Landing')).toBeInTheDocument();
    expect(screen.getByText('Hall')).toBeInTheDocument();
    expect(screen.queryByText('Loft')).not.toBeInTheDocument();
    expect(screen.queryByText('↩ Current floor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('+1'));

    expect(screen.getByText('Loft')).toBeInTheDocument();
    expect(screen.queryByText('Landing')).not.toBeInTheDocument();
    expect(screen.getByText('↩ Current floor')).toBeInTheDocument();

    fireEvent.click(screen.getByText('↩ Current floor'));

    expect(screen.getByText('Landing')).toBeInTheDocument();
    expect(screen.queryByText('Loft')).not.toBeInTheDocument();
    expect(screen.queryByText('↩ Current floor')).not.toBeInTheDocument();
  });

  it('renders the cross-floor edge as a tappable stub, not a line to an undrawn room', () => {
    setUpMap(2);
    render(<MapScreen />);
    const stub = screen.getByRole('button', { name: 'Go to floor 1' });
    expect(stub).toBeInTheDocument();
    fireEvent.click(stub);
    expect(screen.getByText('Loft')).toBeInTheDocument();
  });
});
