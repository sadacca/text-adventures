import { create } from 'zustand';

export type Tab = 'library' | 'story' | 'map' | 'more';

const COMMAND_HISTORY_LIMIT = 20;

export interface UiState {
  tab: Tab;
  commandDraft: string;
  theme: 'light' | 'dark' | 'system';
  fontScale: number;
  /** Task 1.4: settings toggle that shows/hides DebugConsole in the Story tab. */
  debugConsoleEnabled: boolean;
  /** Task 1.7: recent sent commands, newest first, for the history popover and "again". */
  commandHistory: string[];
  /** Bumped whenever something (a verb chip, tap-word) wants the command input focused
   *  without otherwise touching it — CommandBar's effect watches this and calls
   *  `.focus()`, since chips/words live in sibling components with no direct DOM ref. */
  focusRequestId: number;
  setTab: (tab: Tab) => void;
  setCommandDraft: (draft: string) => void;
  appendToDraft: (word: string) => void;
  setTheme: (theme: UiState['theme']) => void;
  setFontScale: (scale: number) => void;
  setDebugConsoleEnabled: (enabled: boolean) => void;
  pushCommandHistory: (text: string) => void;
  requestInputFocus: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'library',
  commandDraft: '',
  theme: 'system',
  fontScale: 1,
  debugConsoleEnabled: false,
  commandHistory: [],
  focusRequestId: 0,
  setTab: (tab) => set({ tab }),
  setCommandDraft: (commandDraft) => set({ commandDraft }),
  appendToDraft: (word) =>
    set((s) => ({ commandDraft: s.commandDraft ? `${s.commandDraft} ${word}` : word })),
  setTheme: (theme) => set({ theme }),
  setFontScale: (fontScale) => set({ fontScale }),
  setDebugConsoleEnabled: (debugConsoleEnabled) => set({ debugConsoleEnabled }),
  pushCommandHistory: (text) =>
    set((s) => ({
      commandHistory: [text, ...s.commandHistory.filter((c) => c !== text)].slice(
        0,
        COMMAND_HISTORY_LIMIT,
      ),
    })),
  requestInputFocus: () => set((s) => ({ focusRequestId: s.focusRequestId + 1 })),
}));
