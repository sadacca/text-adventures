import type {
  AsyncDialog,
  DialogDirectories,
  DialogOptions,
} from '../upstream/asyncglk-dist/index-common.js';

/**
 * Minimal in-memory AsyncDialog for emglken/asyncglk's Glk file I/O.
 *
 * The interpreter treats file access (storyfile read, SAVE/RESTORE via Quetzal) as
 * ordinary fopen/fread/fwrite calls that get bridged here. There is no real file-picker
 * UI: `prompt()` always resolves to a deterministic path, either one the engine set via
 * `setNextPromptPath` (for a programmatically-triggered SAVE/RESTORE) or a default.
 * Durable persistence (IndexedDB) is layered on top by the storage/autosave code, which
 * reads bytes back out via `waitForWrite`/`preload` rather than this class touching
 * IndexedDB itself. When neither `setNextPromptPath` nor `onNamedPrompt` apply, `prompt()`
 * falls back to a fixed default path so headless/spike use still works with no UI wired.
 */
export class MemoryDialog implements AsyncDialog {
  readonly async = true as const;

  private files = new Map<string, Uint8Array>();
  private dirs: DialogDirectories = { storyfile: '/', system_cwd: '/', temp: '/tmp', working: '/' };
  private nextPromptPath: string | null = null;
  private writeWaiters = new Map<string, ((bytes: Uint8Array) => void)[]>();
  private namedPromptHandler:
    ((extension: string, save: boolean) => Promise<string | null>) | null = null;
  private writeObservers: ((path: string, bytes: Uint8Array) => void)[] = [];

  async init(_options: DialogOptions): Promise<void> {}

  get_dirs(): DialogDirectories {
    return this.dirs;
  }

  set_storyfile_dir(path: string): Partial<DialogDirectories> {
    const slash = path.lastIndexOf('/');
    const dir = slash > 0 ? path.slice(0, slash) : '/';
    this.dirs.storyfile = dir;
    return { storyfile: dir };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    return (this.files.get(path) as Uint8Array<ArrayBuffer> | undefined) ?? null;
  }

  async write(files: Record<string, Uint8Array>): Promise<void> {
    for (const [path, bytes] of Object.entries(files)) {
      // Copy out of the Emscripten heap view: `bytes` may alias WASM linear memory,
      // which later interpreter execution can overwrite or reallocate in place.
      const copy = bytes.slice();
      this.files.set(path, copy);
      const waiters = this.writeWaiters.get(path);
      if (waiters) {
        this.writeWaiters.delete(path);
        for (const resolve of waiters) resolve(copy);
      }
      for (const observer of this.writeObservers) observer(path, copy);
    }
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async prompt(extension: string, save: boolean): Promise<string | null> {
    if (this.nextPromptPath) {
      const path = this.nextPromptPath;
      this.nextPromptPath = null;
      return path;
    }
    if (this.namedPromptHandler) {
      return this.namedPromptHandler(extension, save);
    }
    return `/saves/default.${extension}`;
  }

  /**
   * Handles a fileref prompt that wasn't pre-set via `setNextPromptPath` — i.e. one
   * triggered by the player typing SAVE/RESTORE themselves, not our silent autosave.
   */
  setNamedPromptHandler(
    handler: (extension: string, save: boolean) => Promise<string | null>,
  ): void {
    this.namedPromptHandler = handler;
  }

  /** Notified for every completed write, with its final (post-copy) bytes. */
  onWrite(observer: (path: string, bytes: Uint8Array) => void): void {
    this.writeObservers.push(observer);
  }

  /** Preload bytes at a path so a subsequent RESTORE-style read gets them back. */
  preload(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes.slice());
  }

  /**
   * Force the next fileref prompt (triggered by an in-game SAVE/RESTORE command) to
   * resolve to this exact path, skipping the (nonexistent) file-picker UI.
   */
  setNextPromptPath(path: string): void {
    this.nextPromptPath = path;
  }

  /** Resolves the next time `write()` is called for this path (captures a SAVE's bytes). */
  waitForWrite(path: string): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const waiters = this.writeWaiters.get(path) ?? [];
      waiters.push(resolve);
      this.writeWaiters.set(path, waiters);
    });
  }
}
