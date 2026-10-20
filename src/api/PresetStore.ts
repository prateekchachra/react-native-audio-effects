/**
 * Saving and recalling user presets.
 *
 * ## Why storage is injected
 *
 * A preset is just JSON, so persisting one needs a key-value store — and
 * React Native has no built-in one. The obvious move is to depend on
 * `@react-native-async-storage/async-storage`, but that would force the
 * dependency on every consumer of this library including the ones that
 * keep presets on a server, in SQLite, or nowhere at all.
 *
 * So the store takes a {@link PresetStorage} and defaults to an in-memory
 * one. Two methods, both of which AsyncStorage already satisfies by
 * accident:
 *
 * ```ts
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * const presets = new PresetStore({ storage: AsyncStorage });
 * ```
 *
 * ## What a preset contains
 *
 * The whole chain, not one effect: which effects are present, in what
 * order, enabled or bypassed, and every parameter value. Recalling a
 * preset that only restored knob positions would be useless the moment
 * the user had a different set of effects loaded.
 */

import { getEffect, type EffectType } from '../schema';
import type { EffectLike } from './EffectLike';

/** The two methods this needs from a key-value store. */
export interface PresetStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

/** One effect's state within a preset. */
export interface PresetEffect {
  readonly type: EffectType;
  readonly enabled: boolean;
  readonly values: Readonly<Record<string, number>>;
}

export interface ChainPreset {
  readonly name: string;
  /** Unix milliseconds, so a UI can sort by most recent. */
  readonly savedAt: number;
  /** In signal order. */
  readonly effects: readonly PresetEffect[];
}

export interface PresetStoreOptions {
  storage?: PresetStorage;
  /**
   * Prefix for stored keys. Change it to keep two independent racks —
   * say a synth and a sampler — from overwriting each other's presets.
   */
  namespace?: string;
}

/** Bumped if the on-disk shape ever changes, so old data can be skipped. */
const FORMAT_VERSION = 1;

interface StoredFile {
  version: number;
  presets: ChainPreset[];
}

/** Fallback store. Survives navigation, not a relaunch. */
class MemoryStorage implements PresetStorage {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * Read every parameter off a live chain.
 *
 * Values come from the effects themselves rather than from UI state, so a
 * preset captures what is actually sounding — including anything moved by
 * an LFO or a preset recall that the UI never saw.
 */
export function captureChain(chain: readonly EffectLike[]): PresetEffect[] {
  return chain.map((effect) => {
    const values: Record<string, number> = {};
    for (const param of effect.params) {
      values[param.key] = effect.get(param.key);
    }
    return { type: effect.type, enabled: effect.enabled, values };
  });
}

/**
 * Apply a preset to a live chain.
 *
 * Matches by position and type. A slot whose effect type differs from the
 * preset's is left alone rather than being silently rewritten with values
 * that mean something else — `mix` on a reverb and `mix` on a distortion
 * are not the same control.
 *
 * @returns the indices that could not be applied, so a UI can offer to
 *   rebuild the chain.
 */
export function applyChain(
  chain: readonly EffectLike[],
  preset: ChainPreset
): number[] {
  const skipped: number[] = [];
  preset.effects.forEach((saved, index) => {
    const effect = chain[index];
    if (!effect || effect.type !== saved.type) {
      skipped.push(index);
      return;
    }
    const descriptor = getEffect(saved.type);
    for (const param of descriptor?.params ?? []) {
      const value = saved.values[param.key];
      // A preset saved before a parameter existed simply has no opinion
      // about it, which is not an error — leave it at its current value.
      if (typeof value === 'number' && Number.isFinite(value)) {
        effect.set(param.key, value);
      }
    }
    effect.enabled = saved.enabled;
  });
  return skipped;
}

export class PresetStore {
  private readonly storage: PresetStorage;
  private readonly key: string;
  /** Mirrors storage so reads are synchronous after the first load. */
  private cache: ChainPreset[] | undefined;

  constructor(options: PresetStoreOptions = {}) {
    this.storage = options.storage ?? new MemoryStorage();
    this.key = `${options.namespace ?? 'audio-effects'}:presets`;
  }

  /** Everything saved, most recent first. */
  async list(): Promise<ChainPreset[]> {
    if (this.cache) {
      return this.cache;
    }
    const raw = await this.storage.getItem(this.key);
    this.cache = raw ? parse(raw) : [];
    return this.cache;
  }

  /** Save the current state of a chain. An existing name is overwritten. */
  async save(name: string, chain: readonly EffectLike[]): Promise<ChainPreset> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('A preset needs a name.');
    }
    const preset: ChainPreset = {
      name: trimmed,
      savedAt: Date.now(),
      effects: captureChain(chain),
    };
    const existing = await this.list();
    const others = existing.filter((item) => item.name !== trimmed);
    await this.write([preset, ...others]);
    return preset;
  }

  async delete(name: string): Promise<void> {
    const existing = await this.list();
    await this.write(existing.filter((item) => item.name !== name));
  }

  async rename(from: string, to: string): Promise<void> {
    const trimmed = to.trim();
    if (!trimmed) {
      throw new Error('A preset needs a name.');
    }
    const existing = await this.list();
    await this.write(
      existing.map((item) =>
        item.name === from ? { ...item, name: trimmed } : item
      )
    );
  }

  /** Load a preset onto a chain. @returns indices that did not match. */
  async apply(name: string, chain: readonly EffectLike[]): Promise<number[]> {
    const preset = (await this.list()).find((item) => item.name === name);
    if (!preset) {
      throw new Error(`No preset named "${name}".`);
    }
    return applyChain(chain, preset);
  }

  /** Serialise everything, for export or backup. */
  async toJSON(): Promise<string> {
    return JSON.stringify(
      { version: FORMAT_VERSION, presets: await this.list() },
      null,
      2
    );
  }

  /** Merge presets from {@link toJSON}. Imported names win on collision. */
  async importJSON(json: string): Promise<number> {
    const incoming = parse(json);
    const names = new Set(incoming.map((preset) => preset.name));
    const existing = (await this.list()).filter(
      (preset) => !names.has(preset.name)
    );
    await this.write([...incoming, ...existing]);
    return incoming.length;
  }

  private async write(presets: ChainPreset[]): Promise<void> {
    this.cache = presets;
    const file: StoredFile = { version: FORMAT_VERSION, presets };
    await this.storage.setItem(this.key, JSON.stringify(file));
  }
}

/**
 * Read stored JSON back into presets.
 *
 * Deliberately total: storage can hold anything, including a half-written
 * file or data from a future version. A corrupt file costs the user their
 * presets, which is bad, but throwing on load would cost them the app.
 */
function parse(raw: string): ChainPreset[] {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFile>;
    if (parsed?.version !== FORMAT_VERSION || !Array.isArray(parsed.presets)) {
      return [];
    }
    return parsed.presets.filter(isPreset);
  } catch {
    return [];
  }
}

function isPreset(value: unknown): value is ChainPreset {
  const preset = value as Partial<ChainPreset>;
  return (
    typeof preset?.name === 'string' &&
    typeof preset.savedAt === 'number' &&
    Array.isArray(preset.effects)
  );
}
