/**
 * TurboModule specification.
 *
 * This file is consumed by React Native's codegen, which generates the
 * `NativeAudioEffectsSpec` base class on both platforms. It is deliberately
 * low-level: every type here has to survive codegen's restrictions (no unions,
 * no generics, no enums, no index signatures), so the friendly API lives in
 * `src/api/` and this stays a thin, literal description of the wire format.
 *
 * ## Design notes
 *
 * **Handles, not a declarative graph.** Sources and effects are addressed by
 * opaque integer ids. Both backends model audio as long-lived native objects
 * (AudioKit nodes, Klarinet `AudioEffect`s), so handles map onto them directly.
 * A "replace the whole graph" API would force native-side diffing and tear
 * down nodes that only needed a parameter change.
 *
 * **Parameter writes are synchronous `void` methods.** Under the New
 * Architecture a `void` TurboModule method is dispatched straight over JSI
 * with no serialisation or thread hop, so a knob dragged at 60 fps costs
 * essentially nothing. Making these promises would put a round-trip in the
 * middle of every frame.
 *
 * **`setParameters` exists for atomicity, not just batching.** Klarinet's
 * `applyBatch` commits a group of changes within one audio cycle. Writing an
 * XY pad's two axes or recalling a preset one parameter at a time lets the
 * audio thread observe a half-applied state, which zippers audibly.
 *
 * @see src/api for the wrapper most consumers should use.
 */

import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

/** Engine configuration. All fields optional; native picks sane defaults. */
export type EngineOptions = {
  /** Preferred sample rate in hertz. Defaults to the device's native rate. */
  sampleRate?: number;
  /**
   * Preferred buffer size in frames. Smaller means lower latency and a higher
   * risk of dropouts. Defaults to the device's optimal burst size.
   */
  bufferFrames?: number;
  /**
   * iOS `AVAudioSession` category: `'playback'` or `'playAndRecord'`.
   * Ignored on Android.
   */
  category?: string;
};

/** Metadata returned after decoding and caching an audio file. */
export type LoadedSource = {
  sourceId: number;
  durationSec: number;
  sampleRate: number;
  channelCount: number;
  /**
   * Interleaved min/max pairs for drawing a waveform, normalised to -1..1.
   * Computed once at load time; never streamed.
   */
  peaks: number[];
};

/** Oscillator configuration. */
export type OscillatorOptions = {
  frequency?: number;
  amplitude?: number;
  /** PolyBLEP band limiting for saw and square. Android only. */
  antialias?: boolean;
};

/** One entry in a {@link Spec.setParameters} batch. */
export type ParameterChange = {
  effectId: number;
  key: string;
  value: number;
};

/** Periodic level report for meters. Emitted at the configured interval. */
export type LevelsEvent = {
  sourceId: number;
  peakLeft: number;
  peakRight: number;
  rmsLeft: number;
  rmsRight: number;
};

/** Playback position report. Emitted at a low rate; interpolate for display. */
export type ProgressEvent = {
  sourceId: number;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
};

/** An error that happened on the audio thread, outside any pending promise. */
export type AudioErrorEvent = {
  /** Stable machine-readable code, e.g. `'STREAM_ERROR'`, `'UNDERRUN'`. */
  code: string;
  message: string;
  /** Zero when the error is not tied to a specific source. */
  sourceId: number;
};

export interface Spec extends TurboModule {
  // ---------------------------------------------------------------- engine

  /** Prepare the engine. Safe to call again to change configuration. */
  configure(options: EngineOptions): Promise<void>;
  /** Start the output stream. */
  start(): Promise<void>;
  /** Stop the output stream, keeping sources and effects allocated. */
  stop(): Promise<void>;
  /** Release every native resource. The engine must be reconfigured after. */
  teardown(): Promise<void>;

  // --------------------------------------------------------------- sources

