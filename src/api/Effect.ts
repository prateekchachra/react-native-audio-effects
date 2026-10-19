/**
 * A single effect in a source's chain.
 */

import NativeAudioEffects from '../NativeAudioEffects';
import {
  defaultsFor,
  getEffect,
  getParam,
  quantize,
  type EffectDescriptor,
  type EffectType,
  type ParamDescriptor,
} from '../schema';
import { isParamAvailable } from './capabilities';

export class Effect {
  /** Native handle. */
  readonly id: number;
  readonly type: EffectType;
  /** Schema entry: ranges, tapers, units, labels. Drives the UI kit. */
  readonly descriptor: EffectDescriptor;

  private values: Record<string, number>;
  private bypassed = false;

  /** @internal — created by {@link Source.addEffect}. */
  constructor(id: number, type: EffectType) {
    const descriptor = getEffect(type);
    if (!descriptor) {
      throw new Error(`Unknown effect type "${type}"`);
    }
    this.id = id;
    this.type = type;
    this.descriptor = descriptor;
    this.values = defaultsFor(type);
  }

  /** Parameters this effect exposes, in display order. */
  get params(): readonly ParamDescriptor[] {
    return this.descriptor.params;
  }

  /**
   * Write one parameter.
   *
   * The value is clamped to the schema's range and snapped to the step grid
   * before it leaves JS, so what you read back matches what the DSP got.
   * Synchronous — cheap enough to call on every frame of a drag.
   */
  set(key: string, value: number): void {
    const param = getParam(this.type, key);
    if (!param) {
      if (__DEV__) {
        console.warn(
          `[audio-effects] "${key}" is not a parameter of "${this.type}".`
        );
      }
      return;
    }
    if (!isParamAvailable(this.type, key)) {
      if (__DEV__) {
        console.warn(
          `[audio-effects] "${this.type}.${key}" is not implemented on this ` +
            'platform and will be ignored. Check isParamAvailable() to ' +
            'disable the control instead.'
        );
      }
      return;
    }

    const quantized = quantize(param, value);
    this.values[key] = quantized;
    NativeAudioEffects.setParameter(this.id, key, quantized);
  }

  /** Last value written, or the schema default. */
  get(key: string): number {
    return this.values[key] ?? getParam(this.type, key)?.default ?? 0;
  }

  /**
   * Write several parameters at once.
   *
   * Preferred over repeated {@link set} calls for preset recalls and XY pads:
   * the batch is committed within a single audio cycle on Android, which
   * avoids the zipper noise of parameters landing on different cycles.
   */
  setMany(values: Record<string, number>): void {
    const changes: Array<{ effectId: number; key: string; value: number }> = [];
    for (const [key, value] of Object.entries(values)) {
      const param = getParam(this.type, key);
      if (!param || !isParamAvailable(this.type, key)) {
        continue;
      }
      const quantized = quantize(param, value);
      this.values[key] = quantized;
      changes.push({ effectId: this.id, key, value: quantized });
    }
    if (changes.length > 0) {
      NativeAudioEffects.setParameters(changes);
    }
  }

  /** Every current value, suitable for storing as a preset. */
  getValues(): Record<string, number> {
    return { ...this.values };
  }

  /** Restore every parameter to its schema default. */
  reset(): void {
    this.setMany(defaultsFor(this.type));
  }

  /** Bypass without removing from the chain. */
  get enabled(): boolean {
    return !this.bypassed;
  }

  set enabled(value: boolean) {
    this.bypassed = !value;
    NativeAudioEffects.setEffectEnabled(this.id, value);
  }
}
