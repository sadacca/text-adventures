import Bocfel from 'emglken/build/bocfel.js';
import { BridgeGlkOte } from './glkote-bridge.js';
import { MemoryDialog } from './memory-dialog.js';
import type { EngineHandle, GameEvent } from './types.js';

const STORY_PATH = '/story.dat';
const AUTOSAVE_PATH = '/saves/__autosave.qzl';

/**
 * Wires emglken's Bocfel (Z-machine, WASM) to our BridgeGlkOte/MemoryDialog behind the
 * EngineHandle contract from SPECS.md. Real Z-machine "autosave" isn't implemented
 * upstream (asyncglk/remglk-rs only have scaffolding for it) — `saveAutosave()` instead
 * drives the interpreter's own SAVE mechanism (Quetzal via Glk file I/O, which does
 * work end-to-end) silently in the background, and `start({autorestore: true})` drives
 * RESTORE the same way against a previously captured snapshot.
 */
export function createEngine(): EngineHandle {
  const listeners = new Set<(e: GameEvent) => void>();
  const dialog = new MemoryDialog();
  const glkote = new BridgeGlkOte((event) => {
    for (const listener of listeners) listener(event);
  });
  let started = false;

  function waitForInputRequest(): Promise<void> {
    return new Promise((resolve) => {
      const unsubscribe = glkote_on((event) => {
        if (event.kind === 'input_requested') {
          unsubscribe();
          resolve();
        }
      });
    });
  }

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
      vm.start({ arguments: [STORY_PATH], Dialog: dialog, GlkOte: glkote });

      if (hasAutosave) {
        await waitForInputRequest();
        dialog.setNextPromptPath(AUTOSAVE_PATH);
        glkote.sendCommand('restore');
      }
    },

    sendCommand(text) {
      glkote.sendCommand(text);
    },

    on(listener) {
      return glkote_on(listener);
    },

    async saveAutosave() {
      dialog.setNextPromptPath(AUTOSAVE_PATH);
      const written = dialog.waitForWrite(AUTOSAVE_PATH);
      glkote.sendCommand('save');
      return written;
    },

    async stop() {
      listeners.clear();
    },
  };
}
