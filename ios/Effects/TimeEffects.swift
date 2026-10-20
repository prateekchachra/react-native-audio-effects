import AudioKit
import AudioKitEX
import Foundation
import SoundpipeAudioKit

/// Echo with feedback and a damping filter in the repeat path.
final class DelayEffect: EffectNode {
  static let type = "delay"
  static let supportedKeys = ["time", "feedback", "mix", "tone", "pingPong"]

  /**
   One delay line, panned.

   This was briefly two lines offset in time, which is how you fake a
   ping-pong without the feedback cycle AVAudioEngine refuses to build.
   It sounded right and cost six nodes per instance, which is fine for
   one source and fatal across a voice pool: a synth attaches an effect
   per voice, and the engine dies somewhere past a hundred nodes.

   So `pingPong` now only places the repeats in the stereo field rather
   than bouncing them between channels. Honest about what it does, and
   three nodes instead of six. A real ping-pong belongs in a custom
   AudioUnit where the feedback path can cross channels internally.
   */
  private let delay: Delay
  private let panner: Panner
  private let mixer: DryWetMixer

  var outputNode: Node { mixer }

  init(input: Node) {
    delay = Delay(input)
    // The outer mixer owns the blend, so the line itself runs fully wet.
    delay.dryWetMix = 100
    panner = Panner(delay)
    mixer = DryWetMixer(input, panner)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "time":
      delay.time = Convert.clamp(Convert.msToSeconds(value), 0, 2)
    case "feedback":
      delay.feedback = Convert.unitToPercent(value)
    case "mix":
      mixer.balance = Convert.clamp(value, 0, 1)
    case "tone":
      delay.lowPassCutoff = Convert.clamp(value, 10, 22050)
    case "pingPong":
      // Offsets the repeats to one side; 0 keeps them centred.
      panner.pan = Convert.clamp(value, 0, 1)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? delay.start() : delay.bypass()
  }
}

/**
 Room simulation.

 AudioKit's own `Reverb` wraps Apple's unit, which exposes nothing but a
 dry/wet balance, so this uses Soundpipe's Costello (Feedback Delay Network)
 reverb instead. Its `feedback` behaves as room size and its `cutoffFrequency`
 as damping, which lines up with the Freeverb-style controls Klarinet exposes.
 */
final class ReverbEffect: EffectNode {
  static let type = "reverb"
  static let supportedKeys = ["roomSize", "damping", "mix"]

  private let reverb: CostelloReverb
  var outputNode: Node { reverb }

  init(input: Node) {
    reverb = CostelloReverb(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "roomSize":
      reverb.feedback = Convert.clamp(value, 0, 1)
    case "damping":
      reverb.cutoffFrequency = Convert.dampingToCutoff(value)
    case "mix":
      reverb.balance = Convert.clamp(value, 0, 1)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? reverb.start() : reverb.bypass()
  }
}
