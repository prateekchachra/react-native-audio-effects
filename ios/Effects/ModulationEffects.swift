import AudioKit
import AudioKitEX
import DunneAudioKit
import Foundation
import SoundpipeAudioKit

/// Detuned, modulated copies mixed back in for thickening.
final class ChorusEffect: EffectNode {
  static let type = "chorus"
  static let supportedKeys = ["rate", "depth", "mix"]

  private let chorus: Chorus
  var outputNode: Node { chorus }

  init(input: Node) {
    chorus = Chorus(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "rate": chorus.frequency = value
    case "depth": chorus.depth = Convert.clamp(value, 0, 1)
    case "mix": chorus.dryWetMix = Convert.clamp(value, 0, 1)
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? chorus.start() : chorus.bypass()
  }
}

/// Swept short delay with feedback.
final class FlangerEffect: EffectNode {
  static let type = "flanger"
  static let supportedKeys = ["rate", "depth", "feedback", "mix"]

  private let flanger: Flanger
  var outputNode: Node { flanger }

  init(input: Node) {
    flanger = Flanger(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "rate": flanger.frequency = value
    case "depth": flanger.depth = Convert.clamp(value, 0, 1)
    case "feedback": flanger.feedback = Convert.clamp(value, -0.95, 0.95)
    case "mix": flanger.dryWetMix = Convert.clamp(value, 0, 1)
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? flanger.start() : flanger.bypass()
  }
}

/**
 Swept all-pass notches.

 Soundpipe's phaser drives its LFO in beats per minute and has a fixed number
 of stages, so the schema's `rate` is converted from hertz and its `stages`
 parameter is declared Android-only.
 */
final class PhaserEffect: EffectNode {
  static let type = "phaser"
  static let supportedKeys = ["rate", "depth", "feedback"]

  private let phaser: Phaser
  var outputNode: Node { phaser }

  init(input: Node) {
    phaser = Phaser(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "rate":
      phaser.lfoBPM = Convert.clamp(Convert.hzToBPM(value), 24, 360)
    case "depth":
      phaser.depth = Convert.clamp(value, 0, 1)
    case "feedback":
      // Soundpipe's phaser feedback is unipolar; the schema allows inversion
      // for Klarinet, so take the magnitude here.
      phaser.feedback = Convert.clamp(abs(value), 0, 1)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? phaser.start() : phaser.bypass()
  }
}

/// Rhythmic amplitude modulation.
final class TremoloEffect: EffectNode {
  static let type = "tremolo"
  static let supportedKeys = ["rate", "depth"]

  private let tremolo: Tremolo
  var outputNode: Node { tremolo }

  init(input: Node) {
    tremolo = Tremolo(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "rate": tremolo.frequency = Convert.clamp(value, 0, 100)
    case "depth": tremolo.depth = Convert.clamp(value, 0, 1)
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? tremolo.start() : tremolo.bypass()
  }
}
