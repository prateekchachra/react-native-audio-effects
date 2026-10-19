# react-native-audio-effects

Real-time audio effects, generators and plugin-style controls for React
Native's New Architecture.

Load a sound, build an effect chain, and tweak it while it plays — with
controls that are generated from the same parameter definitions the DSP reads,
so a knob can never disagree with the effect behind it.

- **17 effects** — delay, reverb, chorus, flanger, phaser, tremolo,
  compressor, limiter, noise gate, 4-band parametric EQ, low/high/band-pass
  filters, gain, pan, distortion, bit crusher.
- **7 generators** — sine, square, saw, triangle, and white/pink/brown noise.
- **A control kit** — rotary knobs, taper-aware sliders, XY pads, level
  meters, a waveform view with scrub-to-seek, A/B preset compare, and an
  effect rack that builds itself from the schema.
- **TurboModule** on RN 0.88, Swift + AudioKit on iOS, Kotlin + Klarinet
  (Oboe) on Android.

## Install

```sh
npm install react-native-audio-effects
cd ios && USE_FRAMEWORKS=dynamic pod install
```

### iOS

AudioKit is distributed through Swift Package Manager only — it stopped
publishing to CocoaPods after 5.1.0. The podspec declares it with React
Native's `spm_dependency` helper, so `pod install` pulls it in for you, but
Swift packages linked into *statically* linked pods fail at link time. Add
this to your Podfile:

```ruby
use_frameworks! :linkage => :dynamic
```

### Android

Klarinet publishes Kotlin 2.4 metadata and React Native 0.88 pins Kotlin
2.2.0, so the build needs to be moved up to 2.4. In `android/build.gradle`:

```groovy
buildscript {
    ext { kotlinVersion = "2.4.20" }
    configurations.classpath {
        resolutionStrategy.eachDependency { details ->
            if (details.requested.group == "org.jetbrains.kotlin") {
                details.useVersion(kotlinVersion)
            }
        }
    }
}
```

`minSdkVersion` must be at least 24. Klarinet ships `arm64-v8a`,
`armeabi-v7a` and `x86_64` — there is no `x86` slice, so old emulator images
will not run.

### Optional peer dependencies

The audio API has none. The control kit needs:

```sh
npm install react-native-reanimated react-native-worklets \
            react-native-gesture-handler react-native-svg
```

and file import needs `@react-native-documents/picker`. They are declared
optional, and the controls live at `react-native-audio-effects/ui` so that an
app using only the audio API never pulls them in.

## Usage

```ts
import { AudioEngine } from 'react-native-audio-effects';

await AudioEngine.configure();
await AudioEngine.start();

const source = await AudioEngine.loadFile(uri);

const delay = await source.addEffect('delay');
delay.set('time', 300);      // ms
delay.set('feedback', 0.45);
delay.set('mix', 0.3);

const reverb = await source.addEffect('reverb');
reverb.set('roomSize', 0.8);

await source.play({ loop: true });
```

Order matters: audio flows through the chain in the order effects were added.
Compression before reverb tightens the source; after it, the tail pumps.

### Controls

Every control takes a `ParamDescriptor` from the schema, so its range, curve,
unit and formatting come from the same place the native adapter reads.

```tsx
import { EffectRack, Knob } from 'react-native-audio-effects/ui';

// A whole chain, laid out automatically.
<EffectRack effects={source.effects} onRemove={remove} />

// Or one parameter at a time.
<Knob
  param={delay.descriptor.params[0]}
  value={delay.get('time')}
  onChange={(value) => delay.set('time', value)}
/>
```

The knob drag runs on the UI thread through a Gesture Handler worklet, so it
keeps tracking your finger even while JS is busy decoding a file.

### Generators

```ts
const osc = await AudioEngine.createOscillator('sawtooth', {
  frequency: 110,
  amplitude: 0.4,
});
await osc.play({ loop: true });
osc.setOscillatorParam('frequency', 220);
```

### Playing notes

Generators are driven in hertz, but music is thought about in notes, so the
kit ships a playable keyboard and the conversion to go with it. Note numbers
are standard MIDI, so the same handlers accept input from a controller or a
sequencer without translation.

```tsx
import { midiToFrequency, noteName } from 'react-native-audio-effects';
import { Keyboard } from 'react-native-audio-effects/ui';

<Keyboard
  startOctave={3}
  octaves={2}
  onNoteOn={(midi) => osc.setOscillatorParam('frequency', midiToFrequency(midi))}
  onNoteOff={() => osc.stop()}
/>;
```

