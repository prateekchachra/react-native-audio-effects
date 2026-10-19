package com.audioeffects.backend

import android.content.Context
import com.audioeffects.effects.EffectRegistry
import com.audioeffects.generators.Generator
import com.audioeffects.generators.GeneratorFactory
import com.audioeffects.io.FileImporter
import com.vectencia.klarinet.AudioEffect
import com.vectencia.klarinet.AudioEffectChain
import com.vectencia.klarinet.AudioEngine
import com.vectencia.klarinet.AudioFileReader
import com.vectencia.klarinet.AudioStream
import com.vectencia.klarinet.AudioStreamCallback
import com.vectencia.klarinet.AudioStreamConfig
import com.vectencia.klarinet.ParameterChange
import com.vectencia.klarinet.StreamDirection
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.timerTask
import kotlin.math.abs
import kotlin.math.min

/**
 * The Klarinet-backed Android implementation of [AudioBackend].
 *
 * Mirrors `ios/Backend/AudioKitBackend.swift` in shape: one engine, a table
 * of sources, a coalesced metering timer, and all unit conversion pushed down
 * into the per-effect mappings.
 *
 * ## How a source is modelled
 *
 * Klarinet's unit of playback is an [AudioStream] with an [AudioEffectChain]
 * attached. Unlike AudioKit, the chain is a genuinely mutable list — effects
 * can be added, removed and reordered on a running stream — so there is no
 * equivalent of the iOS graph rebuild. Parameter writes go straight to the
 * live [AudioEffect].
 *
 * ## Threading
 *
 * Mutating entry points are synchronised on [lock]. Parameter writes take the
 * same lock but do almost nothing under it, because they arrive from JS on
 * the hot path of a knob drag.
 */
internal class KlarinetBackend(private val context: Context) : AudioBackend {

  private companion object {
    const val DEFAULT_SAMPLE_RATE = 48_000
    const val DEFAULT_CHANNELS = 2
    /** Floor for the metering timer, matching the iOS backend. */
    const val MIN_METERING_INTERVAL_MS = 16.0
  }

  private val lock = Any()
  private val importer = FileImporter(context)

  private var engine: AudioEngine? = null
  private var sampleRate = DEFAULT_SAMPLE_RATE
  private var bufferFrames: Int? = null

  private val sources = mutableMapOf<Int, SourceEntry>()
  private val effectOwner = mutableMapOf<Int, Int>()
  private val nextId = AtomicInteger(1)

  private var meteringTimer: Timer? = null

  override var onLevels: ((Int, Float, Float, Float, Float) -> Unit)? = null
  override var onProgress: ((Int, Double, Double, Boolean) -> Unit)? = null
  override var onError: ((String, String, Int) -> Unit)? = null

  /** A source, its stream, and the effects attached to it. */
  private class SourceEntry(
    val id: Int,
    val stream: AudioStream,
    val chain: AudioEffectChain,
    /** Set for file sources. */
    val filePath: String? = null,
    val durationSec: Double = 0.0,
    /** Set for generator sources. */
    val generator: Generator? = null,
    /** Set for file sources; Klarinet does not expose it back off the stream. */
    val playback: FilePlaybackCallback? = null,
  ) {
    val slots = mutableListOf<EffectSlot>()
    var isPlaying = false
    /** Position in seconds, advanced by the progress timer for files. */
    var positionSec = 0.0
  }

  /** Bookkeeping for one effect: its handle, values and live Klarinet node. */
  private class EffectSlot(
    val id: Int,
    val type: String,
    val effect: AudioEffect,
  ) {
    /** Values in the schema's canonical units, for `getParameter`. */
    val values = mutableMapOf<String, Float>()
  }

  // ------------------------------------------------------------- lifecycle

  override fun configure(sampleRate: Int?, bufferFrames: Int?) {
    synchronized(lock) {
      this.sampleRate = sampleRate ?: DEFAULT_SAMPLE_RATE
      this.bufferFrames = bufferFrames
      if (engine == null) {
        engine = AudioEngine.create()
      }
    }
  }

  override fun start() {
    synchronized(lock) {
      requireEngine()
      // Klarinet starts per stream rather than globally; resume anything
      // that was playing when the engine was stopped.
      sources.values.filter { it.isPlaying }.forEach {
        runCatching { it.stream.start() }
      }
    }
  }

