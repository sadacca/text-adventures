/** UX-27: patterns that QUOTE the word a parser didn't understand — deliberately narrow
 *  so detection never guesses. Covers Infocom's classic 'I don't know the word "frotz".'
 *  and Inform 6/7 library variants. Inform's unquoted "You can't see any such thing"
 *  carries no word and is deliberately a miss. */
const PATTERNS = [
  /don't know the word "(\w+)"/i,
  /do not know the word "(\w+)"/i,
  /the word "(\w+)" (?:is not|isn't) (?:in your|necessary)/i,
];

/** Extracts the word a parser error says it didn't understand, or null. */
export function detectUnknownWord(text: string): string | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[1].toLowerCase();
  }
  return null;
}