`midiToFrequency` takes a tuning reference, so `midiToFrequency(69, 432)`
works if you need something other than A440.

### Metering

```ts
AudioEngine.setMetering(true, 33); // 30 Hz
const stop = AudioEngine.onLevels(({ sourceId, rmsLeft, rmsRight }) => { … });
```

Levels are coalesced natively and never emitted per audio buffer. The waveform
is computed once at load and returned from `loadFile` as `source.info.peaks`,
rather than streamed.

## What runs where

The two DSP backends are not feature-identical, and the library does not
pretend otherwise. Anything one platform cannot do is reported through
`getCapabilities()`, flagged in the schema, and disabled in the UI — creating
an unavailable effect **rejects** rather than returning a handle that silently
does nothing.

| Effect | iOS (AudioKit) | Android (Klarinet) |
| --- | --- | --- |
| gain, pan | ✅ | ✅ |
| delay | ✅ (plus a `tone` damping filter) | ✅ |
| reverb | ✅ Costello FDN | ✅ Freeverb (plus `width`) |
| chorus, flanger | ✅ | ✅ |
| phaser | ✅ | ✅ (plus `stages`) |
| tremolo | ✅ | ✅ |
| compressor, limiter | ✅ | ✅ |
| noise gate | ✅ | ✅ (plus `hold`) |
| 4-band parametric EQ | ✅ | ✅ |
| low / high / band-pass | ✅ | ✅ |
| **distortion, bit crusher** | ✅ | ❌ no Klarinet equivalent |

```ts
import { isEffectAvailable, isParamAvailable } from 'react-native-audio-effects';

isEffectAvailable('bitCrusher');        // false on Android
isParamAvailable('reverb', 'width');    // false on iOS
```

Where both platforms implement a parameter but disagree on its range, the
schema takes the **narrower** one, so a legal value sounds the same on both
instead of being silently clamped on one. That is why the EQ caps at ±20 dB
(Apple's limit) and the gate floors at −40 dB.

Generators differ in implementation: iOS uses AudioKit's band-limited
wavetables, Android synthesises with PolyBLEP in the stream callback. They are
perceptually equivalent but not sample-identical at high fundamentals.

## Architecture

`src/schema` is the single source of truth. Every parameter's range, taper,
unit and per-platform availability is declared once, and three things read it:
the TurboModule wire format, the two native adapters, and the control kit.

A test reads the Swift and Kotlin registries directly and fails if either
stops matching the schema. Without it the failure mode is a control that moves
and does nothing — which nothing else would catch, because nothing errors.

```
src/schema      ranges, tapers, units, platform flags
src/api         Engine, Source, Effect handles over the TurboModule
src/ui          controls, all driven by ParamDescriptor
ios/Effects     Swift adapters; own all unit conversion
android/effects Kotlin mappings; own all unit conversion
```

Parameter writes are synchronous `void` TurboModule methods, dispatched
straight over JSI, so a knob at 60 fps costs no round-trip. `setParameters`
applies a batch within one audio cycle, which is what keeps an XY pad or a
preset recall from zippering.

## Diagnostics

`example/src/selfCheck.ts` drives the whole path and reports measured signal
levels. Flip `RUN_SELF_CHECK_ON_LAUNCH` in `example/src/App.tsx`:

```
PASS loadFile :: 8.78s, 44100Hz, 2ch, 1951/2000 non-zero peaks
PASS file playback produces signal :: peak RMS over 1.5s = 0.13874
PASS generator sine :: peak RMS = 0.35550
```

## Migrating from 1.x

2.0 is a rewrite. The old architecture it was built on was removed in React
Native 0.82, and v1 could not be installed into a working app regardless —
its podspec depended on CocoaPods packages that do not exist, and it had no
Android implementation at all.

| v1 | v2 |
| --- | --- |
| `playSound(loop, file, db)` | `const s = await AudioEngine.loadFile(uri); await s.play({ loop })` |
| `stopSound()` | `source.stop()` |
| `playWhiteNoise(db)` | `AudioEngine.createOscillator('whiteNoise', { amplitude })` |
| `addDelayToSound(mix, time, fb, lp)` | `const d = await source.addEffect('delay'); d.setMany({ … })` |

Delay time is now **milliseconds** (it was seconds), and mix/feedback are
0..1. Call `AudioEngine.configure()` and `start()` once before anything else.

## Roadmap

- Distortion and bit crusher on Android
- Shelving EQ band types (needs both backends to support them)
- Offline render to file
- Microphone input as a source

## License

Apache-2.0
