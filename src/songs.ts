import { STRINGS_BY_ID } from "./strings";

export interface SongNote {
  stringId: string;
  /** Seconds from the start of the song. */
  startTime: number;
  /** Seconds; how long the string is left ringing before the next note. */
  duration: number;
  intensity: number;
}

export interface Song {
  id: string;
  title: string;
  source: string;
  notes: SongNote[];
}

function seq(bpm: number, entries: Array<[string, number, number]>): SongNote[] {
  const secondsPerBeat = 60 / bpm;
  let beat = 0;
  return entries.map(([stringId, beats, intensity]) => {
    const note: SongNote = {
      stringId,
      startTime: beat * secondsPerBeat,
      duration: beats * secondsPerBeat,
      intensity,
    };
    beat += beats;
    return note;
  });
}

// A natural-minor (no raised leading tone) simplification of the opening
// phrase, transposed to fit this harp's two natural-note octaves.
const GREENSLEEVES = seq(96, [
  ["A4", 1, 0.7],
  ["C5", 0.5, 0.6],
  ["D5", 0.5, 0.6],
  ["E5", 1, 0.75],
  ["F5", 0.5, 0.6],
  ["E5", 0.5, 0.6],
  ["D5", 1, 0.65],
  ["C5", 1, 0.6],
  ["A4", 1, 0.7],
  ["G4", 0.5, 0.55],
  ["A4", 0.5, 0.6],
  ["B4", 1, 0.65],
  ["C5", 1, 0.65],
  ["A4", 2, 0.7],
]);

// Pachelbel's Canon in D is built on a repeating eight-chord bass line. This
// plays that line transposed down a step, into C major, so every note is
// natural and playable on this harp — the melody above it is the student's
// (or the crit audience's) to add live.
const CANON_BASS: SongNote[] = (() => {
  const pattern = ["C4", "G4", "A4", "E4", "F4", "C4", "F4", "G4"];
  const notes: SongNote[] = [];
  const beatSeconds = 60 / 72;
  let t = 0;
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const stringId of pattern) {
      notes.push({ stringId, startTime: t, duration: beatSeconds * 0.95, intensity: 0.55 });
      t += beatSeconds;
    }
  }
  return notes;
})();

// An original arpeggio study in the baroque style (not a transcription of any
// specific piece) — up and down a C major arpeggio across both octaves.
const ARPEGGIO_STUDY = seq(120, [
  ["C4", 0.5, 0.55],
  ["E4", 0.5, 0.55],
  ["G4", 0.5, 0.6],
  ["C5", 0.5, 0.65],
  ["E5", 0.5, 0.65],
  ["G5", 0.5, 0.7],
  ["C5", 0.5, 0.65],
  ["G4", 0.5, 0.6],
  ["E4", 0.5, 0.55],
  ["C4", 1, 0.6],
]);

export const SONGS: Song[] = [
  {
    id: "greensleeves",
    title: "Greensleeves (opening phrase, simplified)",
    source: "Traditional English melody, 16th century — natural-minor arrangement",
    notes: GREENSLEEVES,
  },
  {
    id: "canon",
    title: "Canon in D — bass line (transposed to C)",
    source: "Johann Pachelbel, c. 1680 — bass ostinato only, transposed for natural strings",
    notes: CANON_BASS,
  },
  {
    id: "arpeggio",
    title: "Arpeggio study",
    source: "Original exercise in the baroque style",
    notes: ARPEGGIO_STUDY,
  },
];

// Fail fast in dev if a song references a string that doesn't exist on this
// harp — see spec/crit-4.test.ts for the same check as an automated test.
for (const song of SONGS) {
  for (const note of song.notes) {
    if (!STRINGS_BY_ID.has(note.stringId)) {
      throw new Error(`Song "${song.id}" references unknown string "${note.stringId}"`);
    }
  }
}
