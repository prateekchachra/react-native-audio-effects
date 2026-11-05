import AudioKit
import AudioKitEX
import Foundation
import SoundpipeAudioKit
import Tonic

/**
 Pitch and formant effects — the ones you reach for on a voice.

 ## Why the vocoder owns its carrier

 A vocoder is two signals: the voice says *what shape*, a carrier says
 *what sound*. AudioKit's `Vocoder` and `Talkbox` take both, which does
 not fit a chain where every link is one in and one out.

 Rather than widen the whole architecture for two effects, the carrier
 lives inside them. From the chain's point of view these are ordinary
 effects; the oscillator stack is a parameter like any other. That is
 also how a hardware vocoder with a built-in carrier works, so it is the
 familiar arrangement rather than a compromise.

 ## Why there is no pitch-detection tap

 `PitchCorrect` detects and corrects inside the DSP node. That is the
 whole reason it is used here instead of `PitchTap` feeding a
 `PitchShifter`: taps installed on a live AVAudioEngine graph have
 silenced playback twice in this project, and the correction loop would
 have needed one on every frame.
 */

// MARK: - Pitch shift

final class PitchShiftEffect: EffectNode {
  static let type = "pitchShift"
  static let supportedKeys = ["shift", "windowSize", "crossfade"]

  private let shifter: PitchShifter
  private let mixer: DryWetMixer

  init(input: Node) {
    shifter = PitchShifter(input)
    mixer = DryWetMixer(input, shifter, balance: 1)
  }

  var outputNode: Node { mixer }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "shift": shifter.shift = value
    case "windowSize": shifter.windowSize = value
    case "crossfade": shifter.crossfade = value
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    mixer.balance = enabled ? 1 : 0
  }
}

// MARK: - Pitch correction

final class PitchCorrectEffect: EffectNode {
  static let type = "pitchCorrect"
  static let supportedKeys = ["key", "amount", "speed"]

  private let corrector: PitchCorrect
  private let mixer: DryWetMixer

  init(input: Node) {
    corrector = PitchCorrect(input)
    mixer = DryWetMixer(input, corrector, balance: 1)
  }

  var outputNode: Node { mixer }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "key":
      // The schema sends a pitch class, 0 for C through 11 for B, because
      // codegen cannot carry an enum. Tonic's NoteClass is what the node
      // wants, and it is also already a dependency through AudioKit.
      corrector.key = Self.key(forPitchClass: Int(value.rounded()))
    case "amount":
      corrector.amount = Convert.clamp(value, 0, 1)
    case "speed":
      corrector.speed = Convert.clamp(value, 0, 1)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    mixer.balance = enabled ? 1 : 0
  }

  /**
   The twelve major keys, indexed by pitch class.

   Spelled the way musicians spell them, which is why this is not simply
   every note with a sharp after it: D sharp major would need double
   sharps to write down, so the key at that pitch is E flat. Tonic only
   offers the practical set, and the schema's indices line up with it.
   */
  private static let pitchClasses: [Key] = [
    .C, .Cs, .D, .Eb, .E, .F, .Fs, .G, .Ab, .A, .Bb, .B,
  ]

  private static func key(forPitchClass pitchClass: Int) -> Key {
    let wrapped = ((pitchClass % 12) + 12) % 12
    return pitchClasses[wrapped]
  }
}

// MARK: - Carrier

/**
 The oscillator stack a vocoder or talk box speaks through.

 Several oscillators rather than one, because a single saw is a robot and
 a handful spread a few cents apart is a choir — the difference people
 actually mean when they pick a vocoder "voice".

 ## Why there is a bank per waveform

 `Oscillator` takes its wavetable at init and offers no setter, so a
 voice change cannot retune an existing oscillator to a new shape. The
 alternative — building a fresh stack on each change — would mean
 attaching nodes to a running engine every time someone turns a knob,
 which is the expensive and risky operation here.

 So every waveform gets its own bank, built once, and changing voice is
 only ever a change of amplitude. Each bank is sized to the widest voice
 that uses it rather than to the widest voice overall: ten oscillators in
 total instead of eighteen, which matters because AVAudioEngine starts
 failing somewhere past a hundred attached nodes.
 */
private final class Carrier {
  enum Shape: CaseIterable {
    case sawtooth, square, triangle

    var table: AudioKit.Table {
      switch self {
      case .sawtooth: return Table(.sawtooth)
      case .square: return Table(.square)
      case .triangle: return Table(.triangle)
      }
    }
  }

  struct Voice {
    let shape: Shape
    let unison: Int
    /// Total spread across the stack, in cents.
    let detune: Float
    let octave: Float
  }

  /// Matches `CARRIER_VOICES` in `src/schema/effects.ts`, by index.
  static let voices: [Voice] = [
    Voice(shape: .sawtooth, unison: 1, detune: 0, octave: 0),
    Voice(shape: .sawtooth, unison: 5, detune: 28, octave: 0),
    Voice(shape: .sawtooth, unison: 3, detune: 12, octave: 0),
    Voice(shape: .square, unison: 1, detune: 0, octave: -1),
    Voice(shape: .triangle, unison: 3, detune: 8, octave: 1),
    Voice(shape: .square, unison: 2, detune: 40, octave: 0),
  ]

