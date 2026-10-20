import { describe, expect, it } from '@jest/globals';

import {
  detune,
  frequencyToMidi,
  isBlackKey,
  midiToFrequency,
  noteName,
  octaveStart,
  unisonOffsets,
  unisonPans,
} from '../music';

/** Cents of error between two frequencies. */
function centsApart(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}

describe('midiToFrequency', () => {
  it('puts A4 at the tuning reference', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 10);
  });

  it('doubles every octave', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 10);
    expect(midiToFrequency(57)).toBeCloseTo(220, 10);
  });

  it('honours an alternative reference pitch', () => {
    expect(midiToFrequency(69, 432)).toBeCloseTo(432, 10);
  });

  it('round-trips through frequencyToMidi across the keyboard', () => {
    for (let midi = 21; midi <= 108; midi++) {
      expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 8);
    }
  });

  it('treats a non-positive frequency as note zero rather than returning NaN', () => {
    expect(frequencyToMidi(0)).toBe(0);
    expect(frequencyToMidi(-5)).toBe(0);
  });
});

describe('noteName', () => {
  it.each([
    [21, 'A0'],
    [60, 'C4'],
    [69, 'A4'],
    [108, 'C8'],
  ])('names %i as %s', (midi, expected) => {
    expect(noteName(midi)).toBe(expected);
  });

  it('agrees with octaveStart', () => {
    for (let octave = 0; octave <= 8; octave++) {
      expect(noteName(octaveStart(octave))).toBe(`C${octave}`);
    }
  });
});

describe('isBlackKey', () => {
  it('finds five black keys in every octave', () => {
    const start = octaveStart(4);
    const black = Array.from({ length: 12 }, (_, i) => isBlackKey(start + i));
    expect(black.filter(Boolean)).toHaveLength(5);
  });

  it('puts them on the sharps', () => {
    expect(noteName(61)).toContain('#');
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(60)).toBe(false);
  });
});

describe('detune', () => {
  it('moves a semitone for 100 cents', () => {
    expect(detune(440, 100)).toBeCloseTo(midiToFrequency(70), 8);
  });

  it('is symmetric', () => {
    expect(detune(detune(440, 37), -37)).toBeCloseTo(440, 8);
  });
});

describe('unisonOffsets', () => {
  it('returns a single centred voice below two', () => {
    expect(unisonOffsets(1, 20)).toEqual([0]);
    expect(unisonOffsets(0, 20)).toEqual([0]);
  });

  it('spans exactly the requested spread', () => {
    const offsets = unisonOffsets(7, 24);
    expect(offsets[0]).toBeCloseTo(-12, 10);
    expect(offsets[offsets.length - 1]).toBeCloseTo(12, 10);
  });

  it('stays centred on the note, so the stack is not sharp or flat overall', () => {
    for (const voices of [2, 3, 4, 5, 8]) {
      const offsets = unisonOffsets(voices, 18);
      const sum = offsets.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(0, 10);
    }
  });

  it('leaves one voice exactly on pitch for an odd count', () => {
    expect(unisonOffsets(5, 30)).toContain(0);
  });

  it('produces detunes within the spread of the centre frequency', () => {
    const offsets = unisonOffsets(4, 20);
    for (const cents of offsets) {
      expect(centsApart(detune(440, cents), 440)).toBeLessThanOrEqual(10.0001);
    }
  });
});

describe('unisonPans', () => {
  it('centres a single voice', () => {
    expect(unisonPans(1, 1)).toEqual([0]);
  });

  it('stacks everything in the centre at zero width', () => {
    expect(unisonPans(5, 0)).toEqual([0, 0, 0, 0, 0]);
  });

  it('pushes the outer pair hard left and right at full width', () => {
    const pans = unisonPans(4, 1);
    expect(pans[0]).toBeCloseTo(-1, 10);
    expect(pans[pans.length - 1]).toBeCloseTo(1, 10);
  });

  it('balances, so a stack does not pull to one side', () => {
    for (const voices of [2, 3, 6, 9]) {
      const sum = unisonPans(voices, 0.8).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(0, 10);
    }
  });

  it('stays inside the legal pan range for any width', () => {
    for (const width of [-1, 0, 0.3, 1, 5]) {
      for (const pan of unisonPans(8, width)) {
        expect(pan).toBeGreaterThanOrEqual(-1);
        expect(pan).toBeLessThanOrEqual(1);
      }
    }
  });

  it('scales linearly with width', () => {
    const half = unisonPans(5, 0.5);
    const full = unisonPans(5, 1);
    half.forEach((pan, index) => {
      expect(pan).toBeCloseTo((full[index] ?? 0) / 2, 10);
    });
  });

  it('pairs with the detune offsets, so the flattest voice sits furthest left', () => {
    const voices = 7;
    const offsets = unisonOffsets(voices, 24);
    const pans = unisonPans(voices, 1);

    expect(pans).toHaveLength(offsets.length);
    // Both arrays ascend, which is what keeps the two spreads correlated.
    for (let i = 1; i < voices; i++) {
      expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
      expect(pans[i]!).toBeGreaterThan(pans[i - 1]!);
    }
  });
});
