/**
 * The audio engine: lifecycle, source creation, and events.
 */

import NativeAudioEffects, {
  type AudioErrorEvent,
  type EngineOptions,
  type LevelsEvent,
  type LoadedSource,
  type ProgressEvent,
} from '../NativeAudioEffects';
import { generatorDefaults, type Waveform } from '../schema';
import { getCapabilities, isGeneratorAvailable } from './capabilities';
import { rethrowNativeError } from './errors';
import { Source } from './Source';

export interface OscillatorConfig {
  frequency?: number;
  amplitude?: number;
  /**
   * PolyBLEP band limiting for saw and square. Android only — AudioKit's
   * oscillators are already band-limited, so this is ignored on iOS.
   */
  antialias?: boolean;
}

type Unsubscribe = () => void;

/**
 * Process-wide audio engine.
 *
 * There is one audio device, so this is a singleton rather than something you
 * instantiate. Configure and start it once, then create sources against it.
 *
 * ```ts
 * await AudioEngine.configure();
 * await AudioEngine.start();
 *
 * const source = await AudioEngine.loadFile(uri);
 * const delay = await source.addEffect('delay');
 * delay.set('time', 300);
 * await source.play({ loop: true });
 * ```
 */
class AudioEngineImpl {
  private started = false;

  /** What this platform's backend implements. See {@link Capabilities}. */
  get capabilities() {
    return getCapabilities();
  }

  get isStarted(): boolean {
    return this.started;
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Prepare the engine and the audio session. Safe to call again to change
   * configuration.
   *
   * @param options.sampleRate preferred rate; defaults to the device's.
   * @param options.bufferFrames smaller is lower latency and more likely to
   *   glitch; defaults to the device's optimal burst.
   * @param options.category `'playback'` or `'playAndRecord'` (iOS only).
   */
  async configure(options: EngineOptions = {}): Promise<void> {
    try {
      await NativeAudioEffects.configure(options);
    } catch (error) {
      return rethrowNativeError(error);
    }
  }

  async start(): Promise<void> {
    try {
      await NativeAudioEffects.start();
      this.started = true;
    } catch (error) {
      return rethrowNativeError(error);
    }
  }

  /** Stop the output stream. Sources and effects stay allocated. */
  async stop(): Promise<void> {
    await NativeAudioEffects.stop();
    this.started = false;
  }

  /** Release everything. The engine must be reconfigured before reuse. */
  async teardown(): Promise<void> {
    await NativeAudioEffects.teardown();
    this.started = false;
  }

  // --------------------------------------------------------------- sources

  /**
   * Decode an audio file and make it playable.
   *
   * Accepts a `file://` URL, an Android `content://` URI from a document
   * picker, or an absolute path. The file is copied into the app cache (and
   * transcoded on Android where the platform decoder cannot read it), so the
   * source keeps working after a picker's temporary access expires.
   */
  async loadFile(uri: string): Promise<Source> {
    try {
      const result = (await NativeAudioEffects.loadFile(uri)) as LoadedSource;
      return new Source(result.sourceId, 'file', {
        durationSec: result.durationSec,
        sampleRate: result.sampleRate,
        channelCount: result.channelCount,
        peaks: result.peaks ?? [],
      });
    } catch (error) {
      return rethrowNativeError(error, { uri });
    }
  }

  /** Create a tone or noise generator. */
  async createOscillator(
    waveform: Waveform,
    config: OscillatorConfig = {}
  ): Promise<Source> {
    if (!isGeneratorAvailable(waveform)) {
      throw new Error(
        `Waveform "${waveform}" is not available on this platform.`
      );
    }
    const defaults = generatorDefaults(waveform);
    const sourceId = await NativeAudioEffects.createOscillator(waveform, {
      frequency: config.frequency ?? defaults.frequency,
      amplitude: config.amplitude ?? defaults.amplitude,
      antialias: config.antialias ?? true,
    });
    return new Source(
      sourceId,
      'generator',
      { durationSec: 0, sampleRate: 0, channelCount: 1, peaks: [] },
      waveform
    );
  }

  // -------------------------------------------------------------- metering

  /**
   * Turn level and progress events on or off.
   *
   * Native coalesces to `intervalMs`; events are never emitted per audio
   * buffer. 30 Hz is plenty for a meter — interpolate in the UI if you want
   * it smoother.
   */
  setMetering(enabled: boolean, intervalMs = 33): void {
    NativeAudioEffects.setMeteringEnabled(enabled, intervalMs);
  }

  onLevels(listener: (event: LevelsEvent) => void): Unsubscribe {
    const subscription = NativeAudioEffects.onLevels(listener);
    return () => subscription.remove();
  }

  onProgress(listener: (event: ProgressEvent) => void): Unsubscribe {
    const subscription = NativeAudioEffects.onProgress(listener);
    return () => subscription.remove();
  }

  /** Errors raised on the audio thread, outside any pending promise. */
  onError(listener: (event: AudioErrorEvent) => void): Unsubscribe {
    const subscription = NativeAudioEffects.onError(listener);
    return () => subscription.remove();
  }
}

export const AudioEngine = new AudioEngineImpl();
