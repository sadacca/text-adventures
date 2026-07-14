import { create } from 'zustand';

/**
 * Not in lib.dom.d.ts (still a Chromium-only draft API) — the shape Chrome actually
 * dispatches on `beforeinstallprompt`.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function runningStandalone(): boolean {
  // jsdom (and some older WebViews) don't implement matchMedia at all — guard it
  // rather than crash the whole module at import time.
  const standaloneDisplayMode =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari's own (non-standard, but harmless to check) installed-PWA flag.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneDisplayMode || iosStandalone;
}

interface InstallState {
  /** Stashed from `beforeinstallprompt` so it can be replayed later, on a tap rather
   *  than immediately — Chrome only fires this once and only if nothing consumes it. */
  promptEvent: BeforeInstallPromptEvent | null;
  /** True once actually installed (via our own prompt, the browser's own UI, or
   *  detected as already running standalone on load) — hides the install control. */
  installed: boolean;
  setPromptEvent: (event: BeforeInstallPromptEvent | null) => void;
  markInstalled: () => void;
}

export const useInstallStore = create<InstallState>((set) => ({
  promptEvent: null,
  installed: runningStandalone(),
  setPromptEvent: (promptEvent) => set({ promptEvent }),
  markInstalled: () => set({ installed: true, promptEvent: null }),
}));

let listenersAttached = false;

/**
 * Registered once from `App.tsx` at the top level, since `beforeinstallprompt` can fire
 * before any particular screen mounts and Chrome only dispatches it once per load.
 */
export function attachInstallListeners(): () => void {
  if (listenersAttached) return () => {};
  listenersAttached = true;

  const onBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    useInstallStore.getState().setPromptEvent(e as BeforeInstallPromptEvent);
  };
  const onAppInstalled = () => useInstallStore.getState().markInstalled();

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
  return () => {
    listenersAttached = false;
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', onAppInstalled);
  };
}
