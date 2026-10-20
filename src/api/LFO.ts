/**
 * A low-frequency oscillator that modulates parameters.
 *
 * Several effects have their own internal LFO — tremolo, chorus, phaser —
 * but those are wired to one fixed destination. This one drives *any*
 * parameter: a filter cutoff, a delay mix, a synth's amplitude.
 *
 * ## Why it runs in JavaScript
 *
 * Parameter writes are synchronous `void` TurboModule calls dispatched over
 * JSI, so a timer writing at 60 Hz costs no round-trip and competes with
 * nothing on the audio thread. That is fine for an LFO, which by definition
 * moves slowly: at the 20 Hz ceiling here there are still three updates per
 * cycle, and most musical use is under 8 Hz.
 *
 * It is not a replacement for audio-rate modulation. Anything that needs to
 * move at audio rate belongs in the DSP, which is why chorus and phaser keep
 * their internal LFOs rather than being driven from here.
 */

import { getParam, quantize } from '../schema';
import type { EffectLike } from './EffectLike';

export type LFOShape = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random';

export interface LFOTarget {
  /** Called with each new value. */
  write: (value: number) => void;
  /** Bottom of the sweep. */
  min: number;
  /** Top of the sweep. */
  max: number;
}

export interface LFOOptions {
  /** Cycles per second. Musical range is roughly 0.05 to 8. */
  rate?: number;
  shape?: LFOShape;
  /** 0 leaves the target at its centre; 1 sweeps the full range. */
  depth?: number;
  /** Update rate. 60 is smooth; drop it to save work on long sessions. */
  updateHz?: number;
}

/** Highest rate worth driving from a timer. */
const MAX_RATE_HZ = 20;

export class LFO {
  private timer: ReturnType<typeof setInterval> | undefined;
  private phase = 0;
  private randomValue = 0;
  private targets: LFOTarget[] = [];

  rate: number;
  shape: LFOShape;
  depth: number;
  private readonly updateHz: number;

  constructor(options: LFOOptions = {}) {
    this.rate = Math.min(MAX_RATE_HZ, Math.max(0.01, options.rate ?? 1));
    this.shape = options.shape ?? 'sine';
    this.depth = Math.min(1, Math.max(0, options.depth ?? 1));
    this.updateHz = options.updateHz ?? 60;
  }

  /** Modulate an arbitrary value. */
  add(target: LFOTarget): this {
    this.targets.push(target);
    return this;
  }

  /**
   * Modulate an effect parameter between two values.
   *
   * Bounds default to the parameter's own range from the schema, so
   * `lfo.addParam(filter, 'cutoff')` sweeps the whole filter without the
   * caller restating what that means.
   */
  addParam(
    effect: EffectLike,
    key: string,
    bounds?: { min?: number; max?: number }
  ): this {
    const param = getParam(effect.type, key);
    if (!param) {
      return this;
    }
    return this.add({
      min: bounds?.min ?? param.min,
      max: bounds?.max ?? param.max,
      write: (value) => effect.set(key, quantize(param, value)),
    });
  }

  start(): this {
    if (this.timer !== undefined) {
      return this;
    }
    const interval = 1000 / this.updateHz;
    this.timer = setInterval(() => this.tick(interval / 1000), interval);
    return this;
  }

  stop(): this {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    return this;
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Drop every target but keep running.
   *
   * Re-pointing an LFO needs this: `dispose` would also stop the timer, and
   * a UI that reassigns the destination should not have to restart it.
   */
  clear(): this {
    this.targets = [];
    return this;
  }

  /** Release the targets so an effect can be garbage collected. */
  dispose(): void {
    this.stop();
    this.targets = [];
  }

  private tick(deltaSeconds: number): void {
    const previousPhase = this.phase;
    this.phase = (this.phase + this.rate * deltaSeconds) % 1;

    // Sample-and-hold steps once per cycle, at the wrap.
    if (this.shape === 'random' && this.phase < previousPhase) {
      this.randomValue = Math.random() * 2 - 1;
    }

    const bipolar = this.valueAt(this.phase) * this.depth;
    for (const target of this.targets) {
      const centre = (target.min + target.max) / 2;
      const halfRange = (target.max - target.min) / 2;
      target.write(centre + bipolar * halfRange);
    }
  }

  /** Shape value in -1..1 for a normalised phase. */
  private valueAt(phase: number): number {
    switch (this.shape) {
      case 'sine':
        return Math.sin(2 * Math.PI * phase);
      case 'triangle':
        return 4 * Math.abs(phase - 0.5) - 1;
      case 'square':
        return phase < 0.5 ? 1 : -1;
      case 'sawtooth':
        return 2 * phase - 1;
      case 'random':
        return this.randomValue;
    }
  }
}
