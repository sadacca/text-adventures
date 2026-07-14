import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEngineStore } from '../src/state/engineStore';
import { useUiStore } from '../src/state/uiStore';
import { useMapStore } from '../src/state/mapStore';
import { createEmptyGraph } from '../src/map/graph';
import { VerbChips } from '../src/story/VerbChips';
import { CompassRose } from '../src/story/CompassRose';
import { ExitsRow } from '../src/story/ExitsRow';
import { TapWords } from '../src/story/TapWords';
import { CommandBar } from '../src/story/CommandBar';

const uiInitial = useUiStore.getState();
const engineInitial = useEngineStore.getState();
const mapInitial = useMapStore.getState();

afterEach(() => {
  useUiStore.setState(uiInitial, true);
  useEngineStore.setState(engineInitial, true);
  useMapStore.setState(mapInitial, true);
});

/**
 * Task 1.7 acceptance is normally checked with real touch input on a mobile emulation /
 * real device (see IMPLEMENTATION_PLAN.md). These are the unit-level equivalents: with a
 * mocked `sendCommand` and no live engine, verify the same wiring these UI pieces
 * depend on — the "traverse via compass, take an object via verb+tap-word, all without
 * typing" path — actually calls `sendCommand`/manipulates the shared draft correctly.
 */
describe('VerbChips', () => {
  it('sends no-object verbs immediately', () => {
    const sendCommand = vi.fn();
    useEngineStore.setState({ inputType: 'line', sendCommand });
    render(<VerbChips />);
    fireEvent.click(screen.getByText('Look'));
    expect(sendCommand).toHaveBeenCalledWith('look');
  });

  it('inserts object verbs into the draft instead of sending', () => {
    const sendCommand = vi.fn();
    useEngineStore.setState({ inputType: 'line', sendCommand });
    render(<VerbChips />);
    fireEvent.click(screen.getByText('Take'));
    expect(sendCommand).not.toHaveBeenCalled();
    expect(useUiStore.getState().commandDraft).toBe('take');
  });

  it('disables all chips when the game is not awaiting line input', () => {
    useEngineStore.setState({ inputType: null });
    render(<VerbChips />);
    expect(screen.getByText('Look').closest('button')).toBeDisabled();
  });
});

