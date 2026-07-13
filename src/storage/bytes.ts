/** Copies a Uint8Array's bytes into a plain, non-shared ArrayBuffer for IndexedDB storage. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
