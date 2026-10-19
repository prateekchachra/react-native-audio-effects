import AudioKit
import Foundation

/**
 One effect in a source's chain.

 Each conformer wraps one or more AudioKit nodes and translates the schema's
 canonical parameter keys and units (see `src/schema/effects.ts`) into whatever
 the underlying node wants. The conversion lives here and nowhere else —
 JavaScript always speaks the schema's units.
 */
protocol EffectNode: AnyObject {
  /// Schema effect type, e.g. `"delay"`.
  static var type: String { get }

  /// Parameter keys this implementation honours, for `getCapabilities()`.
  static var supportedKeys: [String] { get }

  /// The node audio leaves this effect from.
  var outputNode: Node { get }

  /// Apply a parameter, in the schema's canonical unit.
  func setParameter(_ key: String, _ value: Float)

  /// Bypass without removing from the chain.
  func setEnabled(_ enabled: Bool)
}

// MARK: - Unit conversion helpers

enum Convert {
  /// Decibels to linear amplitude.
  static func dBToLinear(_ dB: Float) -> Float {
    powf(10, dB / 20)
  }

  /// Milliseconds to seconds.
  static func msToSeconds(_ ms: Float) -> Float {
    ms / 1000
  }

  /// A 0..1 proportion to AudioKit's 0..100 percentage parameters.
  static func unitToPercent(_ value: Float) -> Float {
    value * 100
  }

  /// Octaves to cents, for Apple's band-pass filter bandwidth.
  static func octavesToCents(_ octaves: Float) -> Float {
    octaves * 1200
  }

  /**
   A resonance Q to the peak gain in decibels that Apple's filters expect.

   Apple's low/high-pass units express resonance as the dB bump at the cutoff
   rather than as Q. Q = 0.707 (Butterworth, maximally flat) is 0 dB, and the
   relationship is 20·log₁₀(Q / 0.707).
   */
  static func qToResonanceDB(_ q: Float) -> Float {
    min(40, max(-20, 20 * log10f(max(q, 0.0001) / 0.707)))
  }

  /**
   A 0..1 damping amount to a low-pass cutoff in hertz.

   Damping is "how much high end the room absorbs", so it runs opposite to
   cutoff: 0 keeps the tail bright, 1 makes it dark. Mapped geometrically so
   the control feels even across its travel.
   */
  static func dampingToCutoff(_ damping: Float) -> Float {
    let maxCutoff: Float = 20000
    let minCutoff: Float = 500
    let t = min(max(damping, 0), 1)
    return maxCutoff * powf(minCutoff / maxCutoff, t)
  }

  /// Hertz to the beats-per-minute an LFO rate parameter wants.
  static func hzToBPM(_ hz: Float) -> Float {
    hz * 60
  }

  static func clamp(_ value: Float, _ lower: Float, _ upper: Float) -> Float {
    min(upper, max(lower, value))
  }
}
