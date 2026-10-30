# API Reference

Everything on this page is public and exported from the package. Two entry
points:

```ts
import { AudioEngine, PolySynth, SampleAgent } from 'react-native-audio-effects';
import { Knob, EffectRack, LFOPanel } from 'react-native-audio-effects/ui';
```

The UI kit is a separate subpath so apps that only need audio do not pull in
Reanimated, Gesture Handler and SVG.

---

## Contents

- [AudioEngine](#audioengine) — lifecycle, loading, events
- [Source](#source) — one playable thing
- [Effect](#effect) — one node in a chain
- [PolySynth](#polysynth) — polyphonic voice pool
- [LFO](#lfo) — parameter modulation
- [PresetStore](#presetstore) — saving chains
- [SampleAgent](#sampleagent) — plain-English sample search
- [Hooks](#hooks)
- [Schema](#schema) — the single source of truth
- [UI kit](#ui-kit)
- [Adding a method to the native module](#adding-a-method-to-the-native-module)
- [Errors](#errors)
- [Platform differences](#platform-differences)

---

## AudioEngine

A singleton. Everything starts here.

| Member | Signature | Notes |
|---|---|---|
| `configure` | `(options?: EngineOptions) => Promise<void>` | Sample rate, buffer size, audio session category. |
| `start` | `() => Promise<void>` | |
| `stop` | `() => Promise<void>` | |
| `teardown` | `() => Promise<void>` | Releases every source and the engine. |
| `loadFile` | `(uri: string) => Promise<Source>` | Local path, `file://`, `content://`, bundle-relative, **or `http(s)`**. |
| `createOscillator` | `(waveform, options?) => Promise<Source>` | |
| `setMetering` | `(enabled: boolean, intervalMs?) => void` | Default 33 ms. Off by default. |
| `onLevels` | `(cb) => Unsubscribe` | |
| `onProgress` | `(cb) => Unsubscribe` | Low rate; interpolate in the UI. |
| `onError` | `(cb) => Unsubscribe` | |
| `capabilities` | getter | What this platform actually supports. |
| `isStarted` | getter | |

`loadFile` accepts remote URLs directly — the native importer downloads into
the cache it already owns on both platforms, so a network sample behaves
exactly like one off disk. No JS-side filesystem dependency.

```ts
await AudioEngine.configure({ sampleRate: 48000 });
await AudioEngine.start();
const source = await AudioEngine.loadFile('https://example.com/loop.mp3');
```

---

## Source

One playable thing — a file or a generator — with its own effect chain.

| Member | Signature | Notes |
|---|---|---|
| `play` | `(options?: { loop?: boolean }) => Promise<void>` | |
| `pause` / `stop` | `() => Promise<void>` | |
| `seek` | `(positionSec: number) => Promise<void>` | |
| `setVolume` | `(volume: number) => void` | 0–1. Synchronous. |
| `setPan` | `(pan: number) => void` | −1 left, 1 right. Applied **after** the chain, so it survives effect edits. |
| `setOscillatorParam` | `(key: 'frequency' \| 'amplitude', value) => void` | Generators only. |
| `setEnvelopeParam` | `(key, value) => void` | ADSR. |
| `gate` | `(on: boolean) => void` | Note on/off against the envelope. |
| `addEffect` | `(type: EffectType) => Promise<Effect>` | |
| `removeEffect` | `(effect: Effect) => Promise<void>` | |
| `reorder` | `(order: readonly Effect[]) => Promise<void>` | Must be a permutation. |
| `clearEffects` | `() => Promise<void>` | |
| `release` | `() => Promise<void>` | |
| `effects` / `isReleased` | getters | |

### Why some methods are sync and others return promises

Anything that **mutates the graph** is async — it crosses to the audio queue,
rebuilds nodes and re-applies stored parameters. Anything that **writes a
value** is a synchronous `void` TurboModule call, which under JSI dispatches
with no serialisation and no round-trip. That is what makes a 60 fps knob drag
free. Do not `await` `setVolume`; there is nothing to await.

---

## Effect

| Member | Signature |
|---|---|
| `set` | `(key: string, value: number) => void` |
| `get` | `(key: string) => number` |
| `setMany` | `(values: Record<string, number>) => void` |
| `getValues` | `() => Record<string, number>` |
| `reset` | `() => void` |
| `enabled` | `boolean` (get/set) — bypass |
| `params` | `readonly ParamDescriptor[]` |

`setMany` exists because Android's backend applies a batch atomically within
one audio cycle. XY pads and preset recalls zipper audibly without it. On iOS
it loops.

Values are always in the schema's canonical units — **milliseconds, hertz,
0–1 for mixes**. Each native side converts to whatever its DSP wants. That
conversion layer is the single most bug-prone part of a two-backend audio
library, which is why it is centralised rather than done at call sites.

### `EffectLike`

`Effect` and `VoiceStackEffect` both satisfy this, so `EffectRack` renders
either without caring which it has. Use it as the parameter type if you write
your own controls.

---

## PolySynth

A voice pool over generator sources.

| Member | Signature | Notes |
|---|---|---|
| `PolySynth.create` | `(options?: PolySynthOptions) => Promise<PolySynth>` | |
| `noteOn` / `noteOff` | `(midi: number) => void` | |
| `allNotesOff` | `() => void` | |
| `activeNotes` | `number[]` | |
| `setUnisonSpread` | `(cents: number) => void` | Live; affects held notes. |
| `setUnisonPan` | `(width: number) => void` | 0–1. Live. |
| `setAmplitude` | `(amplitude: number) => void` | |
| `setEnvelopeParam` | `(key, value) => void` | |
| `addEffect` | `(type) => Promise<VoiceStackEffect>` | Fans across every voice. |
| `removeEffect` | `(stack) => Promise<void>` | |
| `effects` | `readonly VoiceStackEffect[]` | |
| `dispose` | `() => Promise<void>` | |

### Play modes

`poly` · `mono` · `legato` · `portamento`

- **poly** — notes stack. Re-pressing a held note releases it, which is what
  makes a touchscreen chord builder work.
- **mono** — one note, re-attacks every time.
- **legato** — one note, envelope keeps running.
- **portamento** — legato plus a glide, interpolated in log space so the slide
  is even in pitch rather than in hertz.

### Unison

`unison` stacks oscillators per note; `unisonSpread` detunes them in cents and
`unisonPan` spreads them across the stereo field. The two are **paired by
index** — the flattest voice sits furthest left. That correlation is what makes
a stack read as *wide*; detune alone just beats in the middle.

Both are live: `setUnisonSpread` and `setUnisonPan` affect notes already held.

**Unison divides polyphony, it does not multiply voices.** Asking for 8 voices
at 4× unison gives you 2 notes of real polyphony, not 32 sources. This is a
hard limit (8 sources) rather than a preference: each source is roughly six
native nodes before any effect is attached, every effect adds one *per voice*,
and AVAudioEngine stops working somewhere past a hundred attached nodes —
measured, it died at 106. Hardware synths behave the same way for the same
reason. `maxVoices` is lowered to match so the voice allocator never promises
a note the pool cannot supply.

---

## LFO

Timer-driven, runs in JS. Parameter writes are synchronous `void` calls, so a
60 Hz timer costs no bridge traffic. It is **not** audio-rate modulation — the
ceiling is 20 Hz. Chorus and phaser keep their own internal LFOs for that
reason.

| Member | Signature |
|---|---|
| `add` | `(target: LFOTarget) => this` |
| `addParam` | `(effect: EffectLike, key: string, bounds?) => this` |
| `clear` | `() => this` — drop targets, keep running |
| `start` / `stop` | `() => this` |
| `dispose` | `() => void` |
| `rate` / `depth` / `shape` | mutable fields |
| `isRunning` | getter |

Shapes: `sine` · `triangle` · `square` · `sawtooth` · `random`.

`addParam` defaults its bounds to the parameter's own schema range, so
`lfo.addParam(filter, 'cutoff')` sweeps the whole filter without restating what
that means.

---

## PresetStore

Saves a whole chain: which effects, in what order, their values, and whether
each is bypassed.

| Member | Signature |
|---|---|
| `save` | `(name: string, chain: readonly EffectLike[]) => Promise<ChainPreset>` |
| `apply` | `(name: string, chain) => Promise<number[]>` |
| `list` | `() => Promise<ChainPreset[]>` |
| `delete` / `rename` | |
| `toJSON` / `importJSON` | export and merge |

Also exported standalone: `captureChain(chain)` and `applyChain(chain, preset)`.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
const presets = new PresetStore({ storage: AsyncStorage, namespace: 'synth' });
```

Storage is **injected, not depended on** — two methods (`getItem`, `setItem`)
which AsyncStorage already satisfies. Default is in-memory. The library does not
force a storage dependency on apps that keep presets on a server.

`apply` returns the indices it **could not fill** rather than writing values
into the wrong effect: `mix` on a reverb and `mix` on a distortion are not the
same control. A preset saved before a parameter existed simply has no opinion
about it and leaves it alone.

---

## SampleAgent

| Member | Signature |
|---|---|
| `find` | `(prompt: string, signal?) => Promise<SampleSearch>` |
| `load` | `(result: SampleResult) => Promise<LoadedSample>` |
| `fetch` | `(prompt: string, signal?) => Promise<LoadedSample>` — find + load top hit |

`find` takes a third argument, `onProgress(terms)`, called with each query
variant as it is tried — worth wiring to a status line, because a search can
legitimately take a few seconds.

`SampleAgentOptions.budgetMs` caps a whole search; the default is
`SEARCH_BUDGET_MS` (12s).

### Why the search is shaped the way it is

Openverse does not degrade, it stalls: measured, a healthy response is ~60ms
and an unhealthy one hangs until the client gives up. There is no slow-but-
working middle to wait for. So requests are **hedged** — if one has not
answered in 400ms a second goes out alongside it and the first to return wins.
That turned 12-second timeouts into ~100ms responses against the same API in
the same minute.

Openverse also **ANDs** its search terms, so every extra word is a filter that
can empty the result set. `search` therefore walks from the most specific
phrasing to the least until something comes back, dropping terms in order of
how little they carry:

1. everything the user said, plus tempo and key
2. the same without tempo and key
3. without texture adjectives — `gritty`, `warm`, `dusty`
4. without genre — `ambient`, `lofi`, `jazz`

Genre goes last on purpose. To a producer it often carries more of the request
than the instrument does.

Words that map to a structured field — tempo, key, `loop`/`one shot` — are
**removed from the text query** once captured, or they would AND against
untagged results. A stated one-shot also implies a 3-second length cap, since
length is the only signal that reliably separates a one-shot from a loop.

Standalone: `parseSampleRequest(prompt)`, `search(query, options)`,
`buildSearchParams(terms, options)`, `attributionFor(result)`.

Searches **Openverse, which needs no API key**. Splice has no public API and
Freesound's requires a registered token; Openverse indexes Freesound among
others and serves direct CDN URLs, so this works on a fresh install.

The default parser is a vocabulary plus regexes — it reads tempo, key, duration
and loop-vs-one-shot. Pass `interpret` to put a model in front of it:

```ts
new SampleAgent({
  interpret: async (prompt) => ({ terms: await llm(prompt), understood: {} }),
});
```

A hook rather than a dependency, because every free model needs a key and the
feature has to work without one.

### Licensing

Most results are **CC-BY — attribution is a licence condition, not a
courtesy.** Every result carries its licence and creator; `attributionFor()`
formats a credit line. `publicDomainOnly: true` restricts to CC0 and PDM.

---

## Hooks

| Hook | Returns |
|---|---|
| `useAudioEngine(options?)` | `{ isReady, error, capabilities }` |
| `useSource(uri)` | a `Source` for a URI |
| `useOscillator(waveform, options)` | a generator `Source` |
| `useLevels(source, intervalMs?)` | live meter values |
| `useProgress(source)` | playhead |
| `useEffectParam(effect, key)` | `[value, setValue]` |
| `useEffectChain(source)` | chain with add/remove/reorder |
| `useAudioErrors(listener)` | engine-level errors |

---

## Schema

One TypeScript declaration drives the wire format, both native adapters, and
the UI. A CI test parses the Swift **and** Kotlin registries and fails if
either drifts.

| Export | Purpose |
|---|---|
| `EFFECTS`, `GENERATORS` | the catalogues |
| `getEffect(type)`, `getParam(type, key)`, `getGenerator(w)` | lookup |
| `ENVELOPE_PARAMS`, `envelopeDefaults` | ADSR |
| `toNormalized`, `fromNormalized`, `quantize` | taper maths |
| `formatValue`, `formatNumber`, `unitLabel` | display |
| `midiToFrequency`, `frequencyToMidi`, `noteName`, `isBlackKey`, `octaveStart` | pitch |
| `detune`, `unisonOffsets`, `unisonPans` | unison |
| `isEffectSupported`, `effectsForPlatform`, `expectedCapabilities` | platform |

Tapers are `linear` · `log` · `exp` · `stepped`. `toNormalized ∘ fromNormalized`
round-trips to identity — there are tests asserting exactly that.

Building your own control? Take a `ParamDescriptor` and you inherit its range,
curve, unit and formatting for free. Never hard-code a min and max.

---

## UI kit

From `react-native-audio-effects/ui`:

`Knob` · `EffectSlider` · `XYPad` · `LevelMeter` · `WaveformView` · `Keyboard`
(88-key, scrollable) · `EnvelopeEditor` (draggable ADSR) · `EffectRack` /
`EffectPanel` · `LFOPanel` · `PresetBar` (session A/B) · `PresetPanel`
(persistent saving) · `ThemeProvider` · `useAudioTheme` · `darkTheme` ·
`lightTheme`

Every control takes a `ParamDescriptor`. `EffectRack` generates an entire
plugin panel from the schema — that is the payoff for one source of truth.

Knob gestures run on the **UI thread** via Reanimated worklets, so the control
stays smooth while JS is busy, and writes coalesce to one call per frame.

### `EnvelopeEditor`

```tsx
<EnvelopeEditor values={envelope} onChange={(key, value) => ...} />
```

Four handles over the ADSR shape: attack and release drag horizontally,
decay horizontally, sustain vertically. Values come straight from
`ENVELOPE_PARAMS`, so the ranges and tapers match the knobs they replace.

Two deliberate departures from `Knob`. It runs on the **JS thread**, because
the geometry needs `toNormalized`/`fromNormalized` from the schema and those
are not worklets — see the trap below. And each stage is drawn proportional
to its *tapered* position in its own range rather than on a shared time axis,
because attack spans 1 ms to 4 s and a 1 ms attack on a linear axis is a
subpixel sliver you cannot grab.

Built on `react-native-svg`, which the kit already depends on. An envelope
redraws only when a handle moves, so it does not need a canvas renderer; a
live oscilloscope or spectrum view would, and that is where something like
Skia would earn its place.

> One trap, learned the hard way: a `'worklet'` that calls another worklet
> crashes with `undefined is not a function` when the same function is also
> invoked during JS render. `Knob`'s geometry helpers are deliberately
> self-contained — `Math` only, no calls out. Keep it that way if you edit it.

---

## Adding a method to the native module

Five layers, and the fifth is the one that bites:

1. `src/NativeAudioEffects.ts` — the spec
2. `ios/AudioEffects.mm` — the Objective-C++ bridge
3. `ios/AudioEffectsImpl.swift` — the Swift implementation
4. `android/.../AudioEffectsModule.kt` — the Kotlin module
5. **`pod install`** — regenerates the protocol codegen emits from the spec

Step 5 runs at `pod install` time, *not* during `xcodebuild`. Add a method,
rebuild, and the generated protocol is still stale — the method is invisible
to JS even though all four hand-written layers are correct. It fails as
`undefined is not a function`, exactly like a missing bridge method.

`src/__tests__/bridge-parity.test.ts` covers layers 1–4. If it passes and the
call still fails at runtime, you are looking at step 5.

## Visualisers (`react-native-audio-effects/scope`)

```tsx
import { OscillatorScope } from 'react-native-audio-effects/scope';

<OscillatorScope waveform="sawtooth" frequency={440} active={isPlaying} />
```

Draws the shape the oscillator is making, scrolling, with a neon glow. A
saw looks like a saw. Pitch is visible too: the higher the note, the more
cycles fit across the view.

It draws the oscillator's **own** waveform, computed from the type and
frequency. For a generator that is the truth, since the DSP synthesises
exactly that shape. It is **not** a scope on the engine's output — adding
distortion will not change the picture, because samples never leave the
audio thread. A real scope needs a tap streaming frames to JS, which this
library does not expose and which has a poor history here: taps on a live
AVAudioEngine graph have silenced playback more than once.

### Why this is a separate entry point

It needs `@shopify/react-native-skia`, which is an **optional peer
dependency**. The rest of the UI kit draws with `react-native-svg`, right
for controls that redraw when a value changes. This redraws every frame,
several hundred points at a time, which is the case a canvas handles and
SVG does not. Keeping it behind its own subpath means apps that only want
knobs never import Skia and never have to install it.

```sh
yarn add @shopify/react-native-skia   # only if you want the scope
```

## Errors

`AudioEffectsError` with a typed `code`, plus `AudioFileError` and
`EffectUnavailableError`.

Codes include `NOT_CONFIGURED`, `SOURCE_NOT_FOUND`, `EFFECT_NOT_FOUND`,
`EFFECT_UNAVAILABLE`, `UNKNOWN_EFFECT`, `UNKNOWN_WAVEFORM`, `FILE_NOT_FOUND`,
`DOWNLOAD_FAILED`, `DECODE_FAILED`, `INVALID_CHAIN_ORDER`, `ENGINE_FAILED`.

Creating an unavailable effect **rejects** rather than silently no-opping. A
silent no-op is the worst failure mode in an audio app: you hear nothing and
have no idea why.

---

## Platform differences

iOS runs AudioKit; Android runs Klarinet over Oboe. They are structurally
opposite — a node graph with typed Swift properties versus a linear chain with
integer parameter IDs — so parity is reported, not assumed.

| | iOS | Android |
|---|---|---|
| `distortion`, `bitcrusher` | ✅ | ❌ |
| delay `tone` | ✅ | ❌ no damping stage |
| per-source pan | ✅ any source | generators only |
| metering a file source | post-chain | **pre-chain** (see below) |

Call `getCapabilities()` or check a descriptor's `platforms` before offering
something. `EffectRack` greys unavailable effects out on its own.

### Metering goes stale after a chain change (iOS)

`onLevels` stops updating for a source after an effect is added or removed.
AVAudioEngine drops installed taps when the graph is reconfigured.

Re-arming the tap is the obvious fix and it is the wrong one: doing so silences
playback outright. That is a known hazard in this codebase with its own earlier
fix, and it was reintroduced and reverted again today. A correct fix needs a
metering path that does not install or remove taps on a live graph.

Levels are correct until the first structural edit. Do not build anything
load-bearing on them after that.

### Android file metering reads pre-effect

`onLevels` for an Android **file** source reports the signal as it comes
off the decoder, before the effect chain. Measured on an API 36 emulator:
a gain set to −60 dB leaves the reported level unchanged. Generators are
unaffected.

This is a Klarinet gap — there is no exposed tap between the chain and the
output — not a tweakable line. Do not build a gain-reduction readout or an
effect-is-working indicator on Android file levels. Peak/RMS for a file
source is still correct as a *source* level, which is what a load meter or
an input VU wants.

Generators also differ by construction: iOS uses AudioKit wavetables, Android
uses PolyBLEP. They anti-alias differently at high frequencies and **will not
be bit-identical**. That is a documented trade, not a bug.
