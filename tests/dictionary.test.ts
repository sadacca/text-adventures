import { describe, expect, it } from 'vitest';
import { isVocabWord, parseVocabulary } from '../src/engine/dictionary';

/** Packs a raw z-char sequence into big-endian 16-bit words, 3 z-chars per word, top
 *  bit set on the final word (as real Z-machine text does, though dictionary decoding
 *  ignores that bit and just reads the fixed length). */
function packZchars(zchars: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < zchars.length; i += 3) {
    const isLastGroup = i + 3 >= zchars.length;
    const word16 =
      (zchars[i] << 10) | (zchars[i + 1] << 5) | zchars[i + 2] | (isLastGroup ? 0x8000 : 0);
    bytes.push((word16 >> 8) & 0xff, word16 & 0xff);
  }
  return bytes;
}

/** Packs a lowercase-only word into dictionary z-text (A0 chars 6-31, padded with
 *  z-char 5). zchars per entry: 6 (v3) or 9 (v4+). Returns 4 or 6 bytes. Words longer
 *  than `zchars` are truncated, matching real dictionary storage. */
function encodeWord(word: string, zchars: 6 | 9): number[] {
  const chars = [...word.toLowerCase()].map((ch) => ch.charCodeAt(0) - 'a'.charCodeAt(0) + 6);
  while (chars.length < zchars) chars.push(5);
  chars.length = zchars;
  return packZchars(chars);
}

/** Assembles a minimal story: 64-byte header (version byte at 0, dictionary address
 *  word at 0x08, alphabet-table word at 0x34 left 0), then the dictionary table (0
 *  separators, entries with zero data bytes beyond the encoded text itself). */
function buildStoryFromEntries(version: number, entries: number[][]): Uint8Array {
  const entryLength = entries[0]?.length ?? (version <= 3 ? 4 : 6);
  const headerSize = 0x40;
  const dictAddr = headerSize;
  const entriesStart = dictAddr + 4; // 1 (numSeparators) + 1 (entryLength) + 2 (count)
  const bytes = new Uint8Array(entriesStart + entries.length * entryLength);

  bytes[0] = version;
  bytes[0x08] = (dictAddr >> 8) & 0xff;
  bytes[0x09] = dictAddr & 0xff;

  bytes[dictAddr] = 0; // numSeparators
  bytes[dictAddr + 1] = entryLength;
  bytes[dictAddr + 2] = (entries.length >> 8) & 0xff;
  bytes[dictAddr + 3] = entries.length & 0xff;

  entries.forEach((entry, i) => {
    bytes.set(entry, entriesStart + i * entryLength);
  });

  return bytes;
}

function buildStory(version: number, words: string[]): Uint8Array {
  const zchars = version <= 3 ? 6 : 9;
  return buildStoryFromEntries(
    version,
    words.map((w) => encodeWord(w, zchars)),
  );
}

function asciiBytes(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function buildChunk(id: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(0);
  return concatBytes([asciiBytes(id), u32be(data.length), data, pad]);
}

/** Wraps story bytes in a minimal FORM/IFRS blorb with one odd-length junk chunk before
 *  the ZCOD chunk (exercises the pad-byte skip). */
function wrapInBlorb(storyBytes: Uint8Array): Uint8Array {
  const junkChunk = buildChunk('JUNK', new Uint8Array([1, 2, 3])); // odd length
  const zcodChunk = buildChunk('ZCOD', storyBytes);
  const ifrsAndBody = concatBytes([asciiBytes('IFRS'), junkChunk, zcodChunk]);
  return concatBytes([asciiBytes('FORM'), u32be(ifrsAndBody.length), ifrsAndBody]);
}

describe('parseVocabulary / isVocabWord', () => {
  it('v3: decodes words, truncates at 6 z-chars, and matches truncated lookups', () => {
    const story = buildStory(3, ['lamp', 'grate', 'xyzzy', 'lantern']);
    const vocab = parseVocabulary(story)!;
    expect(vocab).not.toBeNull();
    expect(vocab.truncationLength).toBe(6);
    expect(vocab.words).toEqual(new Set(['lamp', 'grate', 'xyzzy', 'lanter']));
    expect(isVocabWord('lantern', vocab)).toBe(true);
    expect(isVocabWord('Lamp', vocab)).toBe(true);
    expect(isVocabWord('lantic', vocab)).toBe(false);
  });

  it('v5: stores the full 9-z-char word untruncated', () => {
    const story = buildStory(5, ['lantern']);
    const vocab = parseVocabulary(story)!;
    expect(vocab.truncationLength).toBe(9);
    expect(vocab.words).toEqual(new Set(['lantern']));
  });

  it('filters stopwords and direction words', () => {
    const story = buildStory(3, ['the', 'north', 'sword']);
    const vocab = parseVocabulary(story)!;
    expect(vocab.words).toEqual(new Set(['sword']));
  });

  it('decodes a one-shot shift to A1 (pins the shift and lowercasing)', () => {
    // shift-A1, f->F, o, g, pad, pad — decodes to "Fog".
    const entry = packZchars([4, 11, 20, 12, 5, 5]);
    const story = buildStoryFromEntries(3, [entry]);
    const vocab = parseVocabulary(story)!;
    expect(vocab.words).toEqual(new Set(['fog']));
  });

  it('returns null (never throws) on a corrupt or unsupported story', () => {
    const wrongVersion = buildStory(1, ['lamp']);
    expect(() => parseVocabulary(wrongVersion)).not.toThrow();
    expect(parseVocabulary(wrongVersion)).toBeNull();

    const badAddress = buildStory(3, ['lamp']);
    badAddress[0x08] = 0xff;
    badAddress[0x09] = 0xff; // dictionary address way past the end of the bytes
    expect(() => parseVocabulary(badAddress)).not.toThrow();
    expect(parseVocabulary(badAddress)).toBeNull();

    const hugeCount = buildStory(3, ['lamp']);
    const dictAddr = 0x40;
    hugeCount[dictAddr + 2] = (30000 >> 8) & 0xff;
    hugeCount[dictAddr + 3] = 30000 & 0xff;
    expect(() => parseVocabulary(hugeCount)).not.toThrow();
    expect(parseVocabulary(hugeCount)).toBeNull();
  });

  it('unwraps a blorb (FORM/IFRS) to find the ZCOD chunk, skipping a junk chunk and its pad byte', () => {
    const story = buildStory(3, ['lamp', 'grate', 'xyzzy', 'lantern']);
    const blorb = wrapInBlorb(story);
    const vocab = parseVocabulary(blorb)!;
    expect(vocab.truncationLength).toBe(6);
    expect(vocab.words).toEqual(new Set(['lamp', 'grate', 'xyzzy', 'lanter']));
  });
});
