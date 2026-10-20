import AudioKit
import AudioKitEX
import AVFoundation
import Foundation
import SoundpipeAudioKit

/**
 The iOS audio backend.

 Owns the AudioKit engine, the table of live sources, and the metering timer.
 Deliberately knows nothing about React: `AudioEffectsImpl` adapts it to the
 TurboModule, and the Android side mirrors this shape behind its own
 `AudioBackend` interface so the two platforms stay structurally comparable.

 ## Threading

 Every mutating entry point runs on `queue`, a serial queue. The engine and
 the source table are only touched there, so no locking is needed. Parameter
 writes are the exception — they are dispatched synchronously because they
 arrive from JS on the hot path and must not queue up behind a rebuild.
 */
final class AudioKitBackend {
  private let engine = AudioEngine()
  private let rootMixer = Mixer()
  private let queue = DispatchQueue(label: "com.audioeffects.backend")

  /**
   A permanently attached silent oscillator.

   If the root mixer ever drops to zero inputs, AudioKit's render chain
   collapses and inputs added afterwards produce no output — so releasing the
   last source would silently break every source created after it. Keeping one
   node attached for the engine's lifetime keeps the chain intact. It renders
   exact zeros at amplitude 0, so the cost is one oscillator's worth of CPU
   and nothing audible.
   */
  private let keepAlive = Oscillator(waveform: Table(.sine), amplitude: 0)

  private var sources: [Int: SourceGraph] = [:]
  private var slotOwner: [Int: Int] = [:]  // effectId -> sourceId
  private var nextId = 1
  private var configured = false

  private var meteringTimer: DispatchSourceTimer?
  /// Remembered so sources created later are metered too — otherwise a
  /// source added after `setMeteringEnabled(true)` silently reports nothing.
  private var meteringEnabled = false

  /// Emitted at the metering interval for every source with metering on.
  var onLevels: ((Int, Float, Float, Float, Float) -> Void)?
  /// Emitted at the metering interval for every playing file source.
  var onProgress: ((Int, Double, Double, Bool) -> Void)?
  var onError: ((String, String, Int) -> Void)?

  // MARK: - Engine lifecycle

  func configure(sampleRate: Double?, bufferFrames: Double?, category: String?) throws {
    try queue.sync {
      let session = AVAudioSession.sharedInstance()
      let wantsInput = category == "playAndRecord"
      // A2DP rather than the (deprecated) HFP option: it is the higher
      // quality stereo profile, and nothing here captures from a Bluetooth
      // microphone.
      try session.setCategory(
        wantsInput ? .playAndRecord : .playback,
        mode: .default,
        options: wantsInput
          ? [.defaultToSpeaker, .allowBluetoothA2DP]
          : [.allowBluetoothA2DP]
      )
      if let sampleRate {
        try? session.setPreferredSampleRate(sampleRate)
      }
      if let bufferFrames, sampleRate ?? session.sampleRate > 0 {
        // AVAudioSession wants a duration, not a frame count.
        let rate = sampleRate ?? session.sampleRate
        try? session.setPreferredIOBufferDuration(bufferFrames / rate)
      }
      try session.setActive(true)

      if !rootMixer.hasInput(keepAlive) {
        rootMixer.addInput(keepAlive)
        keepAlive.start()
      }
      engine.output = rootMixer
      configured = true
    }
  }

  func start() throws {
    try queue.sync {
      guard configured else { throw AudioEffectsError.notConfigured }
      do {
        try engine.start()
      } catch {
        throw AudioEffectsError.engineFailed(error)
      }
    }
  }

  func stop() {
    queue.sync { engine.stop() }
  }

  func teardown() {
    queue.sync {
      stopMeteringTimer()
      meteringEnabled = false
      for source in sources.values {
        source.teardown()
      }
      sources.removeAll()
      slotOwner.removeAll()
      rootMixer.removeAllInputs()
      keepAlive.stop()
      engine.stop()
      try? AVAudioSession.sharedInstance().setActive(false)
      configured = false
    }
  }

  // MARK: - Sources

  func loadFile(uri: String) throws -> [String: Any] {
    try queue.sync {
      let imported = try FileImporter.import(uri: uri)
      guard let player = AudioPlayer(file: imported.file) else {
        throw AudioEffectsError.decodeFailed(uri, underlying: nil)
      }

      let id = nextId
      nextId += 1
      let graph = SourceGraph(
        id: id,
        player: player,
        fileURL: imported.url,
        durationSec: imported.durationSec,
        engine: engine
      )
      sources[id] = graph
      rootMixer.addInput(graph.meter)
      engine.rebuildGraph()

      return [
        "sourceId": id,
        "durationSec": imported.durationSec,
        "sampleRate": imported.sampleRate,
        "channelCount": imported.channelCount,
        "peaks": imported.peaks,
      ]
    }
  }

