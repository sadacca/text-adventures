import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDialogStore } from '../src/state/dialogStore';
import { DialogHost } from '../src/dialog/DialogHost';

const dialogInitial = useDialogStore.getState();

afterEach(() => {
  useDialogStore.setState(dialogInitial, true);
});

describe('DialogHost', () => {
  it('resolves true when the confirm button is clicked', async () => {
    render(<DialogHost />);
    const promise = useDialogStore.getState().ask({ kind: 'confirm', title: 'Delete this?' });
    fireEvent.click(await screen.findByText('OK'));
    expect(await promise).toBe(true);
  });

  it('resolves false when the backdrop is tapped', async () => {
    render(<DialogHost />);
    const promise = useDialogStore.getState().ask({ kind: 'confirm', title: 'Delete this?' });
    fireEvent.click(await screen.findByText('Delete this?'));
    // clicking inside the sheet must not dismiss it (stopPropagation)
    expect(useDialogStore.getState().active).not.toBeNull();
    const backdrop = document.querySelector('.room-edit-backdrop')!;
    fireEvent.click(backdrop);
    expect(await promise).toBe(false);
  });
});
