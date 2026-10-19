/**
 * Generator descriptors — oscillators and noise sources.
 *
 * ## Why the two platforms differ in implementation
 *
 * AudioKit ships oscillators, so iOS uses `Oscillator` with a band-limited
 * wavetable plus Soundpipe's `WhiteNoise` / `PinkNoise` / `BrownianNoise`.
 *
 * Klarinet 0.5 ships none, so Android synthesises samples directly in
 * `AudioStreamCallback.onAudioReady`. Saw and square use PolyBLEP to suppress
 * the aliasing a naive discontinuity would fold back into the audible band;
 * triangle is generated naively because its harmonics fall off as 1/n² and the
 * aliasing stays inaudible.
 *
 * The two approaches are perceptually equivalent but not sample-identical at
 * high fundamentals. {@link ANTIALIAS_PARAM} exposes the choice on Android.
 */

import type { GeneratorDescriptor, ParamDescriptor, Waveform } from './types';

const FREQUENCY: ParamDescriptor = {
  key: 'frequency',
  label: 'Freq',
  min: 20,
  max: 20000,
  default: 440,
  unit: 'Hz',
  taper: 'log',
  description: 'Fundamental frequency.',
};

const AMPLITUDE: ParamDescriptor = {
  key: 'amplitude',
  label: 'Level',
  min: 0,
  max: 1,
  default: 0.5,
  unit: '%',
  taper: 'linear',
  description: 'Output level, linear amplitude.',
};

/**
 * Anti-aliasing toggle for the band-limited waveforms.
 *
 * Android only: iOS always uses AudioKit's band-limited wavetables, so there
 * is nothing to switch off there.
 */
export const ANTIALIAS_PARAM: ParamDescriptor = {
  key: 'antialias',
  label: 'Anti-alias',
  min: 0,
  max: 1,
  default: 1,
  unit: '',
  taper: 'stepped',
  steps: [0, 1],
  precision: 0,
  platforms: ['android'],
  description:
    'PolyBLEP band limiting for saw and square. Disable for a raw, aliased ' +
    'lo-fi character.',
};

function pitched(
  waveform: Waveform,
  label: string,
  description: string,
  bandLimited: boolean
): GeneratorDescriptor {
  return {
    waveform,
    label,
    pitched: true,
    description,
    params: bandLimited
      ? [FREQUENCY, AMPLITUDE, ANTIALIAS_PARAM]
      : [FREQUENCY, AMPLITUDE],
  };
}

function noise(
  waveform: Waveform,
  label: string,
  description: string
): GeneratorDescriptor {
  return {
    waveform,
    label,
    pitched: false,
    description,
    params: [AMPLITUDE],
  };
}

export const SINE = pitched(
  'sine',
  'Sine',
  'Pure fundamental, no harmonics.',
  false
);

export const SQUARE = pitched(
  'square',
  'Square',
  'Odd harmonics only. Hollow, clarinet-like.',
  true
);

export const SAWTOOTH = pitched(
  'sawtooth',
  'Saw',
  'All harmonics. Bright and buzzy — the classic synth brass waveform.',
  true
);

export const TRIANGLE = pitched(
  'triangle',
  'Triangle',
  'Odd harmonics falling off steeply. Soft and flute-like.',
  false
);

export const WHITE_NOISE = noise(
  'whiteNoise',
  'White',
  'Equal energy per hertz. Bright and hissy.'
);

export const PINK_NOISE = noise(
  'pinkNoise',
  'Pink',
  'Equal energy per octave, falling 3 dB per octave. Sounds balanced.'
);

export const BROWN_NOISE = noise(
  'brownNoise',
  'Brown',
  'Falls 6 dB per octave. Deep and rumbling.'
);

/** Every generator, in a stable display order. */
export const GENERATORS: readonly GeneratorDescriptor[] = [
  SINE,
  SQUARE,
  SAWTOOTH,
  TRIANGLE,
  WHITE_NOISE,
  PINK_NOISE,
  BROWN_NOISE,
];

const GENERATORS_BY_WAVEFORM = new Map<Waveform, GeneratorDescriptor>(
  GENERATORS.map((generator) => [generator.waveform, generator])
);

/** Look up a generator descriptor, or `undefined` if the waveform is unknown. */
export function getGenerator(
  waveform: Waveform
): GeneratorDescriptor | undefined {
  return GENERATORS_BY_WAVEFORM.get(waveform);
}

/** Default values for every parameter of a generator. */
export function generatorDefaults(waveform: Waveform): Record<string, number> {
  const generator = GENERATORS_BY_WAVEFORM.get(waveform);
  if (!generator) {
    return {};
  }
  const values: Record<string, number> = {};
  for (const param of generator.params) {
    values[param.key] = param.default;
  }
  return values;
}

/**
 * Amplitude envelope for a generator.
 *
 * A raw oscillator is a continuous tone; an envelope is what turns it into a
 * note. Attack and decay shape the onset, sustain is the level a held note
 * settles at, and release is the tail after the key comes up.
 *
 * This applies to generators rather than to the effect chain, because it is
 * gated by note events rather than running continuously. On iOS it is
 * AudioKit's `AmplitudeEnvelope`; on Android it is a state machine in the
 * stream callback, since Klarinet has no envelope of its own.
 */
export const ENVELOPE_PARAMS: readonly ParamDescriptor[] = [
  {
    key: 'attack',
    label: 'Attack',
    min: 1,
    max: 4000,
    default: 10,
    unit: 'ms',
    taper: 'log',
    description: 'Time from silence to full level when a note starts.',
  },
  {
    key: 'decay',
    label: 'Decay',
    min: 1,
    max: 4000,
    default: 200,
    unit: 'ms',
    taper: 'log',
    description: 'Time to fall from full level to the sustain level.',
  },
  {
    key: 'sustain',
    label: 'Sustain',
    min: 0,
    max: 1,
    default: 0.7,
    unit: '%',
    taper: 'linear',
    description: 'Level a held note settles at. Unlike the others, a level.',
  },
  {
    key: 'release',
    label: 'Release',
    min: 1,
    max: 8000,
    default: 400,
    unit: 'ms',
    taper: 'log',
    description: 'Time to fade to silence after the note is let go.',
  },
];

/** Default envelope values, by parameter key. */
export function envelopeDefaults(): Record<string, number> {
  const values: Record<string, number> = {};
  for (const param of ENVELOPE_PARAMS) {
    values[param.key] = param.default;
  }
  return values;
}
