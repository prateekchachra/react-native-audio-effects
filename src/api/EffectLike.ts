/**
 * The surface a control needs to drive something effect-shaped.
 *
 * A plain {@link Effect} is one native node. A synth voice stack is several
 * nodes that must move together — one delay per voice, all sharing a time
 * setting. Both satisfy this, so `EffectRack` can render either without
 * caring which it has.
 */

import type { EffectDescriptor, EffectType, ParamDescriptor } from '../schema';

export interface EffectLike {
  /** Stable identity for React keys. */
  readonly id: number;
  readonly type: EffectType;
  readonly descriptor: EffectDescriptor;
  readonly params: readonly ParamDescriptor[];
  set(key: string, value: number): void;
  get(key: string): number;
  enabled: boolean;
}
