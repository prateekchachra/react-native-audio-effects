<img src="../assets/logo.svg" alt="react-native-audio-effects" width="360">

# Example app

The demo for [`react-native-audio-effects`](../README.md). Three screens,
each exercising a different part of the library against real audio.

It consumes the library from source, not from npm — Metro resolves
`react-native-audio-effects` to `../src` through the
`react-native-audio-effects-source` export condition. Editing library code
and hot-reloading the app works.

## Running it

From the **repository root**, not this directory:

```sh
yarn                      # installs both workspaces
yarn example start        # Metro

# in a second terminal
yarn example ios
yarn example android
```

iOS needs pods first, and needs them again whenever the TurboModule spec
changes — see [Changing the native API](#changing-the-native-api):

```sh
cd example/ios && USE_FRAMEWORKS=dynamic RCT_NEW_ARCH_ENABLED=1 pod install
```

`USE_FRAMEWORKS=dynamic` is required. AudioKit is SPM-only and arrives
through the podspec's `spm_dependency`, and Swift packages linked into
static pods fail at link time.

## The screens

### Studio

Load a sound and build a chain on it. Eight samples ship with the app
(`example/ios/Samples`, mirrored into Android assets) covering mp3, wav
and aiff so the decode paths all get used, or import your own through
`@react-native-documents/picker`.

Add effects, reorder them, bypass them, and move the knobs while it plays.
Waveform, playhead and level meters are live.

### Generators

Seven waveforms driven by an 88-key scrollable keyboard, with ADSR, play
modes (poly, mono, legato, portamento), unison with detune and stereo
width, an assignable LFO, and the full effect catalogue applied across the
whole voice pool.

> **Start with a plucky patch.** The default is a sustained tone, and
> time-based effects are nearly inaudible on one — a delay repeat lands on
> top of a note that is still sounding, so you get comb filtering rather
> than echoes. Set **Sustain to 0** with a short Decay and delay and reverb
> become obvious. Filter, tremolo and chorus read fine on a held note.

### Samples

Ask for a sound in plain English — _"a gritty 90bpm lofi drum loop"_ — and
it searches [Openverse](https://openverse.org), which needs no API key or
account. Results open in a transport sheet with attribution; loading one
downloads and decodes it natively, so it behaves like a local file and can
take a chain like anything else.

## Changing the native API

Adding a method to `src/NativeAudioEffects.ts` means touching five places,
and the fifth is easy to miss:

1. the spec
2. `ios/AudioEffects.mm`
3. `ios/AudioEffectsImpl.swift`
4. `android/.../AudioEffectsModule.kt`
5. **`pod install`** — regenerates the protocol codegen emits from the spec

Step 5 runs at `pod install` time, **not** during `xcodebuild`. Skip it and
the method is invisible to JS even though all four hand-written layers are
correct, failing as `undefined is not a function` — exactly like a missing
bridge method. `src/__tests__/bridge-parity.test.ts` covers layers 1–4; if
it passes and the call still fails at runtime, you are looking at step 5.

## Requirements and gotchas

|              |                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| iOS          | whatever React Native 0.88 requires — the podspec uses `min_ios_version_supported` rather than pinning its own |
| Android      | minSdk 24, compileSdk 37                                                                                       |
| Android ABIs | `arm64-v8a`, `armeabi-v7a`, `x86_64` — **no x86**                                                              |
| Kotlin       | pinned to 2.4.20 in `android/build.gradle`                                                                     |

**Kotlin version.** Klarinet is built with Kotlin 2.4 while React Native
0.88 ships 2.2, so `resolutionStrategy` forces 2.4.20. Any app consuming
this library needs the same pin.

**Emulator ABI.** Klarinet publishes no x86 slice, so an x86 emulator image
will fail to load the native library. Use arm64 on Apple silicon.

**Metro port.** Metro fails quietly if 8081 is already taken and the app
then cannot load a bundle. `lsof -ti:8081 | xargs kill -9` before starting
if the app reports "Unable to load script".

## Known issues

- **Metering goes stale after a chain change (iOS).** Level meters stop
  updating for a source once an effect is added or removed. AVAudioEngine
  drops installed taps when the graph is reconfigured, and re-arming them
  silences playback, so this is left alone deliberately.
- **Android file metering reads pre-effect.** Levels for a file source are
  measured before the chain, so effects do not move the meter. Generators
  are unaffected.

Both are described in [docs/API.md](../docs/API.md#platform-differences).
Neither affects audio, only the numbers reported about it.
