import AudioKit
import AudioKitEX
import Foundation

/// Number of bands in the parametric EQ. Must match `EQ_BAND_COUNT` in
/// `src/schema/effects.ts` and the Kotlin adapter.
let eqBandCount = 4

/**
 Multi-band parametric EQ, built as a series of single-band Apple EQ units.

 Parameter keys are flat (`band0Frequency`), matching the schema; the band
 index is parsed out of the key.
 */
final class ParametricEqEffect: EffectNode {
  static let type = "parametricEq"

  static var supportedKeys: [String] {
    (0..<eqBandCount).flatMap { band in
      ["band\(band)Frequency", "band\(band)Gain", "band\(band)Q"]
    }
  }

  private let bands: [ParametricEQ]
  var outputNode: Node { bands[bands.count - 1] }

  init(input: Node) {
    var built: [ParametricEQ] = []
    var current: Node = input
    for _ in 0..<eqBandCount {
      let band = ParametricEQ(current)
      built.append(band)
      current = band
    }
    bands = built
  }

  func setParameter(_ key: String, _ value: Float) {
    guard let (index, field) = Self.parse(key), index < bands.count else {
      return
    }
    let band = bands[index]
    switch field {
    case "Frequency": band.centerFreq = Convert.clamp(value, 20, 22050)
    case "Gain": band.gain = Convert.clamp(value, -20, 20)
    case "Q": band.q = Convert.clamp(value, 0.1, 20)
    default: break
    }
  }

  /// Splits `band2Gain` into `(2, "Gain")`.
  private static func parse(_ key: String) -> (Int, String)? {
    guard key.hasPrefix("band") else { return nil }
    let rest = key.dropFirst("band".count)
    guard let digitEnd = rest.firstIndex(where: { !$0.isNumber }),
      let index = Int(rest[rest.startIndex..<digitEnd])
    else { return nil }
    return (index, String(rest[digitEnd...]))
  }

  func setEnabled(_ enabled: Bool) {
    for band in bands {
      enabled ? band.start() : band.bypass()
    }
  }
}

/// Attenuates above a cutoff.
final class LowPassEffect: EffectNode {
  static let type = "lowPassFilter"
  static let supportedKeys = ["cutoff", "resonance"]

  private let filter: LowPassFilter
  var outputNode: Node { filter }

  init(input: Node) {
    filter = LowPassFilter(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "cutoff": filter.cutoffFrequency = Convert.clamp(value, 10, 22050)
    // Apple expresses resonance as a dB bump, not a Q.
    case "resonance": filter.resonance = Convert.qToResonanceDB(value)
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? filter.start() : filter.bypass()
  }
}

/// Attenuates below a cutoff.
final class HighPassEffect: EffectNode {
  static let type = "highPassFilter"
  static let supportedKeys = ["cutoff", "resonance"]

  private let filter: HighPassFilter
  var outputNode: Node { filter }

  init(input: Node) {
    filter = HighPassFilter(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "cutoff": filter.cutoffFrequency = Convert.clamp(value, 10, 22050)
    case "resonance": filter.resonance = Convert.qToResonanceDB(value)
    default: break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? filter.start() : filter.bypass()
  }
}

/// Passes a band around a centre frequency.
final class BandPassEffect: EffectNode {
  static let type = "bandPassFilter"
  static let supportedKeys = ["center", "bandwidth"]

  private let filter: BandPassFilter
  var outputNode: Node { filter }

  init(input: Node) {
    filter = BandPassFilter(input)
  }

  func setParameter(_ key: String, _ value: Float) {
    switch key {
    case "center":
      filter.centerFrequency = Convert.clamp(value, 20, 22050)
    case "bandwidth":
      // Schema carries octaves; Apple's unit wants cents.
      filter.bandwidth = Convert.clamp(Convert.octavesToCents(value), 100, 12000)
    default:
      break
    }
  }

  func setEnabled(_ enabled: Bool) {
    enabled ? filter.start() : filter.bypass()
  }
}
