import AudioKit
import AudioKitEX
import Foundation
import SoundpipeAudioKit

/// Echo with feedback and a damping filter in the repeat path.
final class DelayEffect: EffectNode {
  static let type = "delay"
  static let supportedKeys = ["time", "feedback", "mix", "tone", "pingPong"]

  /**
   Two delay lines in parallel, panned apart and offset in time.

   AudioKit has no ping-pong delay, and a true one — where the feedback path
   crosses between channels — needs a cycle in the graph, which AVAudioEngine
   will not let you build. This gets the same effect from the outside: the
   right line runs half a beat behind the left, so the repeats interleave and
   alternate across the stereo field.

   At `pingPong` 0 the two lines are identical and centred, which sums back to
   an ordinary mono delay. Nothing is lost by the extra machinery.
   */
  private let left: Delay
  private let right: Delay
  private let leftPan: Panner
  private let rightPan: Panner
  private let wet: Mixer
  private let mixer: DryWetMixer

  var outputNode: Node { mixer }

  /// Kept because `time` and `pingPong` jointly decide the two delay times.
  private var timeMs: Float = 250
  private var pingPong: Float = 0

  init(input: Node) {
    left = Delay(input)
    right = Delay(input)
    // The outer DryWetMixer owns the blend, so each line runs fully wet.
    left.dryWetMix = 100
    right.dryWetMix = 100
    leftPan = Panner(left)
    rightPan = Panner(right)
    wet = Mixer(leftPan, rightPan)
    // Two copies of the same signal sum to twice the amplitude at pingPong 0.
    wet.volume = 0.5
    mixer = DryWetMixer(input, wet)
    applyTiming()
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "time":
      timeMs = value
      applyTiming()
    case "pingPong":
      pingPong = Convert.clamp(value, 0, 1)
      applyTiming()
    case "feedback":
      let percent = Convert.unitToPercent(value)
      left.feedback = percent
      right.feedback = percent
    case "mix":
      mixer.balance = Convert.clamp(value, 0, 1)
    case "tone":
      let cutoff = Convert.clamp(value, 10, 22050)
      left.lowPassCutoff = cutoff
      right.lowPassCutoff = cutoff
    default:
      break
    }
  }

  /// Spread the two lines in time and across the stereo field together.
  private func applyTiming() {
    let seconds = Convert.clamp(Convert.msToSeconds(timeMs), 0, 2)
    left.time = seconds
    // Offset by up to half the delay time, so repeats land between each other.
    right.time = Convert.clamp(seconds * (1 + pingPong * 0.5), 0, 2)
    leftPan.pan = -pingPong
    rightPan.pan = pingPong
  }

  func setEnabled(_ enabled: Bool) {
    if enabled {
      left.start()
      right.start()
    } else {
      left.bypass()
      right.bypass()
    }
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
