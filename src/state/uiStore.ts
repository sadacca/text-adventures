import { create } from 'zustand';

export type Tab = 'library' | 'story' | 'map' | 'more';

interface UiState {
  tab: Tab;
  commandDraft: string;
  theme: 'light' | 'dark' | 'system';
  fontScale: number;
  setTab: (tab: Tab) => void;
  setCommandDraft: (draft: string) => void;
  appendToDraft: (word: string) => void;
  setTheme: (theme: UiState['theme']) => void;
  setFontScale: (scale: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'library',
  commandDraft: '',
  theme: 'system',
  fontScale: 1,
  setTab: (tab) => set({ tab }),
  setCommandDraft: (commandDraft) => set({ commandDraft }),
  appendToDraft: (word) =>
    set((s) => ({ commandDraft: s.commandDraft ? `${s.commandDraft} ${word}` : word })),
  setTheme: (theme) => set({ theme }),
  setFontScale: (fontScale) => set({ fontScale }),
}));
