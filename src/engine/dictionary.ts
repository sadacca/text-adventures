/**
 * UX-19: parses the parser dictionary out of Z-machine story bytes (bare z-code or a
 * blorb wrapper), so the transcript can bold words the game's parser actually
 * understands. Pure byte-reading, no WASM, no DOM — this file's named exception to the
 * `src/engine/` "no imports from the rest of src/engine/" rule. Format references:
 * Z-Machine Standards Document 1.1, §13 (dictionary) and §3 (text encoding).
 */

export interface Vocabulary {
  /** Lowercased dictionary words, already stopword-/direction-filtered. */
  words: Set<string>;
  /** Stored dictionary words are truncated to this many Z-characters: 6 in v1-3 files, 9
   *  in v4+. Used for prefix matching ("lantern" -> stored "lanter"). */
  truncationLength: 6 | 9;
}

/** Function words, parser verbs already covered by chips, and direction words already
 *  covered by the exits row/compass — highlighting these would make the whole
 *  transcript bold. (Direction aliases duplicated from src/map/directions.ts rather
 *  than imported: that module is a verified subsystem this task must not modify, and
 *  its ALIASES table is deliberately not exported.) */
const VOCAB_STOPWORDS = new Set([
  // articles, determiners, pronouns
  'a',
  'an',
  'the',
  'all',
  'some',
  'any',
  'this',
  'that',
  'these',
  'those',
  'each',
  'every',
  'both',
  'other',
  'it',
  'its',
  'me',
  'my',
  'you',
  'your',
  'he',
  'him',
  'his',
  'she',
  'her',
  'they',
  'them',
  'their',
  'we',
  'us',
  'our',
  'itself',
  'myself',
  'yourself',
  'one',
  'ones',
  // prepositions, conjunctions, adverbs
  'at',
  'of',
  'to',
  'for',
  'from',
  'with',
  'without',
  'into',
  'onto',
  'under',
  'over',
  'behind',
  'above',
  'below',
  'across',
  'through',
  'about',
  'around',
  'between',
  'beside',
  'near',
  'and',
  'or',
  'but',
  'not',
  'if',
  'then',
  'when',
  'while',
  'as',
  'so',
  'than',
  'too',
  'very',
  'here',
  'there',
  'now',
  'again',
  'off',
  'on',
  'yes',
  'no',
  'oh',
  'please',
  // auxiliaries and parser verbs the chips already cover
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'am',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'go',
  'get',
  'put',
  'look',
  'take',
  'drop',
  'open',
  'close',
  'examine',
  'inventory',
  'wait',
  'say',
  'tell',
  'ask',
  'give',
  'read',
  'search',
  'quit',
  'save',
  'restore',
  'restart',
  'verbose',
  'brief',
  'score',
  // directions (mirror of directions.ts ALIASES, plus bare abbreviations)
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
  'u',
  'd',
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'up',
  'down',
  'in',
  'out',
  'enter',
  'exit',
  'leave',
]);

const VOCAB_WORD_PATTERN = /^[a-z][a-z'-]+$/;

const DEFAULT_A0 = 'abcdefghijklmnopqrstuvwxyz';
const DEFAULT_A1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Codes 8-31 (24 chars); codes 6-7 are the ZSCII-escape/newline specials handled inline. */
const DEFAULT_A2 = '0123456789.,!?_#\'"/\\-:()';

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Signed 16-bit big-endian read (dictionary entry count: negative means "unsorted"). */
function readI16BE(bytes: Uint8Array, offset: number): number {
  const u = readU16BE(bytes, offset);
  return u > 0x7fff ? u - 0x10000 : u;
}

/**
 * Unwraps a blorb (`FORM`/`IFRS`) to its `ZCOD` chunk's bytes, walking the IFF chunk
 * list; returns the bytes unchanged if they're not a blorb at all; returns null if
 * they're a blorb with no `ZCOD` chunk or a truncated/corrupt chunk list.
 */
function extractStoryBytes(bytes: Uint8Array): Uint8Array | null {
  const isForm =
    bytes.length >= 12 &&
    bytes[0] === 0x46 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x52 &&
    bytes[3] === 0x4d; // "FORM"
  const isIfrs =
    isForm && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x52 && bytes[11] === 0x53; // "IFRS"
  if (!isForm || !isIfrs) return bytes;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const length = readU32BE(bytes, offset + 4);
    const dataStart = offset + 8;
    if (length < 0 || dataStart + length > bytes.length) return null;
    if (id === 'ZCOD') return bytes.slice(dataStart, dataStart + length);
    offset = dataStart + length + (length % 2 === 1 ? 1 : 0);
  }
  return null;
}

function zsciiToAscii(zscii: number): string | null {
  return zscii >= 32 && zscii <= 126 ? String.fromCharCode(zscii) : null;
}

/** Resolves one z-char (6-31) to a character in the given alphabet, honoring a custom
 *  v5+ alphabet table when present. Never called for A2 codes 6/7 (escape/newline) —
 *  those stay hardcoded regardless of a custom table, per the standard. */
