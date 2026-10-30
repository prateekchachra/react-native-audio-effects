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

/** Semitones in an octave, which is also the root taken in equal temperament. */
export const SEMITONES_PER_OCTAVE = 12;

/**
 * The 88 keys of a piano, A0 to C8.
 *
 * Exported because this is the range anything pitched is laid out
 * against — the keyboard draws it, and the scope spreads its scroll
 * speed across it. Two copies of these numbers would be two things to
 * keep in step.
 */
export const PIANO_LOWEST = 21;
export const PIANO_HIGHEST = 108;

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

/** Shift a frequency by a number of cents. 100 cents is one semitone. */
export function detune(hz: number, cents: number): number {
  return hz * Math.pow(2, cents / 1200);
}

/**
 * Detune offsets for a unison stack, in cents.
 *
 * Spread symmetrically about the centre, so the stack stays in tune with
 * itself. An odd count keeps one voice exactly on pitch, which is what stops
 * a unison patch sounding flat or sharp overall.
 */
export function unisonOffsets(voices: number, spreadCents: number): number[] {
  if (voices <= 1) {
    return [0];
  }
  const offsets: number[] = [];
  const step = spreadCents / (voices - 1);
  for (let i = 0; i < voices; i++) {
    offsets.push(-spreadCents / 2 + step * i);
  }
  return offsets;
}

/**
 * Stereo positions for a unison stack, -1 to 1.
 *
 * Spread symmetrically like the detune offsets, and paired with them by
 * index, so the voice that is flattest also sits furthest left. That
 * correlation is what makes a detuned stack read as *wide* rather than
 * just unstable — the beating between voices resolves across the stereo
 * field instead of piling up in the middle.
 *
 * @param width 0 stacks everything centre, 1 pushes the outer pair hard
 *   left and right.
 */
export function unisonPans(voices: number, width: number): number[] {
  const clamped = Math.min(1, Math.max(0, width));
  if (voices <= 1) {
    return [0];
  }
  const pans: number[] = [];
  const step = 2 / (voices - 1);
  for (let i = 0; i < voices; i++) {
    // `+ 0` normalises negative zero, which a zero width would otherwise
    // produce for the left half of the stack.
    pans.push((-1 + step * i) * clamped + 0);
  }
  return pans;
}