  override fun stop() {
    synchronized(lock) {
      sources.values.forEach { runCatching { it.stream.pause() } }
    }
  }

  override fun teardown() {
    synchronized(lock) {
      stopMeteringTimer()
      sources.values.forEach { entry -> releaseEntry(entry) }
      sources.clear()
      effectOwner.clear()
      runCatching { engine?.release() }
      engine = null
    }
  }

  private fun requireEngine(): AudioEngine =
    engine ?: throw AudioEffectsException.NotConfigured()

  private fun releaseEntry(entry: SourceEntry) {
    runCatching { entry.stream.stop() }
    runCatching { entry.stream.effectChain = null }
    entry.slots.forEach { runCatching { it.effect.release() } }
    runCatching { entry.chain.release() }
    runCatching { entry.stream.close() }
    entry.filePath?.let { importer.discard(it) }
  }

  // ---------------------------------------------------------------- source

  override fun loadFile(uri: String): LoadedSource {
    val imported = importer.import(uri)

    return synchronized(lock) {
      val engine = requireEngine()
      val id = nextId.getAndIncrement()

      val config = AudioStreamConfig(
        sampleRate = imported.sampleRate.takeIf { it > 0 } ?: sampleRate,
        channelCount = imported.channelCount.coerceIn(1, 2),
      )

      val reader = AudioFileReader(imported.path)
      val callback = FilePlaybackCallback(reader, config.channelCount)
      val stream = engine.openStream(config, callback)
      val chain = engine.createEffectChain()
      stream.effectChain = chain

      val entry = SourceEntry(
        id = id,
        stream = stream,
        chain = chain,
        filePath = imported.path,
        durationSec = imported.durationSec,
        playback = callback,
      )
      callback.onPosition = { frames ->
        entry.positionSec = frames.toDouble() / config.sampleRate
      }
      sources[id] = entry

      LoadedSource(
        sourceId = id,
        durationSec = imported.durationSec,
        sampleRate = config.sampleRate,
        channelCount = config.channelCount,
        peaks = imported.peaks,
      )
    }
  }

  /**
   * Streams a decoded file into the output buffer.
   *
   * Runs on Klarinet's worker thread rather than the real-time audio thread,
   * so reading from the file here is safe.
   */
  private class FilePlaybackCallback(
    private val reader: AudioFileReader,
    private val channelCount: Int,
  ) : AudioStreamCallback {
    @Volatile var isLooping = false
    @Volatile var isRunning = false
    @Volatile var lastPeak = 0f
    var onPosition: ((Long) -> Unit)? = null

    private var framesRead = 0L

    fun rewind() {
      runCatching { reader.seekTo(0) }
      framesRead = 0
      onPosition?.invoke(0)
    }

    fun seekToFrame(frame: Long) {
      runCatching { reader.seekTo(frame) }
      framesRead = frame
      onPosition?.invoke(frame)
    }

    override fun onAudioReady(buffer: FloatArray, numFrames: Int): Int {
      val wanted = numFrames * channelCount
      if (!isRunning) {
        java.util.Arrays.fill(buffer, 0, wanted, 0f)
        lastPeak = 0f
        return numFrames
      }

      var samples = reader.readFrames(numFrames)
      if (samples.isEmpty() && isLooping) {
        rewind()
        samples = reader.readFrames(numFrames)
      }

      var peak = 0f
      val copy = min(samples.size, wanted)
      for (index in 0 until copy) {
        val sample = samples[index]
        buffer[index] = sample
        val magnitude = abs(sample)
        if (magnitude > peak) peak = magnitude
      }
      if (copy < wanted) {
        java.util.Arrays.fill(buffer, copy, wanted, 0f)
      }
      lastPeak = peak

      framesRead += copy / channelCount
      onPosition?.invoke(framesRead)
      return numFrames
    }
  }

  override fun createOscillator(
    waveform: String,
    frequency: Float,
    amplitude: Float,
    antialias: Boolean,
  ): Int = synchronized(lock) {
    val engine = requireEngine()
    val config = AudioStreamConfig(
      sampleRate = sampleRate,
      channelCount = DEFAULT_CHANNELS,
    )

    val generator = GeneratorFactory.create(
      waveform, frequency, amplitude, antialias,
      config.sampleRate, config.channelCount,
    ) ?: throw AudioEffectsException.UnknownWaveform(waveform)

    val id = nextId.getAndIncrement()
    val stream = engine.openStream(config, generator)
    val chain = engine.createEffectChain()
    stream.effectChain = chain

    sources[id] = SourceEntry(
      id = id,
      stream = stream,
      chain = chain,
      generator = generator,
    )
    id
  }

