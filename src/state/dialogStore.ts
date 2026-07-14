import { create } from 'zustand';

export interface DialogRequest {
  kind: 'confirm' | 'prompt' | 'pick' | 'alert';
  title: string;
  body?: string;
  confirmLabel?: string; // default 'OK'; pass 'Delete' etc. for destructive actions
  danger?: boolean; // styles confirm button with .btn-danger
  placeholder?: string; // prompt only
  initialValue?: string; // prompt only
  options?: string[]; // pick only: tappable list
}

interface DialogState {
  active: DialogRequest | null;
  resolve: ((v: string | boolean | null) => void) | null;
  ask: (req: DialogRequest) => Promise<string | boolean | null>;
  settle: (value: string | boolean | null) => void;
}

/**
 * UX-5: shared mechanism replacing window.confirm/prompt/alert (which look broken
 * inside an installed PWA and are unusable for a multi-line prompt like naming a save
 * on a phone). Only one dialog can be active at a time — a second `ask()` while one is
 * already open immediately resolves `null` rather than queuing, since none of our call
 * sites ever legitimately stack.
 */
export const useDialogStore = create<DialogState>((set, get) => ({
  active: null,
  resolve: null,
  ask(req) {
    if (get().active) return Promise.resolve(null);
    return new Promise((resolve) => {
      set({ active: req, resolve });
    });
  },
  settle(value) {
    get().resolve?.(value);
    set({ active: null, resolve: null });
  },
}));
