import { create } from 'zustand';

export type Tab = 'library' | 'story' | 'map' | 'more';

const COMMAND_HISTORY_LIMIT = 20;

export interface UiState {
  tab: Tab;
  commandDraft: string;
  theme: 'light' | 'dark' | 'system' | 'retro';
  fontScale: number;
  /** UX-8: reading font for the story transcript. */
  storyFont: 'system' | 'serif' | 'mono';
  /** Task 1.4: settings toggle that shows/hides DebugConsole in the Story tab. */
  debugConsoleEnabled: boolean;
  /** Task 1.7: recent sent commands, newest first, for the history popover and "again". */
  commandHistory: string[];
  setTab: (tab: Tab) => void;
  setCommandDraft: (draft: string) => void;
  appendToDraft: (word: string) => void;
  setTheme: (theme: UiState['theme']) => void;
  setFontScale: (scale: number) => void;
  setStoryFont: (font: UiState['storyFont']) => void;
  setDebugConsoleEnabled: (enabled: boolean) => void;
  pushCommandHistory: (text: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'library',
  commandDraft: '',
  theme: 'system',
  fontScale: 1,
  storyFont: 'system',
  debugConsoleEnabled: false,
  commandHistory: [],
  setTab: (tab) => set({ tab }),
  setCommandDraft: (commandDraft) => set({ commandDraft }),
  appendToDraft: (word) =>
    set((s) => ({ commandDraft: s.commandDraft ? `${s.commandDraft} ${word}` : word })),
  setTheme: (theme) => set({ theme }),
  setFontScale: (fontScale) => set({ fontScale }),
  setStoryFont: (storyFont) => set({ storyFont }),
  setDebugConsoleEnabled: (debugConsoleEnabled) => set({ debugConsoleEnabled }),
  pushCommandHistory: (text) =>
    set((s) => ({
      commandHistory: [text, ...s.commandHistory.filter((c) => c !== text)].slice(
        0,
        COMMAND_HISTORY_LIMIT,
      ),
    })),
}));
