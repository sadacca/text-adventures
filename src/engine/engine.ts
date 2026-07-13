import Bocfel from 'emglken/build/bocfel.js';
import { BridgeGlkOte } from './glkote-bridge.js';
import { MemoryDialog } from './memory-dialog.js';
import type { RawMessage } from './protocol-tap.js';
import type { EngineHandle, GameEvent } from './types.js';

const STORY_PATH = '/story.dat';
const AUTOSAVE_PATH = '/saves/__autosave.qzl';
const namedSavePath = (name: string) => `/saves/named-${encodeURIComponent(name)}.qzl`;

/**
 * Wires emglken's Bocfel (Z-machine, WASM) to our BridgeGlkOte/MemoryDialog behind the
 * EngineHandle contract from SPECS.md. Real Z-machine "autosave" isn't implemented
 * upstream (asyncglk/remglk-rs only have scaffolding for it) — `saveAutosave()` instead
 * drives the interpreter's own SAVE mechanism (Quetzal via Glk file I/O, which does
 * work end-to-end) silently in the background, and `start({autorestore: true})` drives
 * RESTORE the same way against a previously captured snapshot.
 *
 * This module knows nothing about IndexedDB or gameIds — durable persistence (autosave
 * generations, named saves, transcripts) is entirely the caller's job (see
 * `src/state/engineStore.ts`), which is why `preloadAutosave`/`onNamedSavePrompt`/
 * `onNamedSaveWritten` deal only in bytes and player-chosen names, not paths or storage.
 *
 * Every dispatch to the VM (real or silent) is serialized through `whenReady`/`dispatch`:
 * the interpreter only accepts one in-flight line at a time (GlkOte's own
 * `waiting_for_update` guard silently drops anything sent while busy, logging a console
 * warning), and a silent command's own response cycle (which can itself be multi-step —
 * Bocfel replays embedded scrollback history on RESTORE) can still be in flight when a
 * caller fires the next real command. Without this queue, that command is just dropped.
 */
export function createEngine(): EngineHandle {
  const listeners = new Set<(e: GameEvent) => void>();
  const rawListeners = new Set<(raw: RawMessage) => void>();
  const namedSaveWrittenListeners = new Set<(name: string, bytes: Uint8Array) => void>();
  const dialog = new MemoryDialog();
  const glkote = new BridgeGlkOte(
    (event) => {
      for (const listener of listeners) listener(event);
    },
    (raw) => {
      for (const listener of rawListeners) listener(raw);
    },
  );
  let started = false;
  let namedSavePromptHandler:
    ((kind: 'save' | 'restore') => Promise<{ name: string; bytes?: Uint8Array } | null>) | null =
    null;
  const pendingNamedSaveByPath = new Map<string, string>();

  let busy = false;
  const readyWaiters: (() => void)[] = [];
  const queuedCommands: string[] = [];

  function whenReady(): Promise<void> {
    if (!busy) return Promise.resolve();
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  function dispatch(text: string, silent: boolean): void {
    busy = true;
    if (silent) glkote.sendSilentCommand(text);
    else glkote.sendCommand(text);
  }

  // Internal, always-on listener: tracks the busy/ready cycle for every dispatch,
  // silent or not, and drains anything queued while the VM was busy.
  listeners.add((event) => {
    if (event.kind === 'input_requested' && event.type === 'line') {
      busy = false;
      const next = queuedCommands.shift();
      if (next !== undefined) {
        dispatch(next, false);
        return;
      }
      const waiter = readyWaiters.shift();
      waiter?.();
    }
  });

  dialog.setNamedPromptHandler(async (_extension, save) => {
    if (!namedSavePromptHandler) return null;
    const result = await namedSavePromptHandler(save ? 'save' : 'restore');
    if (!result) return null;
    const path = namedSavePath(result.name);
    if (save) {
      pendingNamedSaveByPath.set(path, result.name);
    } else if (result.bytes) {
      dialog.preload(path, result.bytes);
    }
    return path;
  });

  dialog.onWrite((path, bytes) => {
    const name = pendingNamedSaveByPath.get(path);
    if (name) {
      pendingNamedSaveByPath.delete(path);
      for (const listener of namedSaveWrittenListeners) listener(name, bytes);
    }
  });

  function glkote_on(listener: (e: GameEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    async start(story, opts) {
      if (started) throw new Error('engine already started');
      started = true;

      await dialog.write({ [STORY_PATH]: story });
      dialog.set_storyfile_dir(STORY_PATH);

      const hasAutosave = opts.autorestore && (await dialog.exists(AUTOSAVE_PATH));

      const vm = await Bocfel();
      busy = true; // VM boots straight into its own first input_requested cycle
      vm.start({ arguments: [STORY_PATH], Dialog: dialog, GlkOte: glkote });
      await whenReady();

      if (hasAutosave) {
        dialog.setNextPromptPath(AUTOSAVE_PATH);
        dispatch('restore', true);
        await whenReady();
      }
    },

    sendCommand(text) {
      if (busy) {
        queuedCommands.push(text);
        return;
      }
      dispatch(text, false);
    },

    on(listener) {
      return glkote_on(listener);
    },

    onRaw(listener) {
      rawListeners.add(listener);
      return () => rawListeners.delete(listener);
    },

    async saveAutosave() {
      dialog.setNextPromptPath(AUTOSAVE_PATH);
      const written = dialog.waitForWrite(AUTOSAVE_PATH);
      await whenReady();
      dispatch('save', true);
      const bytes = await written;
      await whenReady();
      return bytes;
    },

    async stop() {
      listeners.clear();
    },

    preloadAutosave(bytes) {
      dialog.preload(AUTOSAVE_PATH, bytes);
    },

    onNamedSavePrompt(handler) {
      namedSavePromptHandler = handler;
    },

    onNamedSaveWritten(listener) {
      namedSaveWrittenListeners.add(listener);
      return () => namedSaveWrittenListeners.delete(listener);
    },
  };
}
