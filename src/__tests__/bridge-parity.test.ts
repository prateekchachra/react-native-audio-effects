/**
 * Every TurboModule method must exist in every native layer.
 *
 * Adding a method to the spec means touching four files: the TypeScript
 * spec, the Objective-C++ bridge, the Swift implementation behind it, and
 * the Kotlin module. Miss one and nothing complains — codegen does not
 * verify the hand-written bridge, the project compiles, and the failure
 * arrives at runtime as `setSourcePan is not a function`.
 *
 * That exact bug shipped: `setSourcePan` was added to the spec, to Swift,
 * and to Kotlin, but not to `AudioEffects.mm`. It then crashed on every
 * note, because a unison stack pans each voice as it tunes it.
 *
 * Grepping for an identifier is crude, but it catches the one mistake
 * that actually happens here — a whole method forgotten in one file —
 * and it costs nothing to run.
 *
 * ## What this cannot catch
 *
 * There is a fifth layer: the Objective-C protocol that codegen emits
 * from the spec. It is generated at `pod install` time, **not** during
 * `xcodebuild`, so adding a spec method and rebuilding leaves the
 * generated protocol stale and the method invisible to JS — with all
 * four hand-written layers correct. The symptom is identical to a
 * missing bridge method, which makes it genuinely confusing.
 *
 * If a method exists everywhere this test looks and JS still reports
 * "undefined is not a function", the generated spec is stale. Re-run
 * `pod install` in the consuming app before looking anywhere else.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

const SPEC = 'src/NativeAudioEffects.ts';
const LAYERS = {
  'Objective-C++ bridge': 'ios/AudioEffects.mm',
  'Swift implementation': 'ios/AudioEffectsImpl.swift',
  'Kotlin module':
    'android/src/main/java/com/audioeffects/AudioEffectsModule.kt',
} as const;

/**
 * Methods whose native name differs from the spec name, mapped to what to
 * look for instead. Keep this small: each entry is a place where the
 * check is weaker than it looks.
 */
const RENAMED: Record<string, Partial<Record<keyof typeof LAYERS, string>>> = {
  // The Swift side drops the `get` prefix, per Swift naming convention;
  // the .mm maps the two together.
  getCapabilitiesJSON: { 'Swift implementation': 'capabilitiesJSON' },
};

/** Method names declared on the `Spec` interface. */
function specMethods(): string[] {
  const source = read(SPEC);
  const body = source.slice(source.indexOf('export interface Spec'));
  const names = [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9_]*)\s*\(/gm)].map(
    (match) => match[1]!
  );
  return [...new Set(names)];
}

describe('TurboModule bridge parity', () => {
  const methods = specMethods();

  it('finds the spec methods at all, so the test cannot pass vacuously', () => {
    expect(methods.length).toBeGreaterThan(15);
    expect(methods).toContain('setSourcePan');
    expect(methods).toContain('loadFile');
  });

  describe.each(Object.entries(LAYERS))('%s', (layerName, path) => {
    const source = read(path);

    it.each(methods)('implements %s', (method) => {
      const expected =
        RENAMED[method]?.[layerName as keyof typeof LAYERS] ?? method;
      expect(source).toContain(expected);
    });
  });
});