  func createOscillator(waveform: String, frequency: Float, amplitude: Float) throws -> Int {
    try queue.sync {
      guard
        let generator = GeneratorFactory.make(
          waveform: waveform, frequency: frequency, amplitude: amplitude
        )
      else {
        throw AudioEffectsError.unknownWaveform(waveform)
      }

      let id = nextId
      nextId += 1
      let graph = SourceGraph(id: id, generator: generator, engine: engine)
      sources[id] = graph
      rootMixer.addInput(graph.meter)
      engine.rebuildGraph()
      return id
    }
  }

  func releaseSource(_ sourceId: Int) throws {
    try queue.sync {
      guard let graph = sources.removeValue(forKey: sourceId) else {
        throw AudioEffectsError.sourceNotFound(sourceId)
      }
      for slot in graph.slots {
        slotOwner.removeValue(forKey: slot.id)
      }
      rootMixer.removeInput(graph.meter)
      graph.teardown()
      engine.rebuildGraph()
    }
  }

  func play(_ sourceId: Int, loop: Bool) throws {
    try queue.sync {
      let graph = try require(sourceId)
      if let player = graph.player {
        player.isLooping = loop
        player.play()
      } else {
        graph.generator?.play()
        graph.openGateIfUngated()
      }
      // Tapped here rather than at creation: the chain is settled by now, and
      // installing a tap before it is leaves the player silent.
      if meteringEnabled { graph.startMetering() }
    }
  }

  func pause(_ sourceId: Int) throws {
    try queue.sync {
      let graph = try require(sourceId)
      // A generator has no position to resume from, so pausing one is a stop.
      graph.closeGateForTransport()
      graph.player?.pause() ?? graph.generator?.stop()
    }
  }

  func stopSource(_ sourceId: Int) throws {
    try queue.sync {
      let graph = try require(sourceId)
      graph.closeGateForTransport()
      graph.player?.stop() ?? graph.generator?.stop()
    }
  }

  func seek(_ sourceId: Int, positionSec: Double) throws {
    try queue.sync {
      let graph = try require(sourceId)
      guard let player = graph.player else { return }
      let clamped = min(max(positionSec, 0), graph.durationSec)
      player.seek(time: clamped)
    }
  }

  func setSourcePan(_ sourceId: Int, pan: Float) {
    queue.sync {
      sources[sourceId]?.setPan(pan)
    }
  }

  func setSourceVolume(_ sourceId: Int, volume: Float) {
    queue.sync {
      // The source's own fader, not the output mixer — the meter tap reads
      // the mixer, and writing volume there would make the meter lie.
      sources[sourceId]?.head.gain = min(max(volume, 0), 1)
    }
  }

  /// Live pitch and level for a generator source.
  func setOscillatorParameter(_ sourceId: Int, key: String, value: Float) {
    queue.sync {
      guard let generator = sources[sourceId]?.generator else { return }
      switch key {
      case "frequency": generator.setFrequency(value)
      case "amplitude": generator.setAmplitude(value)
      default: break
      }
    }
  }

  /// ADSR parameter for a generator source. Ignored for file sources.
  func setEnvelopeParameter(_ sourceId: Int, key: String, value: Float) {
    queue.sync {
      sources[sourceId]?.setEnvelopeParameter(key, value)
    }
  }

  /**
   Note on / note off for a generator's envelope.

   A note-on while the gate is already open has to retrigger the attack, not
   be ignored. The envelope audio unit samples its gate once per render
   block, so closing and reopening within the same block is invisible to it
   — the close has to be given a block to land before the reopen. One block
   at a typical buffer size is around six milliseconds, well under the
   threshold where a key press feels delayed.
   */
  func gate(_ sourceId: Int, on: Bool) {
    queue.sync {
      guard let graph = sources[sourceId] else { return }

      guard on, graph.isGateOpen else {
        graph.setGate(on)
        return
      }

      graph.setGate(false)
      queue.asyncAfter(deadline: .now() + Self.retriggerGap) { [weak graph] in
        graph?.setGate(true)
      }
    }
  }

  /// Gap between closing and reopening the gate on a retrigger.
  private static let retriggerGap = 0.012

  // MARK: - Effects

  func createEffect(sourceId: Int, type: String) throws -> Int {
    try queue.sync {
      let graph = try require(sourceId)
      guard EffectFactory.isSupported(type) else {
        // Reject rather than hand back a handle that silently does nothing —
        // a no-op effect is the hardest kind of audio bug to track down.
        throw AudioEffectsError.effectUnavailable(type)
      }

      let id = nextId
      nextId += 1
      let slot = EffectSlot(id: id, type: type)
      graph.addSlot(slot)
      slotOwner[id] = sourceId
      engine.rebuildGraph()
      refreshMetering(graph)
      return id
    }
  }

