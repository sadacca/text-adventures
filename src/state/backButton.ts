import { useDialogStore } from './dialogStore.js';
import { useEngineStore } from './engineStore.js';
import { useUiStore } from './uiStore.js';

let attached = false;

function rearm() {
  history.pushState({ trap: true }, '');
}

function onPopState() {
  if (useDialogStore.getState().active) {
    useDialogStore.getState().settle(null);
    rearm();
    return;
  }

  if (useUiStore.getState().roomEditTarget !== null) {
    useUiStore.getState().setRoomEditTarget(null);
    rearm();
    return;
  }

  if (useUiStore.getState().goToSheetOpen) {
    useUiStore.getState().setGoToSheetOpen(false);
    rearm();
    return;
  }

  const { tab, setTab } = useUiStore.getState();
  const gameLoaded = useEngineStore.getState().gameId !== null;
  if (tab !== 'story' && gameLoaded) {
    setTab('story');
    rearm();
    return;
  }

  if (tab !== 'library') {
    setTab('library');
    rearm();
    return;
  }

  // Nothing left to close: let the system handle it (exit the app).
}

/**
 * UX-10: in an installed PWA, the system Back gesture exits the app outright even when
 * a sheet or non-story tab is open — there's no browser chrome to fall back on. Traps a
 * single extra history entry so Back always closes the topmost thing first (dialog
 * sheet > room-edit sheet > back to Story > back to Library), re-arming the trap after
 * every handled case, and only allows the "real" exit once all of those are already at
 * rest.
 */
export function attachBackHandler(): () => void {
  if (attached) return () => {};
  attached = true;
  rearm();
  window.addEventListener('popstate', onPopState);
  return () => {
    attached = false;
    window.removeEventListener('popstate', onPopState);
  };
}
