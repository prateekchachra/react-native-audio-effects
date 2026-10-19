import AudioKit
import AudioKitEX
import Foundation
import SoundpipeAudioKit

/// Level trim with an optional click-free ramp.
final class GainEffect: EffectNode {
  static let type = "gain"
  static let supportedKeys = ["level", "fade"]

  private let fader: Fader
  /// Ramp applied to subsequent level changes, in seconds.
  private var fadeSeconds: Float = 0
  var outputNode: Node { fader }

  init(input: Node) {
    fader = Fader(input, gain: 1)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "level":
      let target = Convert.dBToLinear(value)
      if fadeSeconds > 0 {
        // Ramping avoids the click an abrupt gain change would produce.
        fader.$leftGain.ramp(to: target, duration: fadeSeconds)
        fader.$rightGain.ramp(to: target, duration: fadeSeconds)
      } else {
        fader.gain = target
      }
    case "fade":
      fadeSeconds = Convert.msToSeconds(value)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? fader.start() : fader.bypass()
  }
}

/// Stereo placement.
final class PanEffect: EffectNode {
  static let type = "pan"
  static let supportedKeys = ["pan"]

  private let panner: Panner
  var outputNode: Node { panner }

  init(input: Node) {
    panner = Panner(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    if key == "pan" {
      panner.pan = Convert.clamp(value, -1, 1)
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? panner.start() : panner.bypass()
  }
}

/// Soft-clipping saturation. No Klarinet equivalent, so iOS only.
final class DistortionEffect: EffectNode {
  static let type = "distortion"
  static let supportedKeys = ["drive", "mix"]

  private let distortion: TanhDistortion
  var outputNode: Node { distortion }

  init(input: Node) {
    distortion = TanhDistortion(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "drive":
      // Schema carries drive in dB; Soundpipe wants a 0..10 linear pregain.
      distortion.pregain = Convert.clamp(Convert.dBToLinear(value), 0, 10)
      // Compensate so increasing drive changes character rather than just
      // volume.
      distortion.postgain = Convert.clamp(1 / max(Convert.dBToLinear(value / 2), 0.1), 0, 10)
    case "mix":
      distortion.dryWetMix = Convert.clamp(value, 0, 1)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? distortion.start() : distortion.bypass()
  }
}

/// Bit-depth and sample-rate reduction. No Klarinet equivalent, so iOS only.
final class BitCrusherEffect: EffectNode {
  static let type = "bitCrusher"
  static let supportedKeys = ["bitDepth", "sampleRate", "mix"]

  private let crusher: BitCrusher
  var outputNode: Node { crusher }

  init(input: Node) {
    crusher = BitCrusher(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "bitDepth": crusher.bitDepth = Convert.clamp(value, 1, 24)
    case "sampleRate": crusher.sampleRate = Convert.clamp(value, 0, 20000)
    case "mix": crusher.dryWetMix = Convert.clamp(value, 0, 1)
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? crusher.start() : crusher.bypass()
  }
}
