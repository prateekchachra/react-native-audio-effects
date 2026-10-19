/**
 * Schema/native parity.
 *
 * The schema declares which effects and parameters each platform supports;
 * the native registries decide what actually gets built. If those disagree,
 * the failure mode is a control that moves and does nothing — the hardest
 * kind of audio bug to notice, because nothing errors.
 *
 * This test reads the native sources directly and compares them to the
 * schema, so the drift is caught in CI without needing a simulator or an
 * emulator. Parsing source text is unusual for a unit test, but it is the
 * only way to check both platforms from one place; every extraction below
 * fails loudly if its pattern stops matching, so the test cannot silently
 * start passing vacuously.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from '@jest/globals';

import { EFFECTS, EQ_BAND_COUNT, GENERATORS } from '../schema';
import { isParamSupported } from '../schema';

const IOS_EFFECTS_DIR = join(__dirname, '..', '..', 'ios', 'Effects');

/** `static let type = "delay"` → `delay` */
function extractType(source: string): string | undefined {
  return /static let type = "([^"]+)"/.exec(source)?.[1];
}

/** `static let supportedKeys = ["a", "b"]` → `['a','b']` */
function extractStaticKeys(source: string): string[] | undefined {
  const match = /static let supportedKeys = \[([\s\S]*?)\]/.exec(source);
  if (!match) {
    return undefined;
  }
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * The EQ builds its keys from the band count rather than listing them, so it
 * is reconstructed here the same way the Swift does.
 */
function eqKeys(): string[] {
  return Array.from({ length: EQ_BAND_COUNT }, (_, band) => [
    `band${band}Frequency`,
    `band${band}Gain`,
    `band${band}Q`,
  ]).flat();
}

/** Effect type → parameter keys, as iOS actually implements them. */
function readIosRegistry(): Record<string, string[]> {
  const registry: Record<string, string[]> = {};
  const files = readdirSync(IOS_EFFECTS_DIR).filter((f) =>
    f.endsWith('.swift')
  );

  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const source = readFileSync(join(IOS_EFFECTS_DIR, file), 'utf8');
    // A file may hold several effect classes, so split on class boundaries.
    const classes = source.split(/^final class /m).slice(1);
    for (const body of classes) {
      const type = extractType(body);
      if (!type) {
        continue;
      }
      const keys =
        extractStaticKeys(body) ??
        (type === 'parametricEq' ? eqKeys() : undefined);

      if (!keys) {
        throw new Error(
          `Could not extract supportedKeys for "${type}". The parity test's ` +
            'parser needs updating alongside the Swift.'
        );
      }
      registry[type] = keys;
    }
  }
  return registry;
}

describe('iOS native registry matches the schema', () => {
  const ios = readIosRegistry();

  it('parses a plausible number of effects out of the Swift', () => {
    // Guards against a parser change that quietly matches nothing.
    expect(Object.keys(ios).length).toBeGreaterThanOrEqual(15);
  });

  it('implements exactly the effects the schema marks as iOS', () => {
    const schemaTypes = EFFECTS.filter((e) => e.platforms.includes('ios'))
      .map((e) => e.type)
      .sort();
    expect(Object.keys(ios).sort()).toEqual(schemaTypes);
  });

  it('does not implement anything the schema marks Android-only', () => {
    const androidOnly = EFFECTS.filter((e) => !e.platforms.includes('ios')).map(
      (e) => e.type
    );
    for (const type of androidOnly) {
      expect(ios).not.toHaveProperty(type);
    }
  });

  describe.each(
    EFFECTS.filter((e) => e.platforms.includes('ios')).map(
      (e) => [e.type, e] as const
    )
  )('%s', (type, effect) => {
    it('implements every parameter the schema marks as iOS', () => {
      const expected = effect.params
        .filter((p) => isParamSupported(effect, p, 'ios'))
        .map((p) => p.key)
        .sort();
      expect([...(ios[type] ?? [])].sort()).toEqual(expected);
    });

    it('implements no parameter the schema marks Android-only', () => {
      const androidOnly = effect.params
        .filter((p) => !isParamSupported(effect, p, 'ios'))
        .map((p) => p.key);
      for (const key of androidOnly) {
        expect(ios[type]).not.toContain(key);
      }
    });
  });
});

const ANDROID_MAPPINGS = join(
  __dirname,
  '..',
  '..',
  'android',
  'src',
  'main',
  'java',
  'com',
  'audioeffects',
  'effects',
  'EffectMappings.kt'
);

