import AudioKit
import AudioKitEX
import Foundation
import SoundpipeAudioKit

/// Echo with feedback and a damping filter in the repeat path.
final class DelayEffect: EffectNode {
  static let type = "delay"
  static let supportedKeys = ["time", "feedback", "mix", "tone"]

  private let delay: Delay
  var outputNode: Node { delay }

  init(input: Node) {
    delay = Delay(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "time":
      // Schema carries milliseconds (Klarinet's native unit); AudioKit wants
      // seconds.
      delay.time = Convert.clamp(Convert.msToSeconds(value), 0, 2)
    case "feedback":
      delay.feedback = Convert.unitToPercent(value)
    case "mix":
      delay.dryWetMix = Convert.unitToPercent(value)
    case "tone":
      delay.lowPassCutoff = Convert.clamp(value, 10, 22050)
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
