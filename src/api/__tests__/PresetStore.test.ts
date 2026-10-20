import { describe, expect, it } from '@jest/globals';

import type { EffectLike } from '../EffectLike';
import {
  applyChain,
  captureChain,
  PresetStore,
  type PresetStorage,
} from '../PresetStore';
import { getEffect, type EffectType } from '../../schema';

/** A chain element backed by a plain object, so no native module is needed. */
function fakeEffect(type: EffectType, id: number): EffectLike {
  const descriptor = getEffect(type);
  if (!descriptor) {
    throw new Error(`no descriptor for ${type}`);
  }
  const values = new Map<string, number>(
    descriptor.params.map((param) => [param.key, param.default])
  );
  return {
    id,
    type,
    descriptor,
    params: descriptor.params,
    enabled: true,
    set(key, value) {
      values.set(key, value);
    },
    get(key) {
      return values.get(key) ?? 0;
    },
  };
}

/** Records writes so a test can assert what reached storage. */
class FakeStorage implements PresetStorage {
  readonly data = new Map<string, string>();
  writes = 0;

  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.writes += 1;
    this.data.set(key, value);
  }
}

describe('captureChain', () => {
  it('reads every parameter the descriptor declares', () => {
    const delay = fakeEffect('delay', 1);
    const captured = captureChain([delay]);

    expect(captured).toHaveLength(1);
    expect(Object.keys(captured[0]!.values).sort()).toEqual(
      delay.params.map((param) => param.key).sort()
    );
  });

  it('captures live values rather than defaults', () => {
    const delay = fakeEffect('delay', 1);
    delay.set('feedback', 0.8);

    expect(captureChain([delay])[0]!.values.feedback).toBe(0.8);
  });

  it('captures bypass state', () => {
    const delay = fakeEffect('delay', 1);
    delay.enabled = false;

    expect(captureChain([delay])[0]!.enabled).toBe(false);
  });
});

describe('applyChain', () => {
  it('restores values onto a matching chain', () => {
    const saved = fakeEffect('delay', 1);
    saved.set('feedback', 0.7);
    const preset = { name: 'p', savedAt: 0, effects: captureChain([saved]) };

    const live = fakeEffect('delay', 2);
    expect(applyChain([live], preset)).toEqual([]);
    expect(live.get('feedback')).toBe(0.7);
  });

  it('skips a slot whose type does not match instead of writing into it', () => {
    const preset = {
      name: 'p',
      savedAt: 0,
      effects: captureChain([fakeEffect('delay', 1)]),
    };
    const live = fakeEffect('reverb', 2);
    const before = live.get('mix');

    expect(applyChain([live], preset)).toEqual([0]);
    expect(live.get('mix')).toBe(before);
  });

  it('reports slots the chain is too short for', () => {
    const preset = {
      name: 'p',
      savedAt: 0,
      effects: captureChain([fakeEffect('delay', 1), fakeEffect('reverb', 2)]),
    };

    expect(applyChain([fakeEffect('delay', 3)], preset)).toEqual([1]);
  });

  it('leaves a parameter alone when the preset predates it', () => {
    const live = fakeEffect('delay', 1);
    live.set('feedback', 0.42);
    const preset = {
      name: 'old',
      savedAt: 0,
      effects: [{ type: 'delay' as const, enabled: true, values: {} }],
    };

    applyChain([live], preset);
    expect(live.get('feedback')).toBe(0.42);
  });

  it('ignores a non-finite stored value', () => {
    const live = fakeEffect('delay', 1);
    live.set('feedback', 0.3);
    applyChain([live], {
      name: 'bad',
      savedAt: 0,
      effects: [
        { type: 'delay', enabled: true, values: { feedback: Number.NaN } },
      ],
    });

    expect(live.get('feedback')).toBe(0.3);
  });
});

