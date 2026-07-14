/**
 * Task 1.7 verb chip config. `needsObject: false` verbs send immediately on tap (they're
 * complete commands on their own); `needsObject: true` verbs insert the verb + a
 * trailing space into the draft (without opening the keyboard), so the next tap (a chip
 * or a tapped word from the story text) supplies the object.
 */
export interface VerbConfig {
  label: string;
  command: string;
  needsObject: boolean;
}

export const VERBS: VerbConfig[] = [
  { label: 'Look', command: 'look', needsObject: false },
  { label: 'Take', command: 'take', needsObject: true },
  { label: 'Drop', command: 'drop', needsObject: true },
  { label: 'Open', command: 'open', needsObject: true },
  { label: 'Examine', command: 'examine', needsObject: true },
  { label: 'Inventory', command: 'inventory', needsObject: false },
  { label: 'Wait', command: 'wait', needsObject: false },
  { label: 'Again', command: 'again', needsObject: false },
];
