// The single source of truth for every string on the harp. The 3D model, the
// keyboard-map panel, the accessible DOM buttons, the synth's frequencies and
// the demo songs all read from this array — nothing hard-codes a note twice.
export interface HarpString {
  id: string;
  key: string;
  note: string;
  octave: 4 | 5;
  frequency: number;
  color: string;
  /** 0 (lowest/longest string) .. 1 (highest/shortest), left to right on the frame. */
  position: number;
}

const IVORY = "#e9ddc0";
const RED = "#8c2f39"; // C strings: the harpist's landmark colour
const BLUE = "#1f3a5f"; // F strings: the other landmark colour

// Two natural-note octaves: A S D F G H J -> C4..B4, Q W E R T Y U -> C5..B5.
const OCTAVE_4: Array<[string, string, number]> = [
  ["A", "C", 261.63],
  ["S", "D", 293.66],
  ["D", "E", 329.63],
  ["F", "F", 349.23],
  ["G", "G", 392.0],
  ["H", "A", 440.0],
  ["J", "B", 493.88],
];

const OCTAVE_5: Array<[string, string, number]> = [
  ["Q", "C", 523.25],
  ["W", "D", 587.33],
  ["E", "E", 659.25],
  ["R", "F", 698.46],
  ["T", "G", 783.99],
  ["Y", "A", 880.0],
  ["U", "B", 987.77],
];

function colorFor(note: string): string {
  if (note === "C") return RED;
  if (note === "F") return BLUE;
  return IVORY;
}

function buildStrings(): HarpString[] {
  const rows: Array<{ entries: Array<[string, string, number]>; octave: 4 | 5 }> = [
    { entries: OCTAVE_4, octave: 4 },
    { entries: OCTAVE_5, octave: 5 },
  ];
  const strings: HarpString[] = [];
  const total = OCTAVE_4.length + OCTAVE_5.length;
  let index = 0;
  for (const { entries, octave } of rows) {
    for (const [key, note, frequency] of entries) {
      strings.push({
        id: `${note}${octave}`,
        key,
        note,
        octave,
        frequency,
        color: colorFor(note),
        position: total === 1 ? 0 : index / (total - 1),
      });
      index++;
    }
  }
  return strings;
}

/** All 14 strings, low to high, in playing order. */
export const STRINGS: HarpString[] = buildStrings();

export const STRINGS_BY_ID = new Map(STRINGS.map((s) => [s.id, s]));
export const STRINGS_BY_KEY = new Map(STRINGS.map((s) => [s.key, s]));

export const DAMP_ALL_KEY = " ";
