/**
 * The parameter schema: one description of every effect, generator and
 * parameter, shared by the TurboModule wire format, both native adapters, and
 * the UI kit.
 */

export type {
  EffectCategory,
  EffectDescriptor,
  EffectType,
  GeneratorDescriptor,
  ParamDescriptor,
  ParamUnit,
  Platform,
  Taper,
  Waveform,
} from './types';

export {
  BAND_PASS_FILTER,
  BIT_CRUSHER,
  CHORUS,
  COMPRESSOR,
  DELAY,
  DISTORTION,
  EFFECTS,
  EQ_BAND_COUNT,
  FLANGER,
  GAIN,
  HIGH_PASS_FILTER,
  LIMITER,
  LOW_PASS_FILTER,
  NOISE_GATE,
  PAN,
  PARAMETRIC_EQ,
  PHASER,
  REVERB,
  TREMOLO,
  defaultsFor,
  getEffect,
  getParam,
} from './effects';

export {
  ANTIALIAS_PARAM,
  ENVELOPE_PARAMS,
  BROWN_NOISE,
  GENERATORS,
  PINK_NOISE,
  SAWTOOTH,
  SINE,
  SQUARE,
  TRIANGLE,
  WHITE_NOISE,
  envelopeDefaults,
  generatorDefaults,
  getGenerator,
} from './generators';

export {
  InvalidTaperError,
  clamp,
  fromNormalized,
  nudge,
  quantize,
  toNormalized,
} from './taper';

export { formatNumber, formatValue, unitLabel } from './format';

export {
  detune,
  frequencyToMidi,
  isBlackKey,
  midiToFrequency,
  noteName,
  octaveStart,
  unisonOffsets,
  unisonPans,
  PIANO_HIGHEST,
  PIANO_LOWEST,
  SEMITONES_PER_OCTAVE,
} from './music';

import { EFFECTS } from './effects';
import type { EffectDescriptor, ParamDescriptor, Platform } from './types';

/**
 * Whether a parameter is implemented on a platform.
 *
 * A parameter inherits its effect's platforms unless it narrows them itself.
 */
export function isParamSupported(
  effect: EffectDescriptor,
  param: ParamDescriptor,
  platform: Platform
): boolean {
  const platforms = param.platforms ?? effect.platforms;
  return platforms.includes(platform);
}

/** Whether an effect is implemented on a platform. */
export function isEffectSupported(
  effect: EffectDescriptor,
  platform: Platform
): boolean {
  return effect.platforms.includes(platform);
}

/** Effects available on a platform, in display order. */
export function effectsForPlatform(
  platform: Platform
): readonly EffectDescriptor[] {
  return EFFECTS.filter((effect) => isEffectSupported(effect, platform));
}

/**
 * The schema's own view of what each platform supports.
 *
 * Compared against the native `getCapabilities()` response by the parity test,
 * so the schema and the two backends cannot drift apart unnoticed.
 */
export function expectedCapabilities(
  platform: Platform
): Record<string, string[]> {
  const capabilities: Record<string, string[]> = {};
  for (const effect of EFFECTS) {
    if (!isEffectSupported(effect, platform)) {
      continue;
    }
    capabilities[effect.type] = effect.params
      .filter((param) => isParamSupported(effect, param, platform))
      .map((param) => param.key);
  }
  return capabilities;
}