/**
 * Effect type → parameter keys, as Android actually implements them.
 *
 * The Kotlin registry maps each schema type to either an inline
 * `DirectMapping(mapOf(...))` or a named object holding its own table, so
 * both shapes are resolved here.
 */
function readAndroidRegistry(): Record<string, string[]> {
  const source = readFileSync(ANDROID_MAPPINGS, 'utf8');

  // Named objects: `private object DelayMapping : ParamMapping { ... }`
  const namedTables: Record<string, string[]> = {};
  for (const match of source.matchAll(
    /private object (\w+Mapping)[\s\S]*?private val table = mapOf\(([\s\S]*?)\)\n/g
  )) {
    namedTables[match[1]!] = [...match[2]!.matchAll(/"([^"]+)"/g)].map(
      (m) => m[1]!
    );
  }

  const registryStart = source.indexOf('private val mappings');
  if (registryStart === -1) {
    throw new Error(
      'Could not locate the Kotlin effect registry. The parity test parser ' +
        'needs updating alongside EffectMappings.kt.'
    );
  }
  const registryBody = source.slice(registryStart);

  const registry: Record<string, string[]> = {};
  // Entries nest parentheses several levels deep, so each one's body is
  // taken by scanning for its balanced closing paren rather than by regex.
  for (const match of registryBody.matchAll(/"(\w+)" to \(/g)) {
    const type = match[1]!;
    let depth = 1;
    let index = match.index! + match[0].length;
    while (index < registryBody.length && depth > 0) {
      const char = registryBody[index];
      if (char === '(') depth++;
      else if (char === ')') depth--;
      index++;
    }
    const body = registryBody.slice(match.index! + match[0].length, index - 1);

    if (body.includes('ParametricEqMapping')) {
      registry[type] = eqKeys();
      continue;
    }

    const named = /to (\w+Mapping)\s*$/.exec(body.trim());
    if (named && namedTables[named[1]!]) {
      registry[type] = namedTables[named[1]!]!;
      continue;
    }

    const inline = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    if (inline.length === 0) {
      throw new Error(`Could not extract Kotlin parameter keys for "${type}".`);
    }
    registry[type] = inline;
  }
  return registry;
}

describe('Android native registry matches the schema', () => {
  const android = readAndroidRegistry();

  it('parses a plausible number of effects out of the Kotlin', () => {
    expect(Object.keys(android).length).toBeGreaterThanOrEqual(14);
  });

  it('implements exactly the effects the schema marks as Android', () => {
    const schemaTypes = EFFECTS.filter((e) => e.platforms.includes('android'))
      .map((e) => e.type)
      .sort();
    expect(Object.keys(android).sort()).toEqual(schemaTypes);
  });

  describe.each(
    EFFECTS.filter((e) => e.platforms.includes('android')).map(
      (e) => [e.type, e] as const
    )
  )('%s', (type, effect) => {
    it('implements every parameter the schema marks as Android', () => {
      const expected = effect.params
        .filter((p) => isParamSupported(effect, p, 'android'))
        .map((p) => p.key)
        .sort();
      expect([...(android[type] ?? [])].sort()).toEqual(expected);
    });

    it('implements no parameter the schema marks iOS-only', () => {
      const iosOnly = effect.params
        .filter((p) => !isParamSupported(effect, p, 'android'))
        .map((p) => p.key);
      for (const key of iosOnly) {
        expect(android[type]).not.toContain(key);
      }
    });
  });
});

describe('native generators match the schema', () => {
  const expected = GENERATORS.map((g) => g.waveform).sort();

  it('iOS lists the same waveforms', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'ios', 'Generators', 'GeneratorNode.swift'),
      'utf8'
    );
    const match = /static let waveforms = \[([\s\S]*?)\]/.exec(source);
    if (!match) {
      throw new Error('Could not extract the iOS waveform list.');
    }
    const native = [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(native.sort()).toEqual(expected);
  });

  it('Android lists the same waveforms', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'android',
        'src',
        'main',
        'java',
        'com',
        'audioeffects',
        'generators',
        'Generators.kt'
      ),
      'utf8'
    );
    const match = /val waveforms = listOf\(([\s\S]*?)\)/.exec(source);
    if (!match) {
      throw new Error('Could not extract the Android waveform list.');
    }
    const native = [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(native.sort()).toEqual(expected);
  });
});
