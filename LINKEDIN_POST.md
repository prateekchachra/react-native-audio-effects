# LinkedIn post — intro

Short announcement. The deeper material (schema-driven design, the
cross-platform capability problem, why three bugs produced silence instead of
errors) is saved for the follow-up article.

---

## The post

Just shipped **react-native-audio-effects v2** 🎛

A complete rewrite on React Native's New Architecture, for anyone building
music or audio apps:

🎚 **17 real-time effects** — delay, reverb, chorus, flanger, phaser,
tremolo, compressor, limiter, noise gate, parametric EQ, filters, distortion,
bit crusher

🎹 **7 oscillators** with ADSR envelopes and a playable MIDI keyboard

🎛 **Plugin-style controls** — rotary knobs, XY pads, level meters, waveform
scrubbing. Drop in an effect and the whole UI panel builds itself.

⚙️ Swift + AudioKit on iOS, Kotlin + Oboe on Android, behind a single
TurboModule.

```
const source = await AudioEngine.loadFile(uri);
const delay = await source.addEffect('delay');
delay.set('time', 300);
await source.play({ loop: true });
```

Apache-2.0 and open source. Writing up the architecture behind it soon —
particularly how a single TypeScript schema keeps the controls, both native
backends and the docs from ever drifting apart.

npm: react-native-audio-effects

#ReactNative #iOS #Android #AudioProgramming #OpenSource

---

## Before posting

- A short screen recording of the knobs and keyboard will do more than any
  screenshot.
- Keep the claim accurate about which platforms you have verified at runtime
  at the time you post.

---

## Saved for the article

- One schema driving the wire format, both native adapters and the UI, with a
  CI test that parses the Swift and Kotlin registries and fails on drift.
- Reconciling two unequal DSP backends: narrower range wins, extras flagged
  per parameter, unavailable effects throw rather than no-op.
- Three bugs that produced silence rather than errors, and the measurement
  harness that caught all of them.
- Why AudioKit needed Swift Package Manager through a CocoaPods podspec, and
  why v1 could never have compiled.
