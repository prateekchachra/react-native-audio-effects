/**
 * A playable source — an imported file or a generator — and its effect chain.
 */

import NativeAudioEffects from '../NativeAudioEffects';
import type { EffectType, Waveform } from '../schema';
import { Effect } from './Effect';
import { rethrowNativeError } from './errors';

export interface SourceInfo {
  readonly durationSec: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  /**
   * Interleaved min/max pairs in -1..1 for drawing a waveform.
   * Empty for generators, which have no fixed length.
   */
  readonly peaks: readonly number[];
}

export class Source {
  readonly id: number;
  readonly kind: 'file' | 'generator';
  readonly info: SourceInfo;
  /** Set for generators. */
  readonly waveform?: Waveform;

  private chain: Effect[] = [];
  private released = false;

  /** @internal — created by the engine. */
  constructor(
    id: number,
    kind: 'file' | 'generator',
    info: SourceInfo,
    waveform?: Waveform
  ) {
    this.id = id;
    this.kind = kind;
    this.info = info;
    this.waveform = waveform;
  }

  /** The chain in signal order: audio flows through index 0 first. */
  get effects(): readonly Effect[] {
    return this.chain;
  }

  // -------------------------------------------------------------- playback

  async play(options: { loop?: boolean } = {}): Promise<void> {
    this.assertLive();
    await NativeAudioEffects.playSource(this.id, options.loop ?? false);
  }

  async pause(): Promise<void> {
    this.assertLive();
    await NativeAudioEffects.pauseSource(this.id);
  }

  async stop(): Promise<void> {
    this.assertLive();
    await NativeAudioEffects.stopSource(this.id);
  }

  async seek(positionSec: number): Promise<void> {
    this.assertLive();
    await NativeAudioEffects.seekSource(this.id, positionSec);
  }

  /** Output level as linear amplitude, 0..1. Synchronous. */
  setVolume(volume: number): void {
    this.assertLive();
    NativeAudioEffects.setSourceVolume(
      this.id,
      Math.min(1, Math.max(0, volume))
    );
  }

  // ----------------------------------------------------------------- chain

  /**
   * Append an effect to the end of the chain.
   *
   * @throws {EffectUnavailableError} when the platform has no implementation.
   */
  async addEffect(type: EffectType): Promise<Effect> {
    this.assertLive();
    try {
      const id = await NativeAudioEffects.createEffect(this.id, type);
      const effect = new Effect(id, type);
      this.chain.push(effect);
      // Push the schema defaults down so native and JS start in agreement
      // rather than relying on each backend's own idea of a default.
      effect.reset();
      return effect;
    } catch (error) {
      return rethrowNativeError(error, { effectType: type });
    }
  }

  async removeEffect(effect: Effect): Promise<void> {
    this.assertLive();
    const index = this.chain.indexOf(effect);
    if (index === -1) {
      return;
    }
    await NativeAudioEffects.removeEffect(effect.id);
    this.chain.splice(index, 1);
  }

  /**
   * Reorder the chain. `order` must contain exactly the current effects.
   *
   * Order matters sonically: compression before reverb tightens the source,
   * after it pumps the tail.
   */
  async reorder(order: readonly Effect[]): Promise<void> {
    this.assertLive();
    await NativeAudioEffects.reorderChain(
      this.id,
      order.map((effect) => effect.id)
    );
    this.chain = [...order];
  }

  /** Remove every effect from the chain. */
  async clearEffects(): Promise<void> {
    for (const effect of [...this.chain]) {
      await this.removeEffect(effect);
    }
  }

  // --------------------------------------------------------------- cleanup

  /** Release the source and its chain. The instance is unusable afterwards. */
  async release(): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;
    this.chain = [];
    await NativeAudioEffects.releaseSource(this.id);
  }

  get isReleased(): boolean {
    return this.released;
  }

  private assertLive(): void {
    if (this.released) {
      throw new Error(
        `Source ${this.id} has been released and can no longer be used.`
      );
    }
  }
}
