package com.audioeffects.backend

/**
 * Errors surfaced to JavaScript.
 *
 * [code] becomes the promise rejection code, matching the strings in
 * `ios/Support/AudioEffectsError.swift` so JS branches on one vocabulary
 * regardless of platform.
 */
internal sealed class AudioEffectsException(
  val code: String,
  message: String,
  cause: Throwable? = null,
) : Exception(message, cause) {

  class NotConfigured :
    AudioEffectsException(
      "NOT_CONFIGURED",
      "The audio engine has not been configured. Call configure() first.",
    )

  class SourceNotFound(id: Int) :
    AudioEffectsException(
      "SOURCE_NOT_FOUND",
      "No source with id $id. It may already have been released.",
    )

  class EffectNotFound(id: Int) :
    AudioEffectsException(
      "EFFECT_NOT_FOUND",
      "No effect with id $id. It may already have been removed.",
    )

  class EffectUnavailable(type: String) :
    AudioEffectsException(
      "EFFECT_UNAVAILABLE",
      "The effect '$type' is not available on Android. Check " +
        "getCapabilities() before creating it.",
    )

  class UnknownEffect(type: String) :
    AudioEffectsException("UNKNOWN_EFFECT", "Unknown effect type '$type'.")

  class UnknownWaveform(waveform: String) :
    AudioEffectsException("UNKNOWN_WAVEFORM", "Unknown waveform '$waveform'.")

  class FileNotFound(uri: String) :
    AudioEffectsException(
      "FILE_NOT_FOUND",
      "Could not open an audio file at $uri.",
    )

  class DownloadFailed(url: String, reason: String, cause: Throwable? = null) :
    AudioEffectsException(
      "DOWNLOAD_FAILED",
      "Could not download $url: $reason.",
      cause,
    )

  class DecodeFailed(uri: String, cause: Throwable? = null) :
    AudioEffectsException(
      "DECODE_FAILED",
      "Could not decode $uri: ${cause?.message ?: "unsupported format"}.",
      cause,
    )

  class InvalidChainOrder :
    AudioEffectsException(
      "INVALID_CHAIN_ORDER",
      "The effect ids passed to reorderChain() are not a permutation of " +
        "the source's current chain.",
    )

  class EngineFailed(cause: Throwable) :
    AudioEffectsException(
      "ENGINE_FAILED",
      "The audio engine failed to start: ${cause.message}",
      cause,
    )
}

/** Alias used by [AudioBackend] for readability at the call site. */
internal typealias EffectUnavailableException = AudioEffectsException.EffectUnavailable
