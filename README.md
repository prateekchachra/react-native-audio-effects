<img src="https://raw.githubusercontent.com/prateekchachra/react-native-audio-effects/main/assets/logo.svg" alt="react-native-audio-effects" width="420">

# react-native-audio-effects

[![npm version](https://img.shields.io/npm/v/react-native-audio-effects.svg?color=7c5cff)](https://www.npmjs.com/package/react-native-audio-effects)
[![npm downloads](https://img.shields.io/npm/dm/react-native-audio-effects.svg?color=7c5cff)](https://www.npmjs.com/package/react-native-audio-effects)
[![license](https://img.shields.io/npm/l/react-native-audio-effects.svg?color=7c5cff)](./LICENSE)
[![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-7c5cff.svg)](#what-runs-where)
[![New Architecture](https://img.shields.io/badge/New%20Architecture-TurboModule-7c5cff.svg)](https://reactnative.dev/architecture/landing-page)

Real-time audio effects, generators and plugin-style controls for React
Native's New Architecture.

Load a sound, build an effect chain, and tweak it while it plays — with
controls that are generated from the same parameter definitions the DSP reads,
so a knob can never disagree with the effect behind it.

<p align="center">
  <img src="https://raw.githubusercontent.com/prateekchachra/react-native-audio-effects/main/assets/scope-chord-1.png" alt="The oscilloscope drawing a B3 D4 F4 chord on a sawtooth" width="300">
  <img src="https://raw.githubusercontent.com/prateekchachra/react-native-audio-effects/main/assets/scope-chord-2.png" alt="The same chord a moment later, the trace having scrolled" width="300">
</p>

<p align="center">
  <em>One chord — B3, D4, F4 on a saw — three seconds apart. The three notes
  are summed the way air sums them, so the trace is a composite rather than a
  repeating ramp, and it scrolls faster the higher you play.</em>
</p>

- **17 effects** — delay, reverb, chorus, flanger, phaser, tremolo,
  compressor, limiter, noise gate, 4-band parametric EQ, low/high/band-pass
  filters, gain, pan, distortion, bit crusher.
- **7 generators** — sine, square, saw, triangle, and white/pink/brown noise,
  each with an ADSR envelope and a playable keyboard.
- **A live oscilloscope** — a Skia-drawn trace of the shape an oscillator is
  making, summing a chord into one composite wave and reading pitch as both
  density and speed. Optional: it lives behind its own entry point, so apps
  that do not want it never install Skia.
- **A control kit** — rotary knobs, taper-aware sliders, XY pads, level
  meters, a waveform view with scrub-to-seek, a MIDI keyboard, A/B preset
  compare, and an effect rack that builds itself from the schema.
- **TurboModule** on RN 0.88, Swift + AudioKit on iOS, Kotlin + Klarinet
  (Oboe) on Android.

**[Full API reference →](docs/API.md)**

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

// Two octaves, hold-to-sound.
<Keyboard
  startOctave={3}
  octaves={2}
  onNoteOn={(midi) => osc.setOscillatorParam('frequency', midiToFrequency(midi))}
  onNoteOff={() => osc.stop()}
/>;

// All 88 keys, scrolling, latching. Drive the highlight yourself.
<Keyboard
  fullRange
  onNoteOn={play}
  activeNotes={note !== undefined ? [note] : []}
/>;
```

`midiToFrequency` takes a tuning reference, so `midiToFrequency(69, 432)`
works if you need something other than A440.

### Modes, chords and unison

`PolySynth` turns the generators into a playable instrument. Polyphony is a
pool of generator sources rather than a native voice pool — the engine
already mixes any number of sources, so chords work today without touching
Swift or Kotlin.

```ts
const synth = await PolySynth.create({
  waveform: 'sawtooth',
  mode: 'poly',       // 'poly' | 'mono' | 'legato' | 'portamento'
  maxVoices: 8,
  unison: 3,          // oscillators stacked per note
  unisonSpread: 14,   // total detune across the stack, in cents
  glideMs: 120,       // portamento glide time
});

synth.noteOn(60);     // C4
synth.noteOn(64);     // stacks in poly; replaces the note in the mono modes
synth.noteOff(60);
synth.activeNotes;    // drive a Keyboard's highlight from this
```

| Mode | Behaviour |
| --- | --- |
| `poly` | Notes stack into chords. Re-pressing a sounding note releases it, so a touchscreen can build and unbuild a chord by tapping. Steals the oldest voice when the pool runs out. |
| `mono` | One note at a time; every note re-attacks the envelope. |
| `legato` | One note at a time; pitch changes but the envelope keeps running, so a phrase played without gaps swells once. |
| `portamento` | Legato, with the pitch gliding. Interpolated in log space, because a glide that is linear in hertz sounds like it rushes the top of the interval. |

> **`poly` and `unison` are not working yet on iOS.** They allocate several
> sources at once, and that runs into the same unresolved graph-mutation bug
> that affects effect chains — measured silent, where `mono`, `legato` and
> `portamento` all measure 0.117 RMS. Tracked with the chain bug; both are
> almost certainly the same root cause.

### LFO

Several effects have their own internal LFO, but each is wired to one fixed
destination. `LFO` drives *any* parameter.

```ts
const lfo = new LFO({ rate: 0.8, shape: 'sine', depth: 0.9 });
lfo.addParam(filter, 'cutoff', { min: 180, max: 9000 });
lfo.start();
```

Bounds default to the parameter's own range from the schema, so
`lfo.addParam(filter, 'cutoff')` sweeps the whole filter. Shapes are sine,
triangle, square, sawtooth and random (sample-and-hold).

It runs on a timer rather than in the DSP: parameter writes are synchronous
JSI calls, so 60 Hz costs nothing, and an LFO moves slowly by definition. It
is not a substitute for audio-rate modulation — that is why chorus and
phaser keep their internal oscillators.

### Envelopes

A raw oscillator is a continuous tone; an ADSR envelope is what turns it into
a note. Gate it per note rather than starting and stopping the source — the
stream stays up between notes, so there is no click and no restart latency.

```ts
osc.setEnvelopeParam('attack', 15);    // ms
osc.setEnvelopeParam('decay', 180);    // ms
osc.setEnvelopeParam('sustain', 0.6);  // level, 0..1
osc.setEnvelopeParam('release', 500);  // ms

await osc.play({ loop: true }); // start the stream once
osc.gate(true);                 // note on
osc.gate(false);                // note off, rings out over the release
```

Envelopes apply to generators, not to the effect chain: they are triggered by
note events rather than running continuously. On iOS this is AudioKit's
`AmplitudeEnvelope`; on Android it is a per-sample state machine in the stream
callback, since Klarinet has no envelope of its own.

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

## API reference

### `AudioEngine`

A singleton — there is one audio device, so it is not instantiated.

| Member | Description |
| --- | --- |
| `configure(options?)` | Prepare the engine and audio session. `{ sampleRate?, bufferFrames?, category? }`. Safe to call again. |
| `start()` | Start the output stream. |
| `stop()` | Stop output; sources and effects stay allocated. |
| `teardown()` | Release everything. Must be reconfigured before reuse. |
| `loadFile(uri)` | Decode a file into a `Source`. Accepts `file://`, `content://`, an absolute path, or a bundled asset path. |
| `createOscillator(waveform, config?)` | Create a generator `Source`. `{ frequency?, amplitude?, antialias? }`. |
| `setMetering(enabled, intervalMs?)` | Turn level and progress events on or off. Defaults to 33 ms. |
| `onLevels(listener)` | Subscribe to `{ sourceId, peakLeft, peakRight, rmsLeft, rmsRight }`. Returns an unsubscribe. |
| `onProgress(listener)` | Subscribe to `{ sourceId, positionSec, durationSec, isPlaying }`. |
| `onError(listener)` | Audio-thread errors, outside any pending promise. |
| `capabilities` | What this platform's backend implements. |
| `isStarted` | Whether the output stream is running. |

### `Source`

| Member | Description |
| --- | --- |
| `id`, `kind`, `waveform` | Native handle, `'file'` or `'generator'`, and the waveform for generators. |
| `info` | `{ durationSec, sampleRate, channelCount, peaks }`. `peaks` is interleaved min/max pairs for drawing. |
| `play({ loop? })` / `pause()` / `stop()` | Transport. |
| `seek(positionSec)` | File sources only. |
| `setVolume(amplitude)` | Linear 0..1. Synchronous. |
| `setOscillatorParam(key, value)` | `'frequency'` (Hz) or `'amplitude'` (0..1). Generators only. |
| `setEnvelopeParam(key, value)` | `'attack'`, `'decay'`, `'release'` in ms; `'sustain'` as 0..1. Generators only. |
| `gate(on)` | Note on / note off. A second note-on retriggers the attack. |
| `addEffect(type)` | Append to the chain. Rejects with `EffectUnavailableError` if unsupported. |
| `removeEffect(effect)` / `clearEffects()` | Remove one or all. |
| `reorder(effects)` | Reorder the chain; order changes the sound. |
| `effects` | The chain in signal order. |
| `release()` | Free the source and its chain. |

### `Effect`

| Member | Description |
| --- | --- |
| `id`, `type`, `descriptor` | Handle, schema type, and the full `EffectDescriptor`. |
| `params` | The parameters this effect exposes, in display order. |
| `set(key, value)` | Write one parameter. Clamped and snapped to the schema. Synchronous. |
| `setMany(values)` | Write several atomically, within one audio cycle. |
| `get(key)` | Last value written, or the schema default. |
| `getValues()` | Every value, suitable for storing as a preset. |
| `reset()` | Restore schema defaults. |
| `enabled` | Bypass without removing from the chain. |

### Capabilities

`getCapabilities()`, `isEffectAvailable(type)`, `isParamAvailable(type, key)`,
`isGeneratorAvailable(waveform)`.

### Schema

`EFFECTS`, `GENERATORS`, `ENVELOPE_PARAMS`, `EQ_BAND_COUNT`, and the
individual descriptors (`DELAY`, `REVERB`, `COMPRESSOR`, …).

Lookups: `getEffect(type)`, `getParam(type, key)`, `getGenerator(waveform)`,
`defaultsFor(type)`, `generatorDefaults(waveform)`, `envelopeDefaults()`,
`effectsForPlatform(platform)`, `isEffectSupported`, `isParamSupported`.

Value maths: `toNormalized`, `fromNormalized`, `quantize`, `nudge`, `clamp`.
Formatting: `formatValue`, `formatNumber`, `unitLabel`.
Pitch: `midiToFrequency`, `frequencyToMidi`, `noteName`, `isBlackKey`,
`octaveStart`.

### Hooks

`useAudioEngine(options?)`, `useSource(uri)`, `useOscillator(waveform, config?)`,
`useLevels(source, intervalMs?)`, `useProgress(source)`,
`useEffectParam(effect, key)`, `useEffectChain(source, types)`,
`useAudioErrors(listener)`.

### Errors

`AudioEffectsError` with a `code`, plus `EffectUnavailableError` and
`AudioFileError`. Codes: `NOT_CONFIGURED`, `SOURCE_NOT_FOUND`,
`EFFECT_NOT_FOUND`, `EFFECT_UNAVAILABLE`, `UNKNOWN_EFFECT`,
`UNKNOWN_WAVEFORM`, `FILE_NOT_FOUND`, `DECODE_FAILED`,
`INVALID_CHAIN_ORDER`, `ENGINE_FAILED`.

### Components — `react-native-audio-effects/ui`

| Component | Description |
| --- | --- |
| `<EffectRack>` | A whole chain, one panel per effect, generated from the schema. |
| `<EffectPanel>` | One effect's controls. `layout` is `'knobs'` or `'sliders'`. |
| `<Knob>` | Rotary control. Vertical drag, fine mode on horizontal travel, double-tap to reset. |
| `<EffectSlider>` | Taper-aware horizontal slider. |
| `<XYPad>` | Two parameters at once, written as one atomic batch. |
| `<LevelMeter>` | Peak and RMS on a decibel scale, with peak hold. |
| `<WaveformView>` | Waveform, playhead and scrub-to-seek. |
| `<Keyboard>` | MIDI keyboard. `fullRange` gives all 88 keys with horizontal scrolling. Latches by default; pass `onNoteOff` to hold. |
| `<PresetBar>` | Preset chips with A/B compare. |
| `ThemeProvider`, `darkTheme`, `lightTheme`, `useAudioTheme` | Theming. |
| `neuroRaised`, `neuroInner`, `neuroInset`, `labelStyle`, `readoutStyle` | Style helpers for building matching controls. |

## Theming

The kit ships a violet-on-near-black theme and a light variant, both with
soft neumorphic shading: a dark shadow below-right and a light one
above-left, so controls read as raised out of the panel rather than drawn on
it. Override any token, or set `depth: 0` to turn the shading off entirely.

```tsx
import { ThemeProvider, darkTheme } from 'react-native-audio-effects/ui';

<ThemeProvider value={{ ...darkTheme, accent: '#ff7ab6', depth: 0 }}>
  <App />
</ThemeProvider>;
```

Numeric readouts use a monospaced face so a value does not shift sideways as
its digits change under a drag — a small thing that is very visible once you
are dragging a knob.

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

- Polyphony — the generator is currently one voice, so a new note retunes the
  oscillator rather than layering
- Distortion and bit crusher on Android
- Shelving EQ band types (needs both backends to support them)
- Offline render to file
- Microphone input as a source

## License

Apache-2.0

## Sample Agent

Ask for a sound in plain English and get one back, loaded into the engine:

```ts
import { SampleAgent } from 'react-native-audio-effects';

const agent = new SampleAgent();
const { source, attribution } = await agent.fetch('a gritty 90bpm lofi drum loop');
await source.play({ loop: true });
```

It searches [Openverse](https://openverse.org), which **needs no API key** —
openly licensed audio from Freesound and other providers, working on a fresh
install with nothing configured. Splice has no public API, and Freesound's own
API requires a registered token, so Openverse is the only source that lets this
feature work out of the box.

`find()` returns the results and what the agent understood, if you want to
present a list rather than take the top hit:

```ts
const { query, results } = await agent.find('warm analog pad in F#m');
query.understood; // { key: 'F#m', terms: 'warm analog pad' }
```

### Licensing

Most results are CC-BY, where crediting the creator is a licence condition
rather than a courtesy. Every result carries its licence and creator, and
`attributionFor(result)` formats a usable credit line. Pass
`publicDomainOnly: true` to restrict to CC0 and public domain works, which
carry no attribution requirement.

### Using a language model

The built-in request parser is a vocabulary and a handful of regexes — instant,
free, offline, and right about tempo, key, duration and loop-vs-one-shot. Swap
in a model if you want better handling of phrasing it has no entry for:

```ts
new SampleAgent({
  interpret: async (prompt) => {
    const reply = await myModel(prompt);
    return { terms: reply.terms, bpm: reply.bpm, understood: {} };
  },
});
```

It is a hook rather than a dependency because every free model needs an API
key, and the feature has to work without one.

### Remote files generally

`AudioEngine.loadFile()` accepts `http(s)` URLs directly — the native importer
downloads into the same cache a picked document uses, so a sample from the
network behaves exactly like one off disk.

## Presets

`PresetStore` saves a whole chain: which effects are present, in what order,
their parameter values, and whether each is bypassed.

```ts
import { PresetStore } from 'react-native-audio-effects';
import AsyncStorage from '@react-native-async-storage/async-storage';

const presets = new PresetStore({ storage: AsyncStorage });
await presets.save('Dub Plate', chain);
const skipped = await presets.apply('Dub Plate', chain);
```

Storage is injected rather than depended on, so the library does not force
AsyncStorage on consumers who keep presets on a server or nowhere at all. The
default is in-memory.

Recall matches by position and type, and returns the indices it could not fill
rather than writing values into the wrong effect — `mix` on a reverb and `mix`
on a distortion are not the same control.

The `<PresetPanel>` component wires this to a UI. `<PresetBar>` is the separate,
session-only A/B comparison workflow.