  override fun releaseSource(sourceId: Int): Unit = synchronized(lock) {
    val entry = sources.remove(sourceId)
      ?: throw AudioEffectsException.SourceNotFound(sourceId)
    entry.slots.forEach { effectOwner.remove(it.id) }
    releaseEntry(entry)
  }

  override fun play(sourceId: Int, loop: Boolean) = synchronized(lock) {
    val entry = require(sourceId)
    entry.generator?.isRunning = true
    entry.playback?.apply {
      isLooping = loop
      isRunning = true
    }
    entry.isPlaying = true
    runCatching { entry.stream.start() }
      .onFailure { throw AudioEffectsException.EngineFailed(it) }
    Unit
  }

  override fun pause(sourceId: Int) = synchronized(lock) {
    val entry = require(sourceId)
    entry.generator?.isRunning = false
    entry.playback?.isRunning = false
    entry.isPlaying = false
    runCatching { entry.stream.pause() }
    Unit
  }

  override fun stopSource(sourceId: Int) = synchronized(lock) {
    val entry = require(sourceId)
    entry.generator?.isRunning = false
    entry.playback?.apply {
      isRunning = false
      rewind()
    }
    entry.isPlaying = false
    entry.positionSec = 0.0
    runCatching { entry.stream.stop() }
    Unit
  }

  override fun seek(sourceId: Int, positionSec: Double): Unit = synchronized(lock) {
    val entry = require(sourceId)
    val callback = entry.playback ?: return
    val clamped = positionSec.coerceIn(0.0, entry.durationSec)
    callback.seekToFrame((clamped * sampleRate).toLong())
    entry.positionSec = clamped
  }

  override fun setSourceVolume(sourceId: Int, volume: Float) {
    synchronized(lock) {
      // Klarinet has no per-stream volume, so the generator's own amplitude
      // is used where there is one. File sources scale through a gain effect
      // if the app adds one.
      sources[sourceId]?.generator?.amplitude = volume.coerceIn(0f, 1f)
    }
  }

  override fun setOscillatorParameter(sourceId: Int, key: String, value: Float) {
    synchronized(lock) {
      val generator = sources[sourceId]?.generator ?: return
      when (key) {
        "frequency" -> generator.frequency = value
        "amplitude" -> generator.amplitude = value.coerceIn(0f, 1f)
      }
    }
  }

  override fun setEnvelopeParameter(sourceId: Int, key: String, value: Float) {
    synchronized(lock) {
      sources[sourceId]?.generator?.envelope?.setParameter(key, value)
    }
  }

  override fun gate(sourceId: Int, on: Boolean) {
    synchronized(lock) {
      sources[sourceId]?.generator?.gate(on)
    }
  }

  // --------------------------------------------------------------- effects

  override fun createEffect(sourceId: Int, type: String): Int = synchronized(lock) {
    val entry = require(sourceId)
    val engine = requireEngine()

    // Reject rather than return a handle that silently does nothing.
    val klarinetType = EffectRegistry.klarinetType(type)
      ?: throw AudioEffectsException.EffectUnavailable(type)

    val effect = engine.createEffect(klarinetType)
    val id = nextId.getAndIncrement()
    val slot = EffectSlot(id, type, effect)
    entry.slots.add(slot)
    entry.chain.add(effect)
    effectOwner[id] = sourceId
    id
  }

  override fun removeEffect(effectId: Int): Unit = synchronized(lock) {
    val sourceId = effectOwner[effectId]
      ?: throw AudioEffectsException.EffectNotFound(effectId)
    val entry = require(sourceId)
    val slot = entry.slots.firstOrNull { it.id == effectId }
      ?: throw AudioEffectsException.EffectNotFound(effectId)

    entry.chain.remove(slot.effect)
    slot.effect.release()
    entry.slots.remove(slot)
    effectOwner.remove(effectId)
    Unit
  }

