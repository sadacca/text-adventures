/** gameId = sha256 of the story bytes, hex, first 16 chars (SPECS.md §4). */
export async function computeGameId(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

const BLORB_MAGIC = [0x46, 0x4f, 0x52, 0x4d]; // "FORM"

export function detectFormat(bytes: Uint8Array): 'zcode' | 'blorb' {
  const isForm = BLORB_MAGIC.every((byte, i) => bytes[i] === byte);
  return isForm ? 'blorb' : 'zcode';
}
