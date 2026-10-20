package com.audioeffects.backend

/**
 * The Android audio backend, as the TurboModule sees it.
 *
 * ## Why this interface exists
 *
 * Klarinet is young — 0.5.0, a handful of months old, effectively one
 * maintainer. It is technically sound (signed artifacts, a JNI C++ DSP core,
 * cross-platform tests) and it is the only Kotlin library that covers this
 * effect set, but making it a load-bearing dependency of a library that wants
 * to be stable is a real risk.
 *
 * So nothing above this line knows Klarinet exists. [AudioEffectsModule] talks
 * only to this interface, and [KlarinetBackend] is one implementation of it.
 * Replacing it with an in-house Oboe + C++ core later is a new class and a
 * one-line change at the construction site — no churn in the TurboModule, the
 * JavaScript API, or the UI.
 *
 * The shape deliberately mirrors `ios/Backend/AudioKitBackend.swift` so the
 * two platforms stay comparable when reading them side by side.
 */
internal interface AudioBackend {

  // ------------------------------------------------------------- lifecycle

  fun configure(sampleRate: Int?, bufferFrames: Int?)
  fun start()
  fun stop()
  fun teardown()

  // ---------------------------------------------------------------- source

  /** Decode a file and make it playable. Returns metadata plus a handle. */
  fun loadFile(uri: String): LoadedSource

  fun createOscillator(waveform: String, frequency: Float, amplitude: Float, antialias: Boolean): Int

  fun releaseSource(sourceId: Int)

  fun play(sourceId: Int, loop: Boolean)
  fun pause(sourceId: Int)
  fun stopSource(sourceId: Int)
  fun seek(sourceId: Int, positionSec: Double)
  fun setSourceVolume(sourceId: Int, volume: Float)

  /** Stereo placement of a whole source. -1 hard left, 1 hard right. */
  fun setSourcePan(sourceId: Int, pan: Float)
  fun setOscillatorParameter(sourceId: Int, key: String, value: Float)

  /** ADSR parameter on a generator. Times in ms, sustain a 0..1 level. */
  fun setEnvelopeParameter(sourceId: Int, key: String, value: Float)

  /** Note on / note off for a generator's envelope. */
  fun gate(sourceId: Int, on: Boolean)

  // --------------------------------------------------------------- effects

  /** @throws EffectUnavailableException when this backend has no such effect. */
  fun createEffect(sourceId: Int, type: String): Int

  fun removeEffect(effectId: Int)
  fun reorderChain(sourceId: Int, effectIds: List<Int>)
  fun setEffectEnabled(effectId: Int, enabled: Boolean)

  // ------------------------------------------------------------ parameters

  fun setParameter(effectId: Int, key: String, value: Float)

  /** Applied atomically within one audio cycle where the backend can. */
  fun setParameters(changes: List<ParamChange>)

  fun getParameter(effectId: Int, key: String): Float

  // ---------------------------------------------------------- capabilities

  /** `{ effectType: [parameterKey, ...] }` for what is actually implemented. */
  fun effectCapabilities(): Map<String, List<String>>

  fun generatorCapabilities(): List<String>

  // -------------------------------------------------------------- metering

  fun setMeteringEnabled(enabled: Boolean, intervalMs: Double)

  /** Sinks wired to the TurboModule's generated event emitters. */
  var onLevels: ((sourceId: Int, peakL: Float, peakR: Float, rmsL: Float, rmsR: Float) -> Unit)?
  var onProgress: ((sourceId: Int, positionSec: Double, durationSec: Double, isPlaying: Boolean) -> Unit)?
  var onError: ((code: String, message: String, sourceId: Int) -> Unit)?
}

/** Metadata for a decoded file, mirroring the `LoadedSource` wire type. */
internal data class LoadedSource(
  val sourceId: Int,
  val durationSec: Double,
  val sampleRate: Int,
  val channelCount: Int,
  /** Interleaved min/max pairs in -1..1 for drawing a waveform. */
  val peaks: FloatArray,
) {
  // FloatArray breaks data-class equality; these keep it meaningful.
  override fun equals(other: Any?): Boolean =
    this === other || (other is LoadedSource && sourceId == other.sourceId)

  override fun hashCode(): Int = sourceId
}

internal data class ParamChange(
  val effectId: Int,
  val key: String,
  val value: Float,
)