  override fun reorderChain(sourceId: Int, effectIds: List<Int>): Unit = synchronized(lock) {
    val entry = require(sourceId)
    if (effectIds.size != entry.slots.size ||
      effectIds.toSet() != entry.slots.map { it.id }.toSet()
    ) {
      throw AudioEffectsException.InvalidChainOrder()
    }

    val byId = entry.slots.associateBy { it.id }
    val reordered = effectIds.mapNotNull { byId[it] }

    // Klarinet applies effects in insertion order, so the chain is rebuilt
    // rather than permuted in place. Clearing does not release the effects,
    // so the handles and their parameters survive.
    entry.chain.clear()
    reordered.forEach { entry.chain.add(it.effect) }
    entry.slots.clear()
    entry.slots.addAll(reordered)
    Unit
  }

  override fun setEffectEnabled(effectId: Int, enabled: Boolean) {
    synchronized(lock) {
      findSlot(effectId)?.effect?.isEnabled = enabled
    }
  }

  // ------------------------------------------------------------ parameters

  override fun setParameter(effectId: Int, key: String, value: Float) {
    synchronized(lock) {
      val slot = findSlot(effectId) ?: return
      val mapping = EffectRegistry.mapping(slot.type) ?: return
      val paramId = mapping.id(key) ?: return
      slot.values[key] = value
      slot.effect.setParameter(paramId, mapping.convert(key, value))
    }
  }

  override fun setParameters(changes: List<ParamChange>) {
    synchronized(lock) {
      // Group by source so each chain commits its own batch atomically —
      // that is the whole point of applyBatch, and it is what keeps an XY pad
      // or a preset recall from zippering.
      changes.groupBy { effectOwner[it.effectId] }.forEach { (sourceId, group) ->
        val entry = sourceId?.let { sources[it] } ?: return@forEach
        val batch = mutableListOf<ParameterChange>()
        group.forEach { change ->
          val slot = entry.slots.firstOrNull { it.id == change.effectId }
            ?: return@forEach
          val mapping = EffectRegistry.mapping(slot.type) ?: return@forEach
          val paramId = mapping.id(change.key) ?: return@forEach
          slot.values[change.key] = change.value
          batch.add(
            ParameterChange(
              effect = slot.effect,
              paramId = paramId,
              value = mapping.convert(change.key, change.value),
            )
          )
        }
        if (batch.isNotEmpty()) {
          entry.chain.applyBatch(batch)
        }
      }
    }
  }

  override fun getParameter(effectId: Int, key: String): Float =
    synchronized(lock) { findSlot(effectId)?.values?.get(key) ?: 0f }

  // ---------------------------------------------------------- capabilities

  override fun effectCapabilities(): Map<String, List<String>> =
    EffectRegistry.capabilities()

  override fun generatorCapabilities(): List<String> = GeneratorFactory.waveforms

  // -------------------------------------------------------------- metering

  override fun setMeteringEnabled(enabled: Boolean, intervalMs: Double) {
    synchronized(lock) {
      stopMeteringTimer()
      if (!enabled) return

      // Coalesced on a timer, never emitted per audio buffer: at a 256 frame
      // buffer that would be ~190 events a second per source.
      val period = intervalMs.coerceAtLeast(MIN_METERING_INTERVAL_MS).toLong()
      meteringTimer = Timer("rn-audio-effects-metering", true).apply {
        scheduleAtFixedRate(timerTask { emitMetering() }, period, period)
      }
    }
  }

  private fun emitMetering() {
    val snapshot = synchronized(lock) { sources.values.toList() }
    snapshot.forEach { entry ->
      val peak = entry.generator?.lastPeak
        ?: entry.playback?.lastPeak
        ?: entry.stream.peakLevel
      // Klarinet reports a single peak rather than per-channel levels, and
      // RMS is approximated from it; a true stereo RMS would need a tap that
      // the SDK does not expose.
      val rms = peak * 0.707f
      onLevels?.invoke(entry.id, peak, peak, rms, rms)

      if (entry.filePath != null) {
        onProgress?.invoke(
          entry.id, entry.positionSec, entry.durationSec, entry.isPlaying
        )
      }
    }
  }

  private fun stopMeteringTimer() {
    meteringTimer?.cancel()
    meteringTimer = null
  }

  // --------------------------------------------------------------- helpers

  private fun require(sourceId: Int): SourceEntry =
    sources[sourceId] ?: throw AudioEffectsException.SourceNotFound(sourceId)

  private fun findSlot(effectId: Int): EffectSlot? {
    val sourceId = effectOwner[effectId] ?: return null
    return sources[sourceId]?.slots?.firstOrNull { it.id == effectId }
  }
}

