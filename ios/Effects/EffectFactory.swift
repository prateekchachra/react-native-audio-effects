import AudioKit
import Foundation

/**
 Maps schema effect types to their iOS implementations.

 This table is the iOS half of the capability contract: whatever appears here
 is what `getCapabilitiesJSON()` reports, and the parity test in
 `src/__tests__/capabilities.test.ts` asserts it agrees with the schema's
 `platforms` flags. Adding an effect means adding it here and in the schema —
 the test fails if only one is updated.
 */
enum EffectFactory {
  /// Every effect iOS implements, with the parameter keys each honours.
  static let registry: [(type: String, keys: [String], make: (Node) -> EffectNode)] = [
    (GainEffect.type, GainEffect.supportedKeys, { GainEffect(input: $0) }),
    (PanEffect.type, PanEffect.supportedKeys, { PanEffect(input: $0) }),
    (DelayEffect.type, DelayEffect.supportedKeys, { DelayEffect(input: $0) }),
    (ReverbEffect.type, ReverbEffect.supportedKeys, { ReverbEffect(input: $0) }),
    (ChorusEffect.type, ChorusEffect.supportedKeys, { ChorusEffect(input: $0) }),
    (FlangerEffect.type, FlangerEffect.supportedKeys, { FlangerEffect(input: $0) }),
    (PhaserEffect.type, PhaserEffect.supportedKeys, { PhaserEffect(input: $0) }),
    (TremoloEffect.type, TremoloEffect.supportedKeys, { TremoloEffect(input: $0) }),
    (CompressorEffect.type, CompressorEffect.supportedKeys, { CompressorEffect(input: $0) }),
    (LimiterEffect.type, LimiterEffect.supportedKeys, { LimiterEffect(input: $0) }),
    (NoiseGateEffect.type, NoiseGateEffect.supportedKeys, { NoiseGateEffect(input: $0) }),
    (ParametricEqEffect.type, ParametricEqEffect.supportedKeys, { ParametricEqEffect(input: $0) }),
    (LowPassEffect.type, LowPassEffect.supportedKeys, { LowPassEffect(input: $0) }),
    (HighPassEffect.type, HighPassEffect.supportedKeys, { HighPassEffect(input: $0) }),
    (BandPassEffect.type, BandPassEffect.supportedKeys, { BandPassEffect(input: $0) }),
    (DistortionEffect.type, DistortionEffect.supportedKeys, { DistortionEffect(input: $0) }),
    (BitCrusherEffect.type, BitCrusherEffect.supportedKeys, { BitCrusherEffect(input: $0) }),
  ]

  private static let byType = Dictionary(
    uniqueKeysWithValues: registry.map { ($0.type, $0) }
  )

  static func isSupported(_ type: String) -> Bool {
    byType[type] != nil
  }

  static func make(type: String, input: Node) -> EffectNode? {
    byType[type]?.make(input)
  }

  /// `{ effectType: [parameterKey, ...] }`, for `getCapabilitiesJSON()`.
  static var capabilities: [String: [String]] {
    Dictionary(uniqueKeysWithValues: registry.map { ($0.type, $0.keys) })
  }
}
