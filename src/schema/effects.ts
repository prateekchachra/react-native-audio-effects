/**
 * Effect descriptors — the canonical definition of every effect and parameter.
 *
 * ## Ranges
 *
 * Where both backends implement a parameter, the range here matches Klarinet's
 * documented range (see `AudioEffectParams.kt`). Klarinet clamps internally and
 * AudioKit mostly does not, so adopting the stricter of the two means a value
 * that is legal in the schema behaves identically on both platforms instead of
 * being silently clamped on one.
 *
 * ## Units
 *
 * The unit declared here is the unit that crosses the bridge. Native adapters
 * convert: delay time travels in milliseconds because that is Klarinet's native
 * unit, and the iOS adapter divides by 1000 for AudioKit, which wants seconds.
 * Conversion lives on exactly one side of each parameter, never both.
 *
 * ## Per-parameter platform flags
 *
 * The two DSP backends are not feature-identical. Rather than pretend, the
 * parameters that exist on only one are flagged with `platforms`, surfaced
 * through `getCapabilities()`, and disabled in the UI on the platform that
 * lacks them.
 */

import type { EffectDescriptor, ParamDescriptor, EffectType } from './types';

const IOS_ONLY = ['ios'] as const;
const ANDROID_ONLY = ['android'] as const;
const BOTH = ['ios', 'android'] as const;

/** Standard 0..1 dry/wet control. */
function mixParam(defaultValue: number): ParamDescriptor {
  return {
    key: 'mix',
    label: 'Mix',
    min: 0,
    max: 1,
    default: defaultValue,
    unit: '%',
    taper: 'linear',
    description: 'Balance between the dry and processed signal.',
  };
}

export const GAIN: EffectDescriptor = {
  type: 'gain',
  label: 'Gain',
  category: 'utility',
  platforms: BOTH,
  description: 'Level trim with an optional click-free ramp.',
  params: [
    {
      key: 'level',
      label: 'Level',
      min: -60,
      max: 24,
      default: 0,
      unit: 'dB',
      taper: 'linear',
    },
    {
      key: 'fade',
      label: 'Fade',
      min: 0,
      max: 500,
      default: 0,
      unit: 'ms',
      taper: 'linear',
      description:
        'Ramp time applied to level changes. Zero applies them immediately.',
    },
  ],
};

export const PAN: EffectDescriptor = {
  type: 'pan',
  label: 'Pan',
  category: 'utility',
  platforms: BOTH,
  description: 'Stereo placement.',
  params: [
    {
      key: 'pan',
      label: 'Pan',
      min: -1,
      max: 1,
      default: 0,
      unit: '',
      taper: 'linear',
      precision: 2,
    },
  ],
};

export const DELAY: EffectDescriptor = {
  type: 'delay',
  label: 'Delay',
  category: 'time',
  platforms: BOTH,
  description: 'Echo with feedback.',
  params: [
    {
      key: 'time',
      label: 'Time',
      min: 1,
      max: 2000,
      default: 250,
      unit: 'ms',
      taper: 'log',
    },
    {
      key: 'feedback',
      label: 'Feedback',
      min: 0,
      max: 0.95,
      default: 0.3,
      unit: '%',
      taper: 'linear',
      description: 'How much of the output is fed back in. Sets repeat count.',
    },
    mixParam(0.5),
    {
      key: 'tone',
      label: 'Tone',
      min: 20,
      max: 20000,
      default: 20000,
      unit: 'Hz',
      taper: 'log',
      platforms: IOS_ONLY,
      description:
        'Low-pass filter in the feedback path, for darkening repeats. ' +
        'AudioKit only — Klarinet’s delay has no damping stage.',
    },
  ],
};

export const REVERB: EffectDescriptor = {
  type: 'reverb',
  label: 'Reverb',
  category: 'time',
  platforms: BOTH,
  description: 'Room simulation.',
  params: [
    {
      key: 'roomSize',
      label: 'Size',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
      description: 'Larger values give a longer tail.',
    },
    {
      key: 'damping',
      label: 'Damping',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
      description: 'High-frequency absorption. Higher is warmer.',
    },
    mixParam(0.3),
    {
      key: 'width',
      label: 'Width',
      min: 0,
      max: 1,
      default: 1,
      unit: '%',
      taper: 'linear',
      platforms: ANDROID_ONLY,
      description:
        'Stereo spread of the tail. Klarinet’s Freeverb only — AudioKit’s ' +
        'Costello reverb exposes no width control.',
    },
  ],
};

