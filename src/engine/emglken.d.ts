// emglken ships no type declarations; this covers the minimal surface we use.
// Imported as a direct subpath (not the `emglken` barrel) so bundlers don't pull in
// every other interpreter's multi-MB wasm binary alongside the one we actually use.
declare module 'emglken/build/bocfel.js' {
  export interface EmglkenStartOptions {
    arguments: string[];
    Dialog: unknown;
    GlkOte: unknown;
  }

  export interface EmglkenEngine {
    start(options: EmglkenStartOptions): void;
  }

  const Bocfel: (moduleArg?: { wasmBinary?: ArrayBuffer }) => Promise<EmglkenEngine>;
  export default Bocfel;
}
