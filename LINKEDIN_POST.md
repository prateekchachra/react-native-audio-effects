# LinkedIn post — draft

Pick whichever version fits. The first is the safe default.

---

## Version A — the build story (recommended)

I rebuilt **react-native-audio-effects** from scratch, and shipped v2.

The old version had a problem I only found by trying to install it: the
podspec depended on CocoaPods packages that no longer exist. AudioKit stopped
publishing there years ago. So the library imported AudioKit, declared a
dependency that could never resolve, and simply would not compile in anyone's
app. It also had no Android implementation at all.

v2 is a rewrite on React Native's New Architecture:

🎛 **17 effects** — delay, reverb, chorus, flanger, phaser, tremolo,
compressor, limiter, noise gate, 4-band parametric EQ, filters, distortion,
bit crusher

🎹 **7 generators** with ADSR envelopes and a playable MIDI keyboard

🎚 **A plugin-style control kit** — rotary knobs with proper tapers, XY pads,
level meters, waveform scrubbing

⚙️ **TurboModule** — Swift + AudioKit on iOS, Kotlin + Oboe on Android

The thing I'd actually tell another engineer about: there is **one TypeScript
schema** that declares every parameter's range, curve, unit and per-platform
availability. The native adapters read it, the UI generates itself from it,
and a test parses both native registries and fails CI if either drifts. A
knob cannot disagree with the DSP behind it, because they are the same
declaration.

That mattered more than I expected. The two backends are genuinely different
— Apple's EQ caps at ±20 dB where Android's reaches ±24, Klarinet's reverb
has a stereo width control that AudioKit's has no equivalent for. Rather than
quietly clamping, the narrower range wins and the extras are flagged per
parameter and greyed out in the UI. Creating an effect a platform cannot do
throws, instead of handing back a handle that silently does nothing.

Three bugs in this project produced **silence rather than an error**. Metering
that only tapped sources existing when you enabled it. A tap installed before
the chain was built, which left the player mute. An envelope whose gate the
audio unit only samples once per render block, so a retrigger vanished.

Typechecking catches none of that. What caught all three was a diagnostic
harness that plays audio and measures the actual output level — a sine at
amplitude 0.5 should read 0.354 RMS, and if it reads 0.000 something is
wrong. 29 end-to-end checks, every one reporting a measured number.

Apache-2.0, on npm. Links below. 👇

#ReactNative #iOS #Android #AudioProgramming #DSP #Swift #Kotlin #OpenSource

---

## Version B — shorter

Shipped **react-native-audio-effects v2** — a full rewrite on React Native's
New Architecture.

17 real-time effects, 7 oscillators with ADSR and a playable keyboard, and a
plugin-style control kit — knobs, XY pads, meters, waveform scrubbing.
Swift + AudioKit on iOS, Kotlin + Oboe on Android, behind one TurboModule.

The design decision I'd defend: one TypeScript schema declares every
parameter's range, curve and per-platform support. The native adapters read
it, the UI builds itself from it, and a CI test fails if either side drifts.
A control cannot disagree with the DSP behind it.

The lesson I'd pass on: three bugs here produced silence, not errors. No
amount of typechecking finds those. What did was a harness that plays audio
and asserts on the measured level — a 0.5-amplitude sine must read 0.354 RMS.

Apache-2.0, open source. 🎛

#ReactNative #AudioProgramming #DSP #OpenSource

---

## Notes before posting

- A screen recording of the knobs and the keyboard will outperform any
  screenshot here.
- Say Android is iOS-verified and Android-compiled if that is still true when
  you post — it is the kind of thing people find out and remember.
