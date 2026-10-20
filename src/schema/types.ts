/**
 * Core schema types.
 *
 * The schema is the single source of truth shared by three consumers:
 *
 *  1. the TurboModule wire format (parameters are addressed by string `key`),
 *  2. the native adapters (`ios/Effects/*.swift`, `android/.../effects/*Mapping.kt`),
 *  3. the UI kit (knob ranges, curves, value formatting).
 *
 * Keeping one description of a parameter means a range can never disagree with
 * the control that drives it, which is the class of bug this library had in v1.
 */

export type Platform = 'ios' | 'android';

/**
 * Shape of the control curve between a normalised position (0..1, what a knob
 * or slider reports) and the real parameter value.
 *
 * - `linear`  — even mapping. Right for already-logarithmic units like dB.
 * - `log`     — constant ratio per unit travel. Right for frequency and time.
 *               Requires `min > 0`.
 * - `exp`     — power curve biased by {@link ParamDescriptor.skew}.
 * - `stepped` — snaps to {@link ParamDescriptor.steps}.
 */
export type Taper = 'linear' | 'log' | 'exp' | 'stepped';

/**
 * Display unit. This is also the *canonical* unit the value travels in across
 * the bridge — native adapters convert to whatever their backend wants.
 */
export type ParamUnit =
  | 'ms'
  | 's'
  | 'Hz'
  | 'dB'
  | '%'
  | 'x'
  | ':1'
  | 'oct'
  /** Hundredths of a semitone. Detune and fine tuning. */
  | 'cents'
  | 'bit'
  | '';

export type EffectCategory =
  'dynamics' | 'time' | 'modulation' | 'filter' | 'distortion' | 'utility';

export type EffectType =
  | 'gain'
  | 'pan'
  | 'delay'
  | 'reverb'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo'
  | 'compressor'
  | 'limiter'
  | 'noiseGate'
  | 'parametricEq'
  | 'lowPassFilter'
  | 'highPassFilter'
  | 'bandPassFilter'
  | 'distortion'
  | 'bitCrusher';

export type Waveform =
  | 'sine'
  | 'square'
  | 'sawtooth'
  | 'triangle'
  | 'whiteNoise'
  | 'pinkNoise'
  | 'brownNoise';

/** A single automatable parameter. */
export interface ParamDescriptor {
  /** Stable wire key. Never change one without a major version bump. */
  readonly key: string;
  /** Short human label for the control. */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit: ParamUnit;
  readonly taper: Taper;
  /**
   * Power for `exp` tapers. `>1` gives more travel to the low end of the
   * range, `<1` to the high end. Ignored for other tapers.
   */
  readonly skew?: number;
  /** Allowed values for `stepped` tapers, ascending. */
  readonly steps?: readonly number[];
  /** Decimal places to show. Inferred from the unit when omitted. */
  readonly precision?: number;
  /**
   * Platforms that actually implement this parameter. Defaults to the parent
   * effect's platforms.
   *
   * Some parameters exist on only one backend — Klarinet's reverb has a stereo
   * `width` that AudioKit's has no equivalent for; AudioKit's delay has a
   * damping filter that Klarinet's lacks. Rather than silently dropping those
   * writes, they are declared here, reported through `getCapabilities()`, and
   * disabled in the UI.
   */
  readonly platforms?: readonly Platform[];
  readonly description?: string;
}

/** A complete effect: its identity, its category, and its parameters. */
export interface EffectDescriptor {
  readonly type: EffectType;
  readonly label: string;
  readonly category: EffectCategory;
  readonly platforms: readonly Platform[];
  readonly params: readonly ParamDescriptor[];
  readonly description?: string;
}

/** A signal generator (oscillator or noise source). */
export interface GeneratorDescriptor {
  readonly waveform: Waveform;
  readonly label: string;
  /** False for noise sources, which have no fundamental. */
  readonly pitched: boolean;
  readonly params: readonly ParamDescriptor[];
  readonly description?: string;
}
