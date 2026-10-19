/**
 * Note and pitch helpers.
 *
 * Oscillators are driven in hertz, but anything musical is thought about in
 * notes, so the conversion lives here next to the rest of the schema rather
 * than being reinvented in each app.
 */

/** MIDI note 69 is A4, the tuning reference. */
const A4_MIDI = 69;
const A4_HZ = 440;

const SHARP_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

/** Semitone offsets within an octave that are black keys. */
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

/**
 * MIDI note number to frequency in hertz.
 *
 * Equal temperament: every semitone is a factor of 2^(1/12), so an octave
 * doubles.
 *
 * @param tuning reference pitch for A4; 432 and 415 both see real use.
 */
export function midiToFrequency(midi: number, tuning = A4_HZ): number {
  return tuning * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Frequency in hertz to the nearest MIDI note number (may be fractional). */
export function frequencyToMidi(hz: number, tuning = A4_HZ): number {
  if (hz <= 0) {
    return 0;
  }
  return A4_MIDI + 12 * Math.log2(hz / tuning);
}

/** `60` → `"C4"`. Octave numbering is scientific pitch notation. */
export function noteName(midi: number): string {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${SHARP_NAMES[pitchClass]}${octave}`;
}

/** Whether a MIDI note falls on a black key. */
export function isBlackKey(midi: number): boolean {
  return BLACK_KEYS.has(((Math.round(midi) % 12) + 12) % 12);
}

/** Lowest MIDI note of an octave in scientific pitch notation. `4` → `60`. */
export function octaveStart(octave: number): number {
  return (octave + 1) * 12;
}
