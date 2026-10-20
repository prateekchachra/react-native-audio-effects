import Foundation

/**
 Errors surfaced to JavaScript.

 The `code` travels in `userInfo["code"]` and becomes the promise rejection
 code, so JS can branch on a stable string rather than parsing a message. See
 `RNAECodeForError` in AudioEffects.mm.
 */
enum AudioEffectsError: LocalizedError {
  case notConfigured
  case sourceNotFound(Int)
  case effectNotFound(Int)
  case effectUnavailable(String)
  case unknownEffect(String)
  case unknownWaveform(String)
  case fileNotFound(String)
  /// A remote sample could not be fetched. Carries the URL and the reason.
  case downloadFailed(String, String)
  case decodeFailed(String, underlying: Error?)
  case invalidChainOrder
  case engineFailed(Error)

  var code: String {
    switch self {
    case .notConfigured: return "NOT_CONFIGURED"
    case .sourceNotFound: return "SOURCE_NOT_FOUND"
    case .effectNotFound: return "EFFECT_NOT_FOUND"
    case .effectUnavailable: return "EFFECT_UNAVAILABLE"
    case .unknownEffect: return "UNKNOWN_EFFECT"
    case .unknownWaveform: return "UNKNOWN_WAVEFORM"
    case .fileNotFound: return "FILE_NOT_FOUND"
    case .downloadFailed: return "DOWNLOAD_FAILED"
    case .decodeFailed: return "DECODE_FAILED"
    case .invalidChainOrder: return "INVALID_CHAIN_ORDER"
    case .engineFailed: return "ENGINE_FAILED"
    }
  }

  var errorDescription: String? {
    switch self {
    case .notConfigured:
      return "The audio engine has not been configured. Call configure() first."
    case let .sourceNotFound(id):
      return "No source with id \(id). It may already have been released."
    case let .effectNotFound(id):
      return "No effect with id \(id). It may already have been removed."
    case let .effectUnavailable(type):
      return
        "The effect '\(type)' is not available on iOS. Check getCapabilities() "
        + "before creating it."
    case let .unknownEffect(type):
      return "Unknown effect type '\(type)'."
    case let .unknownWaveform(waveform):
      return "Unknown waveform '\(waveform)'."
    case let .fileNotFound(uri):
      return "Could not open an audio file at \(uri)."
    case let .downloadFailed(url, reason):
      return "Could not download \(url): \(reason)."
    case let .decodeFailed(uri, underlying):
      let reason = underlying?.localizedDescription ?? "unsupported format"
      return "Could not decode \(uri): \(reason)."
    case .invalidChainOrder:
      return
        "The effect ids passed to reorderChain() are not a permutation of the "
        + "source's current chain."
    case let .engineFailed(underlying):
      return "The audio engine failed to start: \(underlying.localizedDescription)"
    }
  }

  /// Bridged representation; `code` is read by the ObjC++ layer.
  var asNSError: NSError {
    NSError(
      domain: "RNAudioEffects",
      code: 1,
      userInfo: [
        "code": code,
        NSLocalizedDescriptionKey: errorDescription ?? "Unknown audio error",
      ]
    )
  }
}
