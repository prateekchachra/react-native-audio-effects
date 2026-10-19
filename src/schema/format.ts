/**
 * Value formatting for parameter readouts.
 *
 * Units carry their own conventions: frequency flips to kHz above 1000, time
 * flips between ms and s, ratios read "4.0:1", and normalised mixes display as
 * percentages. Centralising it here keeps every readout in the UI kit — and
 * anything a consumer builds from the same descriptors — consistent.
 */

import type { ParamDescriptor, ParamUnit } from './types';

const DEFAULT_PRECISION: Record<ParamUnit, number> = {
  'ms': 0,
  's': 2,
  'Hz': 0,
  'dB': 1,
  '%': 0,
  'x': 2,
  ':1': 1,
  'oct': 2,
  'bit': 0,
  '': 2,
};

function round(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/**
 * Format a parameter value for display, including its unit suffix.
 *
 * @example
 * formatValue(DELAY.params[0], 250)  // "250 ms"
 * formatValue(DELAY.params[0], 1500) // "1.50 s"
 * formatValue(LPF.params[0], 15000)  // "15.0 kHz"
 */
export function formatValue(param: ParamDescriptor, value: number): string {
  const precision = param.precision ?? DEFAULT_PRECISION[param.unit];

  switch (param.unit) {
    case 'Hz':
      return value >= 1000
        ? `${round(value / 1000, 1)} kHz`
        : `${round(value, precision)} Hz`;

    case 'ms':
      // Past a second, milliseconds stop being readable at a glance.
      return value >= 1000
        ? `${round(value / 1000, 2)} s`
        : `${round(value, precision)} ms`;

    case 's':
      return value < 1
        ? `${round(value * 1000, 0)} ms`
        : `${round(value, precision)} s`;

    case 'dB': {
      // A leading + makes boost-versus-cut readable without reading the digits.
      const sign = value > 0 ? '+' : '';
      return `${sign}${round(value, precision)} dB`;
    }

    case '%':
      return `${round(value * 100, precision)}%`;

    case 'x':
      return `${round(value, precision)}x`;

    case ':1':
      return `${round(value, precision)}:1`;

    case 'oct':
      return `${round(value, precision)} oct`;

    case 'bit':
      return `${round(value, precision)} bit`;

    case '':
      return round(value, precision);
  }
}

/**
 * Format without the unit suffix, for compact controls that label the unit
 * separately.
 */
export function formatNumber(param: ParamDescriptor, value: number): string {
  const precision = param.precision ?? DEFAULT_PRECISION[param.unit];
  if (param.unit === 'Hz' && value >= 1000) {
    return round(value / 1000, 1);
  }
  if (param.unit === 'ms' && value >= 1000) {
    return round(value / 1000, 2);
  }
  if (param.unit === '%') {
    return round(value * 100, precision);
  }
  return round(value, precision);
}

/** The unit string a readout should show for a value, honouring kHz/s flips. */
export function unitLabel(param: ParamDescriptor, value: number): string {
  if (param.unit === 'Hz') {
    return value >= 1000 ? 'kHz' : 'Hz';
  }
  if (param.unit === 'ms') {
    return value >= 1000 ? 's' : 'ms';
  }
  if (param.unit === 's') {
    return value < 1 ? 'ms' : 's';
  }
  return param.unit;
}