describe('CompassRose', () => {
  it('expands and sends a direction command on tap', () => {
    const sendCommand = vi.fn();
    useEngineStore.setState({ inputType: 'line', sendCommand });
    render(<CompassRose />);
    fireEvent.click(screen.getByLabelText('Expand compass'));
    fireEvent.click(screen.getByLabelText('Go n'));
    expect(sendCommand).toHaveBeenCalledWith('n');
  });

  it('visually emphasizes directions the map already knows are exits', () => {
    useEngineStore.setState({ inputType: 'line', sendCommand: vi.fn() });
    const graph = createEmptyGraph();
    graph.rooms.a = { id: 'a', name: 'A', pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
    graph.rooms.b = { id: 'b', name: 'B', pos: { x: 0, y: -1 }, posLocked: false, flags: {} };
    graph.edges.push({ from: 'a', to: 'b', dir: 'n', status: 'confirmed' });
    graph.currentRoomId = 'a';
    useMapStore.setState({ graph });

    render(<CompassRose />);
    fireEvent.click(screen.getByLabelText('Expand compass'));
    expect(screen.getByLabelText('Go n')).toHaveClass('compass-known');
    expect(screen.getByLabelText('Go s')).not.toHaveClass('compass-known');
  });
});

describe('ExitsRow', () => {
  it('renders a chip per confirmed exit and sends the direction on tap', () => {
    const sendCommand = vi.fn();
    useEngineStore.setState({ inputType: 'line', sendCommand });
    const graph = createEmptyGraph();
    graph.rooms.a = { id: 'a', name: 'A', pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
    graph.rooms.b = { id: 'b', name: 'B', pos: { x: 0, y: -1 }, posLocked: false, flags: {} };
    graph.edges.push({ from: 'a', to: 'b', dir: 'n', status: 'confirmed' });
    graph.currentRoomId = 'a';
    useMapStore.setState({ graph });

    render(<ExitsRow />);
    fireEvent.click(screen.getByLabelText('Go n'));
    expect(sendCommand).toHaveBeenCalledWith('n');
  });

  it('renders nothing when there are no known exits', () => {
    useMapStore.setState({ graph: createEmptyGraph() });
    const { container } = render(<ExitsRow />);
    expect(container.firstChild).toBeNull();
  });
});

describe('TapWords', () => {
  it('appends a tapped word to the draft', () => {
    render(<TapWords text="There is a brass lamp here." />);
    fireEvent.click(screen.getByText('lamp'));
    expect(useUiStore.getState().commandDraft).toBe('lamp');
  });

  it('composes a full command across a verb chip and a tapped word', () => {
    const sendCommand = vi.fn();
    useEngineStore.setState({ inputType: 'line', sendCommand });
    render(
      <>
        <VerbChips />
        <TapWords text="There is a brass lamp here." />
      </>,
    );
    fireEvent.click(screen.getByText('Take'));
    fireEvent.click(screen.getByText('lamp'));
    expect(useUiStore.getState().commandDraft).toBe('take lamp');
    expect(document.activeElement?.tagName).not.toBe('INPUT');
  });

  it('renders a command-echo line distinctly from game prose', () => {
    render(<TapWords text={'> take lamp\nTaken.'} />);
    const echo = screen.getByText((_, node) => node?.textContent === '> take lamp');
    expect(echo).toHaveClass('story-echo');
    expect(screen.getByText('Taken.')).not.toHaveClass('story-echo');
  });

  it('long-pressing a word sends "examine <word>" and suppresses the tap that follows', () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn();
      useEngineStore.setState({ inputType: 'line', sendCommand });
      render(<TapWords text="There is a brass lamp here." />);
      const word = screen.getByText('lamp');
      fireEvent.pointerDown(word, { clientX: 0, clientY: 0 });
      vi.advanceTimersByTime(500);
      expect(sendCommand).toHaveBeenCalledWith('examine lamp');
      fireEvent.pointerUp(word);
      fireEvent.click(word);
      expect(useUiStore.getState().commandDraft).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the pending long-press when the pointer moves past the scroll threshold', () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn();
      useEngineStore.setState({ inputType: 'line', sendCommand });
      render(<TapWords text="There is a brass lamp here." />);
      const word = screen.getByText('lamp');
      fireEvent.pointerDown(word, { clientX: 0, clientY: 0 });
      fireEvent.pointerMove(word, { clientX: 0, clientY: 20 });
      vi.advanceTimersByTime(500);
      expect(sendCommand).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not send examine while not awaiting line input, but still suppresses the tap', () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn();
      useEngineStore.setState({ inputType: 'char', sendCommand });
      render(<TapWords text="There is a brass lamp here." />);
      const word = screen.getByText('lamp');
      fireEvent.pointerDown(word, { clientX: 0, clientY: 0 });
      vi.advanceTimersByTime(500);
      expect(sendCommand).not.toHaveBeenCalled();
      fireEvent.pointerUp(word);
      fireEvent.click(word);
      expect(useUiStore.getState().commandDraft).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CommandBar', () => {
  it('submits the draft, records history, and clears the field', () => {
    const sendCommand = vi.fn();
    useEngineStore.setState({ inputType: 'line', sendCommand });
    useUiStore.setState({ commandDraft: 'take lamp' });
    render(<CommandBar />);
    fireEvent.submit(screen.getByPlaceholderText('Enter a command…').closest('form')!);
    expect(sendCommand).toHaveBeenCalledWith('take lamp');
    expect(useUiStore.getState().commandDraft).toBe('');
    expect(useUiStore.getState().commandHistory).toEqual(['take lamp']);
  });

  it('never disables the text input itself while waiting for the engine', () => {
    useEngineStore.setState({ inputType: null });
    render(<CommandBar />);
    expect(screen.getByPlaceholderText('Waiting…')).not.toBeDisabled();
  });

  it('opens the history popover and refills the draft from a past command', () => {
    useEngineStore.setState({ inputType: 'line', sendCommand: vi.fn() });
    useUiStore.setState({ commandHistory: ['north', 'take lamp'] });
    render(<CommandBar />);
    fireEvent.click(screen.getByLabelText('Command history'));
    fireEvent.click(screen.getByText('take lamp'));
    expect(useUiStore.getState().commandDraft).toBe('take lamp');
  });

  it('deletes the last word of the draft and hides itself once the draft is empty', () => {
    useEngineStore.setState({ inputType: 'line', sendCommand: vi.fn() });
    useUiStore.setState({ commandDraft: 'take brass lamp' });
    render(<CommandBar />);
    const deleteLastWord = screen.getByLabelText('Delete last word');
    fireEvent.click(deleteLastWord);
    expect(useUiStore.getState().commandDraft).toBe('take brass');
    fireEvent.click(screen.getByLabelText('Delete last word'));
    expect(useUiStore.getState().commandDraft).toBe('take');
    fireEvent.click(screen.getByLabelText('Delete last word'));
    expect(useUiStore.getState().commandDraft).toBe('');
    expect(screen.queryByLabelText('Delete last word')).not.toBeInTheDocument();
  });
});

describe('engineStore pinRequestId', () => {
  it('bumps on every sendCommand, so StoryScreen can re-pin scroll to the reply', () => {
    const before = useEngineStore.getState().pinRequestId;
    useEngineStore.getState().sendCommand('look');
    expect(useEngineStore.getState().pinRequestId).toBe(before + 1);
  });
});
