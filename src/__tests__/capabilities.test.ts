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

describe('iOS generators match the schema', () => {
  it('lists the same waveforms', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'ios', 'Generators', 'GeneratorNode.swift'),
      'utf8'
    );
    const match = /static let waveforms = \[([\s\S]*?)\]/.exec(source);
    if (!match) {
      throw new Error('Could not extract the iOS waveform list.');
    }
    const native = [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(native.sort()).toEqual(GENERATORS.map((g) => g.waveform).sort());
  });
});
