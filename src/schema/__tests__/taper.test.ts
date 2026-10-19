import { describe, expect, it } from '@jest/globals';

import { EFFECTS } from '../effects';
import { GENERATORS } from '../generators';
import {
  InvalidTaperError,
  clamp,
  fromNormalized,
  nudge,
  quantize,
  toNormalized,
} from '../taper';
import type { ParamDescriptor } from '../types';

/** Every parameter in the library, effects and generators alike. */
const ALL_PARAMS: ParamDescriptor[] = [
  ...EFFECTS.flatMap((effect) => effect.params),
  ...GENERATORS.flatMap((generator) => generator.params),
];

const CONTINUOUS = ALL_PARAMS.filter((param) => param.taper !== 'stepped');

describe('clamp', () => {
  it('bounds values to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('taper round-trips', () => {
  const positions = [0, 0.001, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1];

  it.each(CONTINUOUS.map((param) => [param.key, param] as const))(
    'normalised -> value -> normalised is identity for %s',
    (_key, param) => {
      for (const t of positions) {
        expect(toNormalized(param, fromNormalized(param, t))).toBeCloseTo(t, 9);
      }
    }
  );

  it.each(CONTINUOUS.map((param) => [param.key, param] as const))(
    'value -> normalised -> value is identity for %s',
    (_key, param) => {
      for (const t of positions) {
        const value = fromNormalized(param, t);
        expect(fromNormalized(param, toNormalized(param, value))).toBeCloseTo(
          value,
          6
        );
      }
    }
  );
});

describe('taper endpoints', () => {
  it.each(ALL_PARAMS.map((param) => [param.key, param] as const))(
    'maps 0 and 1 to min and max for %s',
    (_key, param) => {
      expect(fromNormalized(param, 0)).toBeCloseTo(param.min, 9);
      expect(fromNormalized(param, 1)).toBeCloseTo(param.max, 9);
    }
  );

  it.each(ALL_PARAMS.map((param) => [param.key, param] as const))(
    'clamps out-of-range input for %s',
    (_key, param) => {
      expect(fromNormalized(param, -1)).toBeCloseTo(param.min, 9);
      expect(fromNormalized(param, 2)).toBeCloseTo(param.max, 9);
      expect(toNormalized(param, param.min - 1000)).toBe(0);
      expect(toNormalized(param, param.max + 1000)).toBe(1);
    }
  );
});

describe('taper shape', () => {
  it('gives a log taper equal travel per octave', () => {
    // 20 Hz..20 kHz is ~9.97 octaves; the midpoint should land near 632 Hz,
    // the geometric mean — not the arithmetic mean of 10010 Hz.
    const param: ParamDescriptor = {
      key: 'cutoff',
      label: 'Cutoff',
      min: 20,
      max: 20000,
      default: 1000,
      unit: 'Hz',
      taper: 'log',
    };
    expect(fromNormalized(param, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 6);
  });

  it('biases an exp taper toward the low end when skew > 1', () => {
    const param: ParamDescriptor = {
      key: 'ratio',
      label: 'Ratio',
      min: 1,
      max: 21,
      default: 4,
      unit: ':1',
      taper: 'exp',
      skew: 2,
    };
    // t^2 at the midpoint is 0.25 of the range, not 0.5.
    expect(fromNormalized(param, 0.5)).toBeCloseTo(1 + 20 * 0.25, 9);
  });

  it('treats a missing skew as linear', () => {
    const param: ParamDescriptor = {
      key: 'x',
      label: 'X',
      min: 0,
      max: 10,
      default: 0,
      unit: '',
      taper: 'exp',
    };
    expect(fromNormalized(param, 0.5)).toBeCloseTo(5, 9);
  });

  it('rejects a log taper over a range that includes zero', () => {
    const param: ParamDescriptor = {
      key: 'bad',
      label: 'Bad',
      min: 0,
      max: 100,
      default: 0,
      unit: 'Hz',
      taper: 'log',
    };
    expect(() => fromNormalized(param, 0.5)).toThrow(InvalidTaperError);
  });
});

describe('stepped parameters', () => {
  const stepped = ALL_PARAMS.filter((param) => param.taper === 'stepped');

  it('covers at least the phaser stages and bit depth', () => {
    expect(stepped.length).toBeGreaterThanOrEqual(2);
  });

  it.each(stepped.map((param) => [param.key, param] as const))(
    'only ever produces a declared step for %s',
    (_key, param) => {
      for (let t = 0; t <= 1.0001; t += 0.01) {
        expect(param.steps).toContain(fromNormalized(param, t));
      }
    }
  );

  it.each(stepped.map((param) => [param.key, param] as const))(
    'snaps arbitrary values onto the grid for %s',
    (_key, param) => {
      const steps = param.steps!;
      for (const step of steps) {
        expect(quantize(param, step + 0.1)).toBe(
          // +0.1 should still resolve to the same step unless the grid is
          // finer than that, in which case the nearest neighbour wins.
          steps.reduce((best, candidate) =>
            Math.abs(candidate - (step + 0.1)) < Math.abs(best - (step + 0.1))
              ? candidate
              : best
          )
        );
      }
    }
  );

  it('throws when a stepped parameter declares no steps', () => {
    const param: ParamDescriptor = {
      key: 'bad',
      label: 'Bad',
      min: 0,
      max: 1,
      default: 0,
      unit: '',
      taper: 'stepped',
    };
    expect(() => fromNormalized(param, 0.5)).toThrow(InvalidTaperError);
  });
});

describe('quantize', () => {
  it.each(ALL_PARAMS.map((param) => [param.key, param] as const))(
    'keeps the default value unchanged for %s',
    (_key, param) => {
      // A default that quantize would move is a schema bug: the UI would jump
      // away from it the moment the control is touched.
      expect(quantize(param, param.default)).toBeCloseTo(param.default, 9);
    }
  );
});

describe('nudge', () => {
  it('moves a continuous parameter by 1% of normalised travel', () => {
    const param: ParamDescriptor = {
      key: 'mix',
      label: 'Mix',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
    };
    expect(nudge(param, 0.5, 1)).toBeCloseTo(0.51, 9);
    expect(nudge(param, 0.5, -1)).toBeCloseTo(0.49, 9);
    expect(nudge(param, 0.5, 1, true)).toBeCloseTo(0.6, 9);
  });

  it('stops at the ends of the range', () => {
    const param: ParamDescriptor = {
      key: 'mix',
      label: 'Mix',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
    };
    expect(nudge(param, 1, 1)).toBeCloseTo(1, 9);
    expect(nudge(param, 0, -1)).toBeCloseTo(0, 9);
  });

  it('moves a stepped parameter one step at a time', () => {
    const param: ParamDescriptor = {
      key: 'stages',
      label: 'Stages',
      min: 2,
      max: 12,
      default: 4,
      unit: '',
      taper: 'stepped',
      steps: [2, 4, 6, 8, 10, 12],
    };
    expect(nudge(param, 4, 1)).toBe(6);
    expect(nudge(param, 4, -1)).toBe(2);
    expect(nudge(param, 12, 1)).toBe(12);
    expect(nudge(param, 2, -1)).toBe(2);
  });
});
