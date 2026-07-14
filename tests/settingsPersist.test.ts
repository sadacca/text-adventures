import { describe, expect, it } from 'vitest';
import { useUiStore } from '../src/state/uiStore';

describe('UX-15: settings persistence', () => {
  it('persists theme to localStorage, but not session state like commandDraft', () => {
    useUiStore.getState().setTheme('retro');
    const stored = JSON.parse(localStorage.getItem('text-adventures-settings')!);
    expect(stored.state.theme).toBe('retro');
    expect(stored.state).not.toHaveProperty('commandDraft');
  });
});