  func removeEffect(_ effectId: Int) throws {
    try queue.sync {
      guard let sourceId = slotOwner[effectId], let graph = sources[sourceId],
        graph.removeSlot(id: effectId)
      else {
        throw AudioEffectsError.effectNotFound(effectId)
      }
      slotOwner.removeValue(forKey: effectId)
      engine.rebuildGraph()
      refreshMetering(graph)
    }
  }

  func reorderChain(sourceId: Int, effectIds: [Int]) throws {
    try queue.sync {
      let graph = try require(sourceId)
      guard graph.reorder(effectIds) else {
        throw AudioEffectsError.invalidChainOrder
      }
      engine.rebuildGraph()
      refreshMetering(graph)
    }
  }

  func setEffectEnabled(_ effectId: Int, enabled: Bool) {
    queue.sync {
      guard let sourceId = slotOwner[effectId],
        let slot = sources[sourceId]?.slot(id: effectId)
      else { return }
      slot.enabled = enabled
      slot.node?.setEnabled(enabled)
    }
  }

  // MARK: - Parameters

  func setParameter(_ effectId: Int, key: String, value: Float) {
    queue.sync {
      guard let sourceId = slotOwner[effectId],
        let slot = sources[sourceId]?.slot(id: effectId)
      else { return }
      slot.apply(key, value)
    }
  }

  /// Apply a batch in one hop. Klarinet commits these within a single audio
  /// cycle; AudioKit has no equivalent, so the win here is just the one
  /// queue round-trip instead of N.
  func setParameters(_ changes: [(effectId: Int, key: String, value: Float)]) {
    queue.sync {
      for change in changes {
        guard let sourceId = slotOwner[change.effectId],
          let slot = sources[sourceId]?.slot(id: change.effectId)
        else { continue }
        slot.apply(change.key, change.value)
      }
    }
  }

  func getParameter(_ effectId: Int, key: String) -> Float {
    queue.sync {
      guard let sourceId = slotOwner[effectId],
        let slot = sources[sourceId]?.slot(id: effectId)
      else { return 0 }
      return slot.values[key] ?? 0
    }
  }

  /**
   Re-arm a source's meter after the graph was rebuilt.

   Rebuilding drops installed taps, and `AmplitudeTap` keeps returning its
   last reading rather than reporting that it has gone deaf — so a stale
   tap looks exactly like silence. Re-arming is safe because the tap sits
   on the source's fixed metering node, whose own wiring never changes.
   */
  private func refreshMetering(_ graph: SourceGraph) {
    guard meteringEnabled else { return }
    graph.stopMetering()
    graph.startMetering()
  }

  // MARK: - Metering

  func setMeteringEnabled(_ enabled: Bool, intervalMs: Double) {
    queue.sync {
      stopMeteringTimer()
      meteringEnabled = enabled
      guard enabled else {
        for source in sources.values { source.stopMetering() }
        return
      }
      // Only sources already playing are tapped now; the rest are tapped
      // when they start. Tapping an idle source measures nothing anyway, and
      // tapping one whose chain is still being assembled silences it.
      for source in sources.values where source.isPlaying {
        source.startMetering()
      }

      // Coalesced on a timer rather than emitted per audio buffer: at a 256
      // frame buffer that would be ~190 events a second per source, which
      // would swamp the JS thread for no visible benefit.
      let interval = max(16, intervalMs) / 1000
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now() + interval, repeating: interval)
      timer.setEventHandler { [weak self] in self?.emitMetering() }
      timer.resume()
      meteringTimer = timer
    }
  }

  private func emitMetering() {
    for (id, source) in sources {
      if let levels = source.levels {
        onLevels?(id, levels.peakLeft, levels.peakRight, levels.rmsLeft, levels.rmsRight)
      }
      if source.player != nil {
        onProgress?(id, source.positionSec, source.durationSec, source.isPlaying)
      }
    }
  }

  private func stopMeteringTimer() {
    meteringTimer?.cancel()
    meteringTimer = nil
  }

  // MARK: - Capabilities

  var capabilities: [String: Any] {
    [
      "effects": EffectFactory.capabilities,
      "generators": GeneratorFactory.waveforms,
    ]
  }

  // MARK: - Helpers

  private func require(_ sourceId: Int) throws -> SourceGraph {
    guard let graph = sources[sourceId] else {
      throw AudioEffectsError.sourceNotFound(sourceId)
    }
    return graph
  }
}