describe('PresetStore', () => {
  it('round-trips a preset through storage', async () => {
    const storage = new FakeStorage();
    const chain = [fakeEffect('delay', 1)];
    chain[0]!.set('feedback', 0.65);

    await new PresetStore({ storage }).save('Dub', chain);

    // A second store shares only the storage, so this proves persistence
    // rather than the in-memory cache.
    const reloaded = new PresetStore({ storage });
    const live = [fakeEffect('delay', 2)];
    await reloaded.apply('Dub', live);

    expect(live[0]!.get('feedback')).toBe(0.65);
  });

  it('overwrites a preset saved under an existing name', async () => {
    const store = new PresetStore({ storage: new FakeStorage() });
    const chain = [fakeEffect('delay', 1)];

    await store.save('Same', chain);
    chain[0]!.set('feedback', 0.9);
    await store.save('Same', chain);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.effects[0]!.values.feedback).toBe(0.9);
  });

  it('lists most recent first', async () => {
    const store = new PresetStore({ storage: new FakeStorage() });
    await store.save('first', [fakeEffect('delay', 1)]);
    await store.save('second', [fakeEffect('delay', 1)]);

    expect((await store.list()).map((preset) => preset.name)).toEqual([
      'second',
      'first',
    ]);
  });

  it('rejects a blank name rather than saving an unfindable preset', async () => {
    const store = new PresetStore({ storage: new FakeStorage() });
    await expect(store.save('   ', [fakeEffect('delay', 1)])).rejects.toThrow();
  });

  it('trims the name so two presets cannot collide invisibly', async () => {
    const store = new PresetStore({ storage: new FakeStorage() });
    await store.save('  Pad  ', [fakeEffect('delay', 1)]);
    await store.save('Pad', [fakeEffect('delay', 1)]);

    expect(await store.list()).toHaveLength(1);
  });

  it('deletes', async () => {
    const store = new PresetStore({ storage: new FakeStorage() });
    await store.save('gone', [fakeEffect('delay', 1)]);
    await store.delete('gone');

    expect(await store.list()).toEqual([]);
  });

  it('throws on recalling a name that is not there', async () => {
    const store = new PresetStore({ storage: new FakeStorage() });
    await expect(store.apply('nope', [])).rejects.toThrow('nope');
  });

  it('keeps two namespaces apart', async () => {
    const storage = new FakeStorage();
    await new PresetStore({ storage, namespace: 'synth' }).save('a', [
      fakeEffect('delay', 1),
    ]);
    const sampler = new PresetStore({ storage, namespace: 'sampler' });

    expect(await sampler.list()).toEqual([]);
  });

  it('survives corrupt stored data instead of throwing', async () => {
    const storage = new FakeStorage();
    storage.data.set('audio-effects:presets', '{ not json');

    expect(await new PresetStore({ storage }).list()).toEqual([]);
  });

  it('discards data written by a different format version', async () => {
    const storage = new FakeStorage();
    storage.data.set(
      'audio-effects:presets',
      JSON.stringify({ version: 999, presets: [{ name: 'x' }] })
    );

    expect(await new PresetStore({ storage }).list()).toEqual([]);
  });

  it('imports presets, preferring the incoming copy on a name clash', async () => {
    const source = new PresetStore({ storage: new FakeStorage() });
    const chain = [fakeEffect('delay', 1)];
    chain[0]!.set('feedback', 0.11);
    await source.save('Shared', chain);
    const json = await source.toJSON();

    const target = new PresetStore({ storage: new FakeStorage() });
    const other = [fakeEffect('delay', 2)];
    other[0]!.set('feedback', 0.99);
    await target.save('Shared', other);

    expect(await target.importJSON(json)).toBe(1);
    const list = await target.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.effects[0]!.values.feedback).toBe(0.11);
  });

  it('defaults to a store that works without any storage wired up', async () => {
    const store = new PresetStore();
    await store.save('mem', [fakeEffect('delay', 1)]);

    expect((await store.list())[0]!.name).toBe('mem');
  });
});