  /**
   * Decode an audio file and make it playable.
   *
   * Accepts a `file://` path, an Android `content://` URI, or an absolute
   * path. The file is copied into the app cache and, where the platform
   * decoder cannot handle it natively, transcoded first — so the returned
   * source is always backed by a stable local file.
   */
  loadFile(uri: string): Promise<LoadedSource>;

  /**
   * Create a tone or noise generator.
   *
   * `waveform` is one of `sine`, `square`, `sawtooth`, `triangle`,
   * `whiteNoise`, `pinkNoise`, `brownNoise`.
   */
  createOscillator(
    waveform: string,
    options: OscillatorOptions
  ): Promise<number>;

  /** Release a source and every effect in its chain. */
  releaseSource(sourceId: number): Promise<void>;

  playSource(sourceId: number, loop: boolean): Promise<void>;
  pauseSource(sourceId: number): Promise<void>;
  stopSource(sourceId: number): Promise<void>;
  seekSource(sourceId: number, positionSec: number): Promise<void>;

  /** Set source level as linear amplitude, 0..1. Synchronous. */
  setSourceVolume(sourceId: number, volume: number): void;

  /**
   * Set a generator parameter — `frequency` or `amplitude` — while it runs.
   *
   * Separate from `setParameter`, which addresses effects: a generator is a
   * source, not a link in the chain, so it has no effect handle. Synchronous
   * for the same reason effect writes are: this is what a pitch knob drives.
   */
  setOscillatorParameter(sourceId: number, key: string, value: number): void;

  /**
   * Set an ADSR envelope parameter on a generator — `attack`, `decay`,
   * `sustain` or `release`. Times are milliseconds; sustain is a 0..1 level.
   */
  setEnvelopeParameter(sourceId: number, key: string, value: number): void;

  /**
   * Open or close a generator's envelope gate: note on, note off.
   *
   * Separate from `playSource` because the stream keeps running between
   * notes — restarting it per key press would click and add latency.
   */
  gateSource(sourceId: number, on: boolean): void;

  // --------------------------------------------------------------- effects

  /**
   * Append an effect to a source's chain.
   *
   * Rejects with `EFFECT_UNAVAILABLE` when the running platform has no
   * implementation for `type`, rather than returning a handle that silently
   * does nothing.
   */
  createEffect(sourceId: number, type: string): Promise<number>;

  removeEffect(effectId: number): Promise<void>;

  /** Reorder a source's chain. `effectIds` must be a permutation of it. */
  reorderChain(sourceId: number, effectIds: number[]): Promise<void>;

  /** Bypass an effect without removing it. Synchronous. */
  setEffectEnabled(effectId: number, enabled: boolean): void;

  // ------------------------------------------------------------ parameters

  /** Write one parameter. Synchronous — safe to call every frame. */
  setParameter(effectId: number, key: string, value: number): void;

  /** Write several parameters atomically, within a single audio cycle. */
  setParameters(changes: ParameterChange[]): void;

  /** Read a parameter's current value. Synchronous. */
  getParameter(effectId: number, key: string): number;

  // ---------------------------------------------------------- capabilities

  /**
   * What this platform's backend actually implements, as a JSON string of
   * `{ effects: { [type]: string[] }, generators: string[] }`.
   *
   * Returned as JSON rather than a struct because codegen cannot express a
   * map with dynamic keys. It is read once at startup and compared against
   * the schema, so the parse cost is irrelevant.
   */
  getCapabilitiesJSON(): string;

  // -------------------------------------------------------------- metering

  /**
   * Enable level reporting. Native coalesces to `intervalMs` — levels are
   * never emitted per audio buffer, which would flood the JS thread.
   */
  setMeteringEnabled(enabled: boolean, intervalMs: number): void;

  readonly onLevels: CodegenTypes.EventEmitter<LevelsEvent>;
  readonly onProgress: CodegenTypes.EventEmitter<ProgressEvent>;
  readonly onError: CodegenTypes.EventEmitter<AudioErrorEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AudioEffects');
