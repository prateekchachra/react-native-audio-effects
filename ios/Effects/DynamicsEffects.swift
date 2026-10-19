import AudioKit
import AudioKitEX
import Foundation
import SoundpipeAudioKit

/**
 Downward compression.

 Apple's `Compressor` unit has no ratio control (it works in terms of head
 room), so this uses Soundpipe's `DynamicRangeCompressor`, which exposes
 threshold, ratio, attack and release directly.

 Makeup gain goes through a trailing `Fader` rather than the compressor's own
 `gain`, whose 0..8 linear range tops out around 18 dB — below the 40 dB the
 schema allows.
 */
final class CompressorEffect: EffectNode {
  static let type = "compressor"
  static let supportedKeys = [
    "threshold", "ratio", "attack", "release", "makeupGain",
  ]

  private let compressor: DynamicRangeCompressor
  private let makeup: Fader
  var outputNode: Node { makeup }

  init(input: Node) {
    compressor = DynamicRangeCompressor(input)
    makeup = Fader(compressor, gain: 1)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "threshold":
      compressor.threshold = Convert.clamp(value, -100, 0)
    case "ratio":
      compressor.ratio = Convert.clamp(value, 0.01, 100)
    case "attack":
      compressor.attackDuration = Convert.clamp(Convert.msToSeconds(value), 0, 1)
    case "release":
      compressor.releaseDuration = Convert.clamp(Convert.msToSeconds(value), 0, 1)
    case "makeupGain":
      makeup.gain = Convert.dBToLinear(value)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    if enabled {
      compressor.start()
      makeup.start()
    } else {
      compressor.bypass()
      makeup.bypass()
    }
  }
}

/**
 Brick-wall ceiling.

 Apple's `PeakLimiter` exposes pre-gain rather than a threshold, which does not
 match the schema, so this is a `DynamicRangeCompressor` pinned to an extreme
 ratio — the usual way to build a limiter out of a compressor.
 */
final class LimiterEffect: EffectNode {
  static let type = "limiter"
  static let supportedKeys = ["threshold", "release"]

  private static let brickWallRatio: Float = 100

  private let limiter: DynamicRangeCompressor
  var outputNode: Node { limiter }

  init(input: Node) {
    limiter = DynamicRangeCompressor(input)
    limiter.ratio = Self.brickWallRatio
    // Limiting should clamp transients, so the attack is as short as the unit
    // allows and is not exposed.
    limiter.attackDuration = 0.001
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "threshold":
      limiter.threshold = Convert.clamp(value, -100, 0)
    case "release":
      limiter.releaseDuration = Convert.clamp(Convert.msToSeconds(value), 0, 1)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? limiter.start() : limiter.bypass()
  }
}

/**
 Silences signal below a threshold.

 Apple's dynamics processor drives its expander from a threshold in decibels,
 with no hold stage — hence `hold` being Android-only in the schema.
 */
final class NoiseGateEffect: EffectNode {
  static let type = "noiseGate"
  static let supportedKeys = ["threshold", "attack", "release"]

  private let gate: DynamicsProcessor
  var outputNode: Node { gate }

  init(input: Node) {
    gate = DynamicsProcessor(input)
    // A steep expansion ratio is what turns the processor into a gate rather
    // than a gentle downward expander.
    gate.expansionRatio = 50
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "threshold":
      gate.threshold = Convert.clamp(value, -40, 20)
    case "attack":
      gate.attackTime = Convert.clamp(Convert.msToSeconds(value), 0.0001, 0.2)
    case "release":
      gate.releaseTime = Convert.clamp(Convert.msToSeconds(value), 0.01, 3)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? gate.start() : gate.bypass()
  }
}
