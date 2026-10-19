/**
 * Mapping between a control's normalised position (0..1) and a parameter's
 * real value.
 *
 * A linear knob over 20 Hz..20 kHz puts everything musically useful in the
 * first two percent of its travel. Tapers are what make a control usable, so
 * they live in the schema next to the range rather than in each component.
 *
 * Every taper satisfies `toNormalized(fromNormalized(t)) === t` (to floating
 * point tolerance) for continuous tapers, and snaps to the nearest step for
 * `stepped`. This is enforced in `__tests__/taper.test.ts`.
 */

import type { ParamDescriptor } from './types';

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Thrown when a descriptor's taper cannot describe its range. */
export class InvalidTaperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaperError';
  }
}

function assertLogRange(param: ParamDescriptor): void {
  if (param.min <= 0) {
    throw new InvalidTaperError(
      `Parameter "${param.key}" uses a log taper but has min=${param.min}. ` +
        'Log tapers need a strictly positive minimum — use a small positive ' +
        'floor (e.g. 20 Hz, 1 ms) or switch to an exp taper.'
    );
  }
}

function nearestStep(steps: readonly number[], value: number): number {
  let best = steps[0]!;
  let bestDistance = Math.abs(value - best);
  for (let i = 1; i < steps.length; i++) {
    const distance = Math.abs(value - steps[i]!);
    if (distance < bestDistance) {
      best = steps[i]!;
      bestDistance = distance;
    }
  }
  return best;
}

function assertSteps(param: ParamDescriptor): readonly number[] {
  const steps = param.steps;
  if (!steps || steps.length === 0) {
    throw new InvalidTaperError(
      `Parameter "${param.key}" uses a stepped taper but declares no steps.`
    );
  }
  return steps;
}

/** Real value → normalised control position in 0..1. */
export function toNormalized(param: ParamDescriptor, value: number): number {
  const { min, max } = param;
  const v = clamp(value, min, max);

  switch (param.taper) {
    case 'linear':
      return max === min ? 0 : (v - min) / (max - min);

    case 'log': {
      assertLogRange(param);
      return Math.log(v / min) / Math.log(max / min);
    }

    case 'exp': {
      const skew = param.skew ?? 1;
      const linear = max === min ? 0 : (v - min) / (max - min);
      return Math.pow(linear, 1 / skew);
    }

    case 'stepped': {
      const steps = assertSteps(param);
      if (steps.length === 1) {
        return 0;
      }
      const index = steps.indexOf(nearestStep(steps, v));
      return index / (steps.length - 1);
    }
  }
}

/** Normalised control position in 0..1 → real value. */
export function fromNormalized(
  param: ParamDescriptor,
  normalized: number
): number {
  const { min, max } = param;
  const t = clamp(normalized, 0, 1);

  switch (param.taper) {
    case 'linear':
      return min + (max - min) * t;

    case 'log': {
      assertLogRange(param);
      return min * Math.pow(max / min, t);
    }

    case 'exp': {
      const skew = param.skew ?? 1;
      return min + (max - min) * Math.pow(t, skew);
    }

    case 'stepped': {
      const steps = assertSteps(param);
      const index = Math.round(t * (steps.length - 1));
      return steps[clamp(index, 0, steps.length - 1)]!;
    }
  }
}

/**
 * Constrain a value to what the parameter can actually represent: clamped to
 * range, and snapped to the step grid for stepped parameters.
 *
 * Call this before sending a value to native — it keeps JS, the UI and both
 * backends agreeing on what was set.
 */
export function quantize(param: ParamDescriptor, value: number): number {
  if (param.taper === 'stepped') {
    return nearestStep(assertSteps(param), clamp(value, param.min, param.max));
  }
  return clamp(value, param.min, param.max);
}

/**
 * Nudge a parameter by a number of steps, for keyboard and accessibility
 * actions. Continuous parameters move by 1% of their normalised travel, so the
 * increment follows the taper and stays musically even across the range.
 */
export function nudge(
  param: ParamDescriptor,
  value: number,
  steps: number,
  coarse = false
): number {
  if (param.taper === 'stepped') {
    const table = assertSteps(param);
    const index = table.indexOf(nearestStep(table, value));
    return table[clamp(index + steps, 0, table.length - 1)]!;
  }
  const increment = (coarse ? 0.1 : 0.01) * steps;
  return quantize(
    param,
    fromNormalized(param, toNormalized(param, value) + increment)
  );
}
