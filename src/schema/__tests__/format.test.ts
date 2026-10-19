import { describe, expect, it } from '@jest/globals';

import { DELAY, EFFECTS, LOW_PASS_FILTER } from '../effects';
import { formatNumber, formatValue, unitLabel } from '../format';
import { GENERATORS } from '../generators';
import type { ParamDescriptor } from '../types';

const param = (overrides: Partial<ParamDescriptor>): ParamDescriptor => ({
  key: 'x',
  label: 'X',
  min: 0,
  max: 100,
  default: 0,
  unit: '',
  taper: 'linear',
  ...overrides,
});

describe('formatValue', () => {
  it('flips hertz to kilohertz above 1000', () => {
    const cutoff = LOW_PASS_FILTER.params[0]!;
    expect(formatValue(cutoff, 440)).toBe('440 Hz');
    expect(formatValue(cutoff, 999)).toBe('999 Hz');
    expect(formatValue(cutoff, 1000)).toBe('1.0 kHz');
    expect(formatValue(cutoff, 15000)).toBe('15.0 kHz');
  });

  it('flips milliseconds to seconds above 1000', () => {
    const time = DELAY.params[0]!;
    expect(formatValue(time, 250)).toBe('250 ms');
    expect(formatValue(time, 1500)).toBe('1.50 s');
  });

  it('flips seconds to milliseconds below 1', () => {
    const p = param({ unit: 's', max: 10 });
    expect(formatValue(p, 0.25)).toBe('250 ms');
    expect(formatValue(p, 2.5)).toBe('2.50 s');
  });

  it('signs decibel values so boost reads differently from cut', () => {
    const p = param({ unit: 'dB', min: -24, max: 24 });
    expect(formatValue(p, 6)).toBe('+6.0 dB');
    expect(formatValue(p, -6)).toBe('-6.0 dB');
    expect(formatValue(p, 0)).toBe('0.0 dB');
  });

  it('scales normalised percentages to 0-100', () => {
    const p = param({ unit: '%', min: 0, max: 1 });
    expect(formatValue(p, 0)).toBe('0%');
    expect(formatValue(p, 0.42)).toBe('42%');
    expect(formatValue(p, 1)).toBe('100%');
  });

  it('formats ratios, octaves, bits and multipliers', () => {
    expect(formatValue(param({ unit: ':1', max: 20 }), 4)).toBe('4.0:1');
    expect(formatValue(param({ unit: 'oct', max: 4 }), 1.5)).toBe('1.50 oct');
    expect(formatValue(param({ unit: 'bit', max: 16 }), 8)).toBe('8 bit');
    expect(formatValue(param({ unit: 'x', max: 4 }), 2)).toBe('2.00x');
  });

  it('honours an explicit precision', () => {
    const p = param({ unit: 'dB', min: -24, max: 24, precision: 2 });
    expect(formatValue(p, 6)).toBe('+6.00 dB');
  });
});

describe('unitLabel', () => {
  it('tracks the same flips as formatValue', () => {
    const cutoff = LOW_PASS_FILTER.params[0]!;
    expect(unitLabel(cutoff, 440)).toBe('Hz');
    expect(unitLabel(cutoff, 15000)).toBe('kHz');

    const time = DELAY.params[0]!;
    expect(unitLabel(time, 250)).toBe('ms');
    expect(unitLabel(time, 1500)).toBe('s');

    const seconds = param({ unit: 's', max: 10 });
    expect(unitLabel(seconds, 0.25)).toBe('ms');
    expect(unitLabel(seconds, 2.5)).toBe('s');
  });
});

describe('formatNumber', () => {
  it('omits the unit but keeps the scaling', () => {
    expect(formatNumber(LOW_PASS_FILTER.params[0]!, 15000)).toBe('15.0');
    expect(formatNumber(DELAY.params[0]!, 1500)).toBe('1.50');
    expect(formatNumber(param({ unit: '%', max: 1 }), 0.42)).toBe('42');
  });
});

describe('every declared parameter formats without throwing', () => {
  const all = [
    ...EFFECTS.flatMap((effect) => effect.params),
    ...GENERATORS.flatMap((generator) => generator.params),
  ];

  it.each(all.map((p) => [p.key, p] as const))(
    'formats min, default and max for %s',
    (_key, p) => {
      for (const value of [p.min, p.default, p.max]) {
        expect(typeof formatValue(p, value)).toBe('string');
        expect(formatValue(p, value)).not.toContain('NaN');
      }
    }
  );
});
