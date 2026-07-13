/** gameId = sha256 of the story bytes, hex, first 16 chars (SPECS.md §4). */
export async function computeGameId(bytes: Uint8Array): Promise<string> {
  // Uint8Array.from() (not `.buffer`, not the input view directly): some SubtleCrypto
  // implementations (jsdom's polyfill, under Node 20 in CI) reject a detached `.buffer`
  // access as "not an instance of ArrayBuffer" even though it structurally is one — a
  // cross-realm instanceof quirk — and TypeScript's DOM lib won't accept a
  // Uint8Array<ArrayBufferLike> (possibly SharedArrayBuffer-backed) as BufferSource.
  // `Uint8Array.from()` always allocates a fresh, plain, non-shared buffer, satisfying
  // both.
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

const BLORB_MAGIC = [0x46, 0x4f, 0x52, 0x4d]; // "FORM"

export function detectFormat(bytes: Uint8Array): 'zcode' | 'blorb' {
  const isForm = BLORB_MAGIC.every((byte, i) => bytes[i] === byte);
  return isForm ? 'blorb' : 'zcode';
}