function alphabetChar(code: number, alphabet: 0 | 1 | 2, table: Uint8Array | null): string | null {
  if (table) return zsciiToAscii(table[alphabet * 26 + (code - 6)]);
  if (alphabet === 0) return DEFAULT_A0[code - 6] ?? null;
  if (alphabet === 1) return DEFAULT_A1[code - 6] ?? null;
  return DEFAULT_A2[code - 8] ?? null;
}

/**
 * Decodes one fixed-length dictionary entry's Z-text into a lowercase string, or null
 * if it contains anything a dictionary word legitimately never does (an abbreviation
 * escape, an out-of-range ZSCII code). `byteCount` is 4 (v3, 6 z-chars) or 6 (v4+, 9
 * z-chars) — always decodes the full fixed length, ignoring the string-end top bit
 * (dictionary text has no early terminator).
 */
function decodeDictionaryWord(
  story: Uint8Array,
  start: number,
  byteCount: number,
  alphabetTable: Uint8Array | null,
): string | null {
  const zchars: number[] = [];
  for (let i = 0; i < byteCount; i += 2) {
    const word = readU16BE(story, start + i);
    zchars.push((word >> 10) & 0x1f, (word >> 5) & 0x1f, word & 0x1f);
  }

  let result = '';
  const alphabet: 0 | 1 | 2 = 0; // one-shot shifts only; base alphabet never changes
  let oneShot: 1 | 2 | null = null;

  for (let i = 0; i < zchars.length; i++) {
    const z = zchars[i];
    const current = oneShot ?? alphabet;
    oneShot = null;

    if (z === 0) {
      result += ' ';
      continue;
    }
    if (z >= 1 && z <= 3) return null; // abbreviation escape: never legitimate here
    if (z === 4) {
      oneShot = 1;
      continue;
    }
    if (z === 5) {
      oneShot = 2;
      continue;
    }

    if (current === 2 && z === 6) {
      // ZSCII escape: next two z-chars form a 10-bit ZSCII code (first = top 5 bits).
      const hi = zchars[i + 1];
      const lo = zchars[i + 2];
      if (hi === undefined || lo === undefined) return null;
      i += 2;
      const ascii = zsciiToAscii((hi << 5) | lo);
      if (ascii == null) return null;
      result += ascii;
      continue;
    }
    if (current === 2 && z === 7) {
      result += '\n';
      continue;
    }

    const ch = alphabetChar(z, current, alphabetTable);
    if (ch == null) return null;
    result += ch;
  }

  return result.toLowerCase();
}

/** Parses the parser dictionary out of Z-machine story bytes (bare z-code or a blorb
 *  wrapper). Returns null — never throws — on anything unparseable: wrong version,
 *  truncated file, out-of-range addresses. Callers treat null as "feature off". */
export function parseVocabulary(bytes: Uint8Array): Vocabulary | null {
  try {
    const story = extractStoryBytes(bytes);
    if (!story || story.length < 0x40) return null;

    const version = story[0];
    if (version < 3 || version > 8) return null;
    const truncationLength: 6 | 9 = version <= 3 ? 6 : 9;
    const entryTextBytes = version <= 3 ? 4 : 6;

    let alphabetTable: Uint8Array | null = null;
    if (version >= 5) {
      const altAddr = readU16BE(story, 0x34);
      if (altAddr !== 0) {
        if (altAddr + 78 > story.length) return null;
        alphabetTable = story.slice(altAddr, altAddr + 78);
      }
    }

    const dictAddr = readU16BE(story, 0x08);
    if (dictAddr + 1 > story.length) return null;
    const numSeparators = story[dictAddr];
    let pos = dictAddr + 1 + numSeparators;

    if (pos + 1 > story.length) return null;
    const entryLength = story[pos];
    pos += 1;
    const minEntryLength = version <= 3 ? 4 : 6;
    if (entryLength < minEntryLength) return null;

    if (pos + 2 > story.length) return null;
    const count = Math.abs(readI16BE(story, pos));
    pos += 2;
    if (count === 0 || count > 20000) return null;
    if (pos + count * entryLength > story.length) return null;

    const words = new Set<string>();
    for (let i = 0; i < count; i++) {
      const entryStart = pos + i * entryLength;
      const word = decodeDictionaryWord(story, entryStart, entryTextBytes, alphabetTable);
      if (word && VOCAB_WORD_PATTERN.test(word) && !VOCAB_STOPWORDS.has(word)) {
        words.add(word);
      }
    }

    return { words, truncationLength };
  } catch {
    return null;
  }
}

/** True when `word` (any case) is in the game's vocabulary, including the
 *  truncated-storage case: "lantern" matches a stored "lanter" in a v3 game.
 *  Approximation: truncation is measured in Z-characters, not letters, so words with
 *  non-a-z characters can be truncated earlier than `truncationLength` — those rare
 *  cases just miss the highlight, which is fine. */
export function isVocabWord(word: string, vocab: Vocabulary): boolean {
  const lower = word.toLowerCase();
  return (
    vocab.words.has(lower) ||
    (lower.length > vocab.truncationLength &&
      vocab.words.has(lower.slice(0, vocab.truncationLength)))
  );
}
