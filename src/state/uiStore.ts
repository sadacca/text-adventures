import { create } from 'zustand';
import { persist, type PersistOptions } from 'zustand/middleware';

export type Tab = 'library' | 'story' | 'map' | 'more';

const COMMAND_HISTORY_LIMIT = 20;

export interface UiState {
  tab: Tab;
  commandDraft: string;
  theme: 'light' | 'dark' | 'system' | 'retro';
  fontScale: number;
  /** UX-8: reading font for the story transcript. */
  storyFont: 'system' | 'serif' | 'mono';
  /** UX-19: bold words the game's parser dictionary actually understands. Default on. */
  highlightVocab: boolean;
  /** Task 1.4: settings toggle that shows/hides DebugConsole in the Story tab. */
  debugConsoleEnabled: boolean;
  /** Task 1.7: recent sent commands, newest first, for the history popover and "again". */
  commandHistory: string[];
  /** UX-20: whether the player has dismissed the Story tab's tap/hold hint banner. */
  hasSeenTapHint: boolean;
  /** UX-10: id of the room the long-press RoomEditSheet is open for, or null when
   *  closed. Lifted out of MapScreen's local state so the Android back-button trap
   *  (backButton.ts) can close it without React involvement. */
  roomEditTarget: string | null;
  /** Batch 4 / UX-21: which floor MapScreen shows. null = auto-follow the current
   *  room's floor; a number = the player manually switched and stays there until they
   *  tap back to auto-follow or load a different game. Session-only, not persisted —
   *  same as roomEditTarget. */
  activeFloor: number | null;
  setTab: (tab: Tab) => void;
  setCommandDraft: (draft: string) => void;
  appendToDraft: (word: string) => void;
  setTheme: (theme: UiState['theme']) => void;
  setFontScale: (scale: number) => void;
  setStoryFont: (font: UiState['storyFont']) => void;
  setHighlightVocab: (enabled: boolean) => void;
  setDebugConsoleEnabled: (enabled: boolean) => void;
  pushCommandHistory: (text: string) => void;
  setRoomEditTarget: (id: string | null) => void;
  dismissTapHint: () => void;
  setActiveFloor: (floor: number | null) => void;
}

/**
 * UX-15: theme/fontScale/storyFont rehydrate synchronously from localStorage before first
 * paint (SPECS.md §4 originally sketched an IndexedDB `settings` row for this — it was
 * never built; this supersedes that with localStorage instead, which is what actually
 * achieves "no light-theme flash"). Everything else here is session state (tab, drafts,
 * history, the debug toggle, the room-edit-sheet target) and must NOT persist.
 */
const persistOptions: PersistOptions<
  UiState,
  Pick<UiState, 'theme' | 'fontScale' | 'storyFont' | 'highlightVocab' | 'hasSeenTapHint'>
> = {
  name: 'text-adventures-settings',
  version: 1,
  partialize: (s) => ({
    theme: s.theme,
    fontScale: s.fontScale,
    storyFont: s.storyFont,
    highlightVocab: s.highlightVocab,
    hasSeenTapHint: s.hasSeenTapHint,
  }),
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      tab: 'library',
      commandDraft: '',
      theme: 'system',
      fontScale: 1,
      storyFont: 'system',
      highlightVocab: true,
      debugConsoleEnabled: false,
      commandHistory: [],
      hasSeenTapHint: false,
      roomEditTarget: null,
      activeFloor: null,
      setTab: (tab) => set({ tab }),
      setCommandDraft: (commandDraft) => set({ commandDraft }),
      appendToDraft: (word) =>
        set((s) => ({ commandDraft: s.commandDraft ? `${s.commandDraft} ${word}` : word })),
      setTheme: (theme) => set({ theme }),
      setFontScale: (fontScale) => set({ fontScale }),
      setStoryFont: (storyFont) => set({ storyFont }),
      setHighlightVocab: (highlightVocab) => set({ highlightVocab }),
      setDebugConsoleEnabled: (debugConsoleEnabled) => set({ debugConsoleEnabled }),
      pushCommandHistory: (text) =>
        set((s) => ({
          commandHistory: [text, ...s.commandHistory.filter((c) => c !== text)].slice(
            0,
            COMMAND_HISTORY_LIMIT,
          ),
        })),
      setRoomEditTarget: (roomEditTarget) => set({ roomEditTarget }),
      dismissTapHint: () => set({ hasSeenTapHint: true }),
      setActiveFloor: (activeFloor) => set({ activeFloor }),
    }),
    persistOptions,
  ),
);