export const CHORUS: EffectDescriptor = {
  type: 'chorus',
  label: 'Chorus',
  category: 'modulation',
  platforms: BOTH,
  description: 'Detuned, modulated copies for thickening.',
  params: [
    {
      key: 'rate',
      label: 'Rate',
      min: 0.1,
      max: 10,
      default: 1,
      unit: 'Hz',
      taper: 'log',
      precision: 2,
    },
    {
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
    },
    mixParam(0.5),
  ],
};

export const FLANGER: EffectDescriptor = {
  type: 'flanger',
  label: 'Flanger',
  category: 'modulation',
  platforms: BOTH,
  description: 'Swept short delay with feedback.',
  params: [
    {
      key: 'rate',
      label: 'Rate',
      min: 0.1,
      max: 10,
      default: 0.5,
      unit: 'Hz',
      taper: 'log',
      precision: 2,
    },
    {
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
    },
    {
      key: 'feedback',
      label: 'Feedback',
      min: -0.95,
      max: 0.95,
      default: 0,
      unit: '%',
      taper: 'linear',
      description: 'Negative values invert the feedback for a hollower sweep.',
    },
    mixParam(0.5),
  ],
};

export const PHASER: EffectDescriptor = {
  type: 'phaser',
  label: 'Phaser',
  category: 'modulation',
  platforms: BOTH,
  description: 'Swept all-pass notches.',
  params: [
    {
      key: 'rate',
      label: 'Rate',
      min: 0.1,
      max: 10,
      default: 0.5,
      unit: 'Hz',
      taper: 'log',
      precision: 2,
    },
    {
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
    },
    {
      key: 'feedback',
      label: 'Feedback',
      min: -0.95,
      max: 0.95,
      default: 0,
      unit: '%',
      taper: 'linear',
    },
    {
      key: 'stages',
      label: 'Stages',
      min: 2,
      max: 12,
      default: 4,
      unit: '',
      taper: 'stepped',
      steps: [2, 4, 6, 8, 10, 12],
      precision: 0,
      platforms: ANDROID_ONLY,
      description:
        'Number of all-pass stages, which sets the notch count. Klarinet ' +
        'only — AudioKit’s phaser has a fixed topology.',
    },
  ],
};

export const TREMOLO: EffectDescriptor = {
  type: 'tremolo',
  label: 'Tremolo',
  category: 'modulation',
  platforms: BOTH,
  description: 'Rhythmic amplitude modulation.',
  params: [
    {
      key: 'rate',
      label: 'Rate',
      min: 0.1,
      max: 20,
      default: 5,
      unit: 'Hz',
      taper: 'log',
      precision: 2,
    },
    {
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 1,
      default: 0.5,
      unit: '%',
      taper: 'linear',
    },
  ],
};

export const COMPRESSOR: EffectDescriptor = {
  type: 'compressor',
  label: 'Compressor',
  category: 'dynamics',
  platforms: BOTH,
  description: 'Downward compression above a threshold.',
  params: [
    {
      key: 'threshold',
      label: 'Threshold',
      min: -60,
      max: 0,
      default: -20,
      unit: 'dB',
      taper: 'linear',
    },
    {
      key: 'ratio',
      label: 'Ratio',
      min: 1,
      max: 20,
      default: 4,
      unit: ':1',
      taper: 'exp',
      skew: 2,
    },
    {
      key: 'attack',
      label: 'Attack',
      min: 0.1,
      max: 100,
      default: 10,
      unit: 'ms',
      taper: 'log',
      precision: 1,
    },
    {
      key: 'release',
      label: 'Release',
      min: 10,
      max: 1000,
      default: 100,
      unit: 'ms',
      taper: 'log',
    },
    {
      key: 'makeupGain',
      label: 'Makeup',
      min: 0,
      max: 40,
      default: 0,
      unit: 'dB',
      taper: 'linear',
    },
  ],
};