  private var banks: [Shape: [Oscillator]] = [:]
  let mixer = Mixer()

  private var voiceIndex = 0
  private var frequency: Float = 110

  init() {
    for shape in Shape.allCases {
      let needed =
        Self.voices.filter { $0.shape == shape }.map(\.unison).max() ?? 0
      let bank = (0..<needed).map { _ in
        Oscillator(waveform: shape.table, amplitude: 0)
      }
      for oscillator in bank {
        mixer.addInput(oscillator)
        oscillator.start()
      }
      banks[shape] = bank
    }
    apply()
  }

  func setVoice(_ index: Int) {
    voiceIndex = min(max(index, 0), Self.voices.count - 1)
    apply()
  }

  func setFrequency(_ hz: Float) {
    frequency = max(1, hz)
    apply()
  }

  /// Retune and rebalance for the current voice; silence every other bank.
  private func apply() {
    let voice = Self.voices[voiceIndex]
    let centre = frequency * powf(2, voice.octave)
    // Level is shared across the stack, so switching from one oscillator
    // to five does not also make it five times louder.
    let level = 1 / Float(max(voice.unison, 1))

    for (shape, bank) in banks {
      for (index, oscillator) in bank.enumerated() {
        guard shape == voice.shape, index < voice.unison else {
          oscillator.amplitude = 0
          continue
        }
        oscillator.frequency = Self.detune(
          centre,
          cents: Self.offset(index: index, of: voice.unison, spread: voice.detune)
        )
        oscillator.amplitude = level
      }
    }
  }

  /// Spread `unison` voices evenly across `spread` cents, centred on zero.
  private static func offset(index: Int, of unison: Int, spread: Float) -> Float {
    guard unison > 1 else { return 0 }
    let position = Float(index) / Float(unison - 1)
    return (position - 0.5) * spread
  }

  private static func detune(_ hz: Float, cents: Float) -> Float {
    hz * powf(2, cents / 1200)
  }
}

// MARK: - Vocoder

final class VocoderEffect: EffectNode {
  static let type = "vocoder"
  static let supportedKeys = [
    "carrier", "pitchSource", "carrierFrequency", "attack", "release",
    "bandwidth",
  ]

  private let carrier = Carrier()
  private let vocoder: Vocoder
  private let mixer: DryWetMixer

  init(input: Node) {
    vocoder = Vocoder(input, excitation: carrier.mixer)
    mixer = DryWetMixer(input, vocoder, balance: 1)
  }

  var outputNode: Node { mixer }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "carrier":
      carrier.setVoice(Int(value.rounded()))
    case "carrierFrequency":
      carrier.setFrequency(value)
    case "pitchSource":
      // Where the pitch comes from is settled in JavaScript: in MIDI mode
      // the note that is played is written to `carrierFrequency`. Nothing
      // to do natively, and accepted rather than ignored so that the key
      // still round-trips through getParameter.
      break
    case "attack":
      vocoder.attackTime = Convert.clamp(Convert.msToSeconds(value), 0.001, 0.5)
    case "release":
      vocoder.releaseTime = Convert.clamp(Convert.msToSeconds(value), 0.001, 0.5)
    case "bandwidth":
      vocoder.bandwidthRatio = Convert.clamp(value, 0.1, 2)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    mixer.balance = enabled ? 1 : 0
  }
}

// MARK: - Talk box

final class TalkboxEffect: EffectNode {
  static let type = "talkbox"
  static let supportedKeys = [
    "carrier", "pitchSource", "carrierFrequency", "quality",
  ]

  private let carrier = Carrier()
  private let talkbox: Talkbox
  private let mixer: DryWetMixer

  init(input: Node) {
    talkbox = Talkbox(input, excitation: carrier.mixer)
    mixer = DryWetMixer(input, talkbox, balance: 1)
  }

  var outputNode: Node { mixer }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "carrier": carrier.setVoice(Int(value.rounded()))
    case "carrierFrequency": carrier.setFrequency(value)
    case "pitchSource": break
    case "quality": talkbox.quality = Convert.clamp(value, 0, 1)
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    mixer.balance = enabled ? 1 : 0
  }
}

// MARK: - Formant filter

final class FormantFilterEffect: EffectNode {
  static let type = "formantFilter"
  static let supportedKeys = [
    "centerFrequency", "attackDuration", "decayDuration",
  ]

  private let filter: FormantFilter
  private let mixer: DryWetMixer

  init(input: Node) {
    filter = FormantFilter(input)
    mixer = DryWetMixer(input, filter, balance: 1)
  }

  var outputNode: Node { mixer }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "centerFrequency":
      filter.centerFrequency = value
    case "attackDuration":
      filter.attackDuration = Convert.msToSeconds(value)
    case "decayDuration":
      filter.decayDuration = Convert.msToSeconds(value)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    mixer.balance = enabled ? 1 : 0
  }
}
