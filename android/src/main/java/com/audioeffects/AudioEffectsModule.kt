package com.audioeffects

import com.audioeffects.backend.AudioBackend
import com.audioeffects.backend.AudioEffectsException
import com.audioeffects.backend.KlarinetBackend
import com.audioeffects.backend.ParamChange
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * TurboModule entry point for Android.
 *
 * Marshals between React's types and [AudioBackend] and does nothing else.
 * All audio work lives behind that interface — see
 * `backend/AudioBackend.kt` for why the Klarinet dependency is kept at
 * arm's length.
 */
@ReactModule(name = AudioEffectsModule.NAME)
class AudioEffectsModule(reactContext: ReactApplicationContext) :
  NativeAudioEffectsSpec(reactContext) {

  companion object {
    const val NAME = NativeAudioEffectsSpec.NAME
  }

  private val backend: AudioBackend = KlarinetBackend(reactContext)

  /**
   * Promise-returning calls run here rather than on the JS thread: decoding
   * and transcoding a file takes long enough to drop frames.
   */
  private val worker = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "rn-audio-effects")
  }

  init {
    backend.onLevels = { sourceId, peakL, peakR, rmsL, rmsR ->
      emitOnLevels(
        Arguments.createMap().apply {
          putInt("sourceId", sourceId)
          putDouble("peakLeft", peakL.toDouble())
          putDouble("peakRight", peakR.toDouble())
          putDouble("rmsLeft", rmsL.toDouble())
          putDouble("rmsRight", rmsR.toDouble())
        }
      )
    }

    backend.onProgress = { sourceId, positionSec, durationSec, isPlaying ->
      emitOnProgress(
        Arguments.createMap().apply {
          putInt("sourceId", sourceId)
          putDouble("positionSec", positionSec)
          putDouble("durationSec", durationSec)
          putBoolean("isPlaying", isPlaying)
        }
      )
    }

    backend.onError = { code, message, sourceId ->
      emitOnError(
        Arguments.createMap().apply {
          putString("code", code)
          putString("message", message)
          putInt("sourceId", sourceId)
        }
      )
    }
  }

  override fun invalidate() {
    // Without this a reload leaves the previous engine holding the audio
    // device, so engines stack up and playback never stops.
    runCatching { backend.teardown() }
    worker.shutdown()
    super.invalidate()
  }

  // --------------------------------------------------------------- helpers

  /** Run on the worker and settle the promise, mapping typed errors. */
  private fun async(promise: Promise, work: () -> Any?) {
    worker.execute {
      try {
        promise.resolve(work())
      } catch (error: AudioEffectsException) {
        promise.reject(error.code, error.message, error)
      } catch (error: Throwable) {
        promise.reject("AUDIO_EFFECTS_ERROR", error.message, error)
      }
    }
  }

  // ---------------------------------------------------------------- engine

  override fun configure(options: ReadableMap, promise: Promise) = async(promise) {
    backend.configure(
      sampleRate = options.takeIntOrNull("sampleRate"),
      bufferFrames = options.takeIntOrNull("bufferFrames"),
    )
    // The `category` option is iOS-only (AVAudioSession) and is ignored here.
    null
  }

  override fun start(promise: Promise) = async(promise) { backend.start(); null }

  override fun stop(promise: Promise) = async(promise) { backend.stop(); null }

  override fun teardown(promise: Promise) = async(promise) {
    backend.teardown()
    null
  }

  // --------------------------------------------------------------- sources

  override fun loadFile(uri: String, promise: Promise) = async(promise) {
    val loaded = backend.loadFile(uri)
    Arguments.createMap().apply {
      putInt("sourceId", loaded.sourceId)
      putDouble("durationSec", loaded.durationSec)
      putInt("sampleRate", loaded.sampleRate)
      putInt("channelCount", loaded.channelCount)
      putArray(
        "peaks",
        Arguments.createArray().apply {
          loaded.peaks.forEach { pushDouble(it.toDouble()) }
        }
      )
    } as WritableMap
  }

  override fun createOscillator(
    waveform: String,
    options: ReadableMap,
    promise: Promise,
  ) = async(promise) {
    backend.createOscillator(
      waveform = waveform,
      frequency = options.takeDoubleOrNull("frequency")?.toFloat() ?: 440f,
      amplitude = options.takeDoubleOrNull("amplitude")?.toFloat() ?: 0.5f,
      antialias = options.takeBooleanOrNull("antialias") ?: true,
    )
  }

  override fun releaseSource(sourceId: Double, promise: Promise) = async(promise) {
    backend.releaseSource(sourceId.toInt())
    null
  }

  override fun playSource(sourceId: Double, loop: Boolean, promise: Promise) =
    async(promise) {
      backend.play(sourceId.toInt(), loop)
      null
    }

  override fun pauseSource(sourceId: Double, promise: Promise) = async(promise) {
    backend.pause(sourceId.toInt())
    null
  }

  override fun stopSource(sourceId: Double, promise: Promise) = async(promise) {
    backend.stopSource(sourceId.toInt())
    null
  }

  override fun seekSource(sourceId: Double, positionSec: Double, promise: Promise) =
    async(promise) {
      backend.seek(sourceId.toInt(), positionSec)
      null
    }

  override fun setSourceVolume(sourceId: Double, volume: Double) {
    backend.setSourceVolume(sourceId.toInt(), volume.toFloat())
  }

  override fun setOscillatorParameter(sourceId: Double, key: String, value: Double) {
    backend.setOscillatorParameter(sourceId.toInt(), key, value.toFloat())
  }

  // --------------------------------------------------------------- effects

  override fun createEffect(sourceId: Double, type: String, promise: Promise) =
    async(promise) {
      backend.createEffect(sourceId.toInt(), type)
    }

  override fun removeEffect(effectId: Double, promise: Promise) = async(promise) {
    backend.removeEffect(effectId.toInt())
    null
  }

  override fun reorderChain(
    sourceId: Double,
    effectIds: ReadableArray,
    promise: Promise,
  ) = async(promise) {
    val ids = (0 until effectIds.size()).map { effectIds.getDouble(it).toInt() }
    backend.reorderChain(sourceId.toInt(), ids)
    null
  }

  override fun setEffectEnabled(effectId: Double, enabled: Boolean) {
    backend.setEffectEnabled(effectId.toInt(), enabled)
  }

  // ------------------------------------------------------------ parameters

  override fun setParameter(effectId: Double, key: String, value: Double) {
    backend.setParameter(effectId.toInt(), key, value.toFloat())
  }

  override fun setParameters(changes: ReadableArray) {
    val parsed = (0 until changes.size()).mapNotNull { index ->
      val entry = changes.getMap(index) ?: return@mapNotNull null
      val effectId = entry.takeIntOrNull("effectId") ?: return@mapNotNull null
      val key = entry.getString("key") ?: return@mapNotNull null
      val value = entry.takeDoubleOrNull("value") ?: return@mapNotNull null
      ParamChange(effectId, key, value.toFloat())
    }
    backend.setParameters(parsed)
  }

  override fun getParameter(effectId: Double, key: String): Double =
    backend.getParameter(effectId.toInt(), key).toDouble()

  // ---------------------------------------------------------- capabilities

  override fun getCapabilitiesJSON(): String {
    // JSON rather than a struct because codegen cannot express a map with
    // dynamic keys. Read once at startup, so the parse cost is irrelevant.
    val effects = JSONObject()
    backend.effectCapabilities().forEach { (type, keys) ->
      effects.put(type, JSONArray(keys))
    }
    return JSONObject()
      .put("effects", effects)
      .put("generators", JSONArray(backend.generatorCapabilities()))
      .toString()
  }

  // -------------------------------------------------------------- metering

  override fun setMeteringEnabled(enabled: Boolean, intervalMs: Double) {
    backend.setMeteringEnabled(enabled, intervalMs)
  }
}

// ReadableMap throws rather than returning null for a missing key, so these
// keep the call sites free of hasKey checks.
private fun ReadableMap.takeIntOrNull(key: String): Int? =
  if (hasKey(key) && !isNull(key)) getDouble(key).toInt() else null

private fun ReadableMap.takeDoubleOrNull(key: String): Double? =
  if (hasKey(key) && !isNull(key)) getDouble(key) else null

private fun ReadableMap.takeBooleanOrNull(key: String): Boolean? =
  if (hasKey(key) && !isNull(key)) getBoolean(key) else null