export const LIMITER: EffectDescriptor = {
  type: 'limiter',
  label: 'Limiter',
  category: 'dynamics',
  platforms: BOTH,
  description: 'Brick-wall ceiling.',
  params: [
    {
      key: 'threshold',
      label: 'Ceiling',
      min: -60,
      max: 0,
      default: -1,
      unit: 'dB',
      taper: 'linear',
    },
    {
      key: 'release',
      label: 'Release',
      min: 1,
      max: 500,
      default: 50,
      unit: 'ms',
      taper: 'log',
    },
  ],
};

export const NOISE_GATE: EffectDescriptor = {
  type: 'noiseGate',
  label: 'Noise Gate',
  category: 'dynamics',
  platforms: BOTH,
  description: 'Silences signal below a threshold.',
  params: [
    {
      key: 'threshold',
      label: 'Threshold',
      min: -80,
      max: 0,
      default: -40,
      unit: 'dB',
      taper: 'linear',
    },
    {
      key: 'attack',
      label: 'Attack',
      min: 0.1,
      max: 50,
      default: 1,
      unit: 'ms',
      taper: 'log',
      precision: 1,
    },
    {
      key: 'release',
      label: 'Release',
      min: 10,
      max: 1000,
      default: 100,
      unit: 'ms',
      taper: 'log',
    },
    {
      key: 'hold',
      label: 'Hold',
      min: 0,
      max: 500,
      default: 50,
      unit: 'ms',
      taper: 'linear',
    },
  ],
};

/** Band count for {@link PARAMETRIC_EQ}. Mirrored by both native adapters. */
export const EQ_BAND_COUNT = 4;

/** Filter shapes for an EQ band, matching Klarinet's `BAND_TYPE` encoding. */
export const EQ_BAND_TYPES = ['peaking', 'lowShelf', 'highShelf'] as const;

const EQ_DEFAULT_FREQUENCIES = [100, 500, 2000, 8000];

/**
 * Build the parameter list for a multi-band EQ.
 *
 * Keys are flat (`band0Frequency`) rather than nested because the TurboModule
 * addresses parameters by a single string. Klarinet addresses the same values
 * as `bandIndex * PARAMS_PER_BAND + offset`, which the Kotlin adapter derives
 * from the index parsed out of the key.
 */
function buildEqParams(): ParamDescriptor[] {
  const params: ParamDescriptor[] = [];
  for (let band = 0; band < EQ_BAND_COUNT; band++) {
    params.push(
      {
        key: `band${band}Frequency`,
        label: `B${band + 1} Freq`,
        min: 20,
        max: 20000,
        default: EQ_DEFAULT_FREQUENCIES[band]!,
        unit: 'Hz',
        taper: 'log',
      },
      {
        key: `band${band}Gain`,
        label: `B${band + 1} Gain`,
        min: -24,
        max: 24,
        default: 0,
        unit: 'dB',
        taper: 'linear',
      },
      {
        key: `band${band}Q`,
        label: `B${band + 1} Q`,
        min: 0.1,
        max: 10,
        default: 1,
        unit: '',
        taper: 'log',
        precision: 2,
      },
      {
        key: `band${band}Type`,
        label: `B${band + 1} Type`,
        min: 0,
        max: EQ_BAND_TYPES.length - 1,
        default: 0,
        unit: '',
        taper: 'stepped',
        steps: EQ_BAND_TYPES.map((_, index) => index),
        precision: 0,
        description: EQ_BAND_TYPES.join(' / '),
      }
    );
  }
  return params;
}

export const PARAMETRIC_EQ: EffectDescriptor = {
  type: 'parametricEq',
  label: 'Parametric EQ',
  category: 'filter',
  platforms: BOTH,
  description: `${EQ_BAND_COUNT}-band parametric equaliser.`,
  params: buildEqParams(),
};

export const LOW_PASS_FILTER: EffectDescriptor = {
  type: 'lowPassFilter',
  label: 'Low Pass',
  category: 'filter',
  platforms: BOTH,
  params: [
    {
      key: 'cutoff',
      label: 'Cutoff',
      min: 20,
      max: 20000,
      default: 20000,
      unit: 'Hz',
      taper: 'log',
    },
    {
      key: 'resonance',
      label: 'Res',
      min: 0.1,
      max: 10,
      default: 0.707,
      unit: '',
      taper: 'log',
      precision: 2,
    },
  ],
};

