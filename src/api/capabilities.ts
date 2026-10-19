/**
 * What the running platform's backend actually implements.
 *
 * Read once from native and cached. The schema declares what *should* exist
 * per platform; this reports what the native registry really built. The parity
 * test asserts the two agree, so a backend that silently loses an effect fails
 * CI rather than the user's ears.
 */

import NativeAudioEffects from '../NativeAudioEffects';
import type { EffectType, Waveform } from '../schema';

export interface Capabilities {
  /** Parameter keys implemented per effect, for effects that exist at all. */
  readonly effects: Readonly<Record<string, readonly string[]>>;
  readonly generators: readonly string[];
}

let cached: Capabilities | undefined;

export function getCapabilities(): Capabilities {
  if (!cached) {
    const parsed = JSON.parse(
      NativeAudioEffects.getCapabilitiesJSON()
    ) as Capabilities;
    cached = {
      effects: parsed.effects ?? {},
      generators: parsed.generators ?? [],
    };
  }
  return cached;
}

/** Whether an effect can be created on this platform. */
export function isEffectAvailable(type: EffectType): boolean {
  return type in getCapabilities().effects;
}

/**
 * Whether a specific parameter is implemented here.
 *
 * Use this to disable a control rather than letting a write disappear —
 * `setParameter` on an unimplemented key is ignored natively.
 */
export function isParamAvailable(type: EffectType, key: string): boolean {
  return getCapabilities().effects[type]?.includes(key) ?? false;
}

/** Whether a generator waveform can be created on this platform. */
export function isGeneratorAvailable(waveform: Waveform): boolean {
  return getCapabilities().generators.includes(waveform);
}

/** Only meaningful in tests, which swap the native module between cases. */
export function resetCapabilitiesCache(): void {
  cached = undefined;
}