export const HIGH_PASS_FILTER: EffectDescriptor = {
  type: 'highPassFilter',
  label: 'High Pass',
  category: 'filter',
  platforms: BOTH,
  params: [
    {
      key: 'cutoff',
      label: 'Cutoff',
      min: 20,
      max: 20000,
      default: 20,
      unit: 'Hz',
      taper: 'log',
    },
    {
      key: 'resonance',
      label: 'Res',
      min: 0.1,
      max: 10,
      default: 0.707,
      unit: '',
      taper: 'log',
      precision: 2,
    },
  ],
};

export const BAND_PASS_FILTER: EffectDescriptor = {
  type: 'bandPassFilter',
  label: 'Band Pass',
  category: 'filter',
  platforms: BOTH,
  params: [
    {
      key: 'center',
      label: 'Center',
      min: 20,
      max: 20000,
      default: 1000,
      unit: 'Hz',
      taper: 'log',
    },
    {
      key: 'bandwidth',
      label: 'Width',
      min: 0.1,
      max: 4,
      default: 1,
      unit: 'oct',
      taper: 'log',
      precision: 2,
    },
  ],
};

export const DISTORTION: EffectDescriptor = {
  type: 'distortion',
  label: 'Distortion',
  category: 'distortion',
  platforms: IOS_ONLY,
  description:
    'Soft-clipping saturation. AudioKit only — Klarinet 0.5 ships no ' +
    'distortion stage.',
  params: [
    {
      key: 'drive',
      label: 'Drive',
      min: 0,
      max: 40,
      default: 6,
      unit: 'dB',
      taper: 'linear',
    },
    mixParam(1),
  ],
};

export const BIT_CRUSHER: EffectDescriptor = {
  type: 'bitCrusher',
  label: 'Bit Crusher',
  category: 'distortion',
  platforms: IOS_ONLY,
  description:
    'Bit-depth and sample-rate reduction. AudioKit only — Klarinet 0.5 ' +
    'ships no bit crusher.',
  params: [
    {
      key: 'bitDepth',
      label: 'Bits',
      min: 1,
      max: 16,
      default: 8,
      unit: 'bit',
      taper: 'stepped',
      steps: [1, 2, 3, 4, 6, 8, 12, 16],
    },
    {
      key: 'sampleRate',
      label: 'Rate',
      min: 1000,
      max: 48000,
      default: 16000,
      unit: 'Hz',
      taper: 'log',
    },
    mixParam(1),
  ],
};

/** Every effect, in a stable display order. */
export const EFFECTS: readonly EffectDescriptor[] = [
  GAIN,
  PAN,
  DELAY,
  REVERB,
  CHORUS,
  FLANGER,
  PHASER,
  TREMOLO,
  COMPRESSOR,
  LIMITER,
  NOISE_GATE,
  PARAMETRIC_EQ,
  LOW_PASS_FILTER,
  HIGH_PASS_FILTER,
  BAND_PASS_FILTER,
  DISTORTION,
  BIT_CRUSHER,
];

const EFFECTS_BY_TYPE = new Map<EffectType, EffectDescriptor>(
  EFFECTS.map((effect) => [effect.type, effect])
);

/** Look up an effect descriptor, or `undefined` if the type is unknown. */
export function getEffect(type: EffectType): EffectDescriptor | undefined {
  return EFFECTS_BY_TYPE.get(type);
}

/** Look up a parameter descriptor on an effect. */
export function getParam(
  type: EffectType,
  key: string
): ParamDescriptor | undefined {
  return EFFECTS_BY_TYPE.get(type)?.params.find((param) => param.key === key);
}

/** Default values for every parameter of an effect. */
export function defaultsFor(type: EffectType): Record<string, number> {
  const effect = EFFECTS_BY_TYPE.get(type);
  if (!effect) {
    return {};
  }
  const values: Record<string, number> = {};
  for (const param of effect.params) {
    values[param.key] = param.default;
  }
  return values;
}
