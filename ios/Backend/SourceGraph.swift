import AudioKit
import AudioKitEX
import AVFoundation
import Foundation
import SoundpipeAudioKit

/**
 One effect in a chain, as bookkeeping rather than as a live node.

 The live AudioKit node is recreated whenever the chain's shape changes, so
 the slot — not the node — owns the identity and the parameter values. That
 keeps `effectId` stable across rebuilds and lets `getParameter` answer from
 memory instead of reading back from a node whose units differ from the
 schema's.
 */
final class EffectSlot {
  let id: Int
  let type: String
  /// Current values in the schema's canonical units.
  var values: [String: Float] = [:]
  var enabled = true
  /// The live node, nil until the next rebuild.
  var node: EffectNode?

  init(id: Int, type: String) {
    self.id = id
    self.type = type
  }

  func apply(_ key: String, _ value: Float) {
    values[key] = value
    node?.setParameter(key, value)
  }

  /// Re-apply every stored value to a freshly created node.
  func reapply() {
    guard let node else { return }
    for (key, value) in values {
      node.setParameter(key, value)
    }
    node.setEnabled(enabled)
  }
}

/**
 A source and its effect chain.

 ## Why the chain is rebuilt rather than rewired

 AudioKit nodes take their input at construction and expose `connections` as a
 computed property, so there is no supported way to splice a node into a
 running chain. Structural changes therefore recreate the nodes in order and
 re-apply the stored parameters.

 That only happens on add, remove and reorder. Parameter writes — the hot path
 a knob drives at 60 fps — go straight to the live node and never rebuild.
 */
final class SourceGraph {
  let id: Int

  /**
   Player for file sources; nil for generators.

   Replaced on every structural change. `AudioPlayer` does not survive
   having its downstream rewired — it keeps running but renders silence
   from then on, permanently, which is what made adding or removing an
   effect kill a file source. Rather than nurse it back, each rebuild gets
   a fresh player loaded from the same cached file, with position and
   transport carried across.
   */
  private(set) var player: AudioPlayer?
  /// Generator for oscillator sources; nil for files.
  let generator: GeneratorNode?
  /// Cached copy of an imported file, removed when the source is released.
  let fileURL: URL?
  /// Kept so the player can be re-primed after the graph is rewired.
  private let file: AVAudioFile?
  let durationSec: Double

  /// Stable node the root mixer listens to, so the chain can be rebuilt
  /// underneath without touching the engine's output wiring.
  let output = Mixer()

  /**
   A fixed metering point between the chain and the engine.

   `output`'s inputs change on every structural edit, and an `AmplitudeTap`
   on a node whose connections change stops updating — it keeps returning
   its last reading forever, which looks exactly like the audio having
   died. This node sits downstream of `output` and is wired once, so the
   tap on it stays live no matter how the chain is rebuilt.

   It is also what the root mixer listens to, not `output`.
   */
  private(set) var meter: Fader!

  /**
   A permanent first link, between the source and the effect chain.

   The source is connected to this once, at construction, and never
   rewired. Without it the chain's first node is the player itself, so
   every add or remove reconnected the player — and an `AudioPlayer` whose
   output connection changes keeps running while rendering silence, for
   good. Anchoring the head here means structural edits only ever touch
   nodes downstream of it.

   It also gives `setSourceVolume` somewhere honest to write, instead of
   the output mixer that the meter tap reads.
   */
  private(set) var head: Fader!

  /**
   ADSR envelope, for generators only.

   Sits between the generator and the effect chain so the shape is applied
   before anything downstream. File sources have no envelope: they are gated
   by transport rather than by note events.
   */
  private(set) var envelope: AmplitudeEnvelope?

  /**
   Whether anything has gated the envelope yet.

   `AmplitudeEnvelope` starts closed, so a generator started with the
   transport button and never gated would be silent. Until the first explicit
   note event the envelope is held open, which makes a plain `play()` behave
   the way it did before envelopes existed.
   */
  private var envelopeEngaged = false

  /// Whether the gate is currently open, so a second note-on can be told
  /// apart from the first and retriggered.
  private(set) var isGateOpen = false

  private(set) var slots: [EffectSlot] = []
  private var amplitudeTap: AmplitudeTap?

  /**
   The engine, so a rebuild can detach the nodes it replaces.

   Without this the previous rebuild's effect nodes stay attached and keep
   their connection to the source. AVAudioEngine allows one output
   connection per bus, so the orphans block the new chain from connecting
   and the source goes silent — permanently, since every later rebuild
   leaves more orphans behind.
   */
  private weak var engine: AudioEngine?

  /// Effect nodes created by the last rebuild, awaiting detachment.
  private var builtNodes: [Node] = []

  /// The node currently feeding `output`, so it can be swapped rather than
  /// cleared.
  private var currentTail: Node?

  /// What feeds `head`: the generator's envelope where there is one,
  /// otherwise the source itself. Used only at construction.
  var sourceNode: Node {
    if let envelope { return envelope }
    if let player { return player as Node }
    if let generator { return generator.node }
    fatalError("A source must have either a player or a generator")
  }

  init(
    id: Int,
    player: AudioPlayer,
    fileURL: URL,
    durationSec: Double,
    engine: AudioEngine
  ) {
    self.id = id
    self.player = player
    self.generator = nil
    self.fileURL = fileURL
    self.durationSec = durationSec
    self.engine = engine
    self.file = player.file
    self.head = Fader(player, gain: 1)
    self.meter = Fader(output, gain: 1)
    rebuild()
  }

  init(id: Int, generator: GeneratorNode, engine: AudioEngine) {
    self.id = id
    self.player = nil
    self.generator = generator
    self.fileURL = nil
    self.durationSec = 0
    self.engine = engine
    self.file = nil
    self.envelope = AmplitudeEnvelope(generator.node)
    self.head = Fader(self.envelope!, gain: 1)
    self.meter = Fader(output, gain: 1)
    rebuild()
  }

  /// Apply an ADSR parameter. Times arrive in milliseconds, as the schema
  /// declares them; AudioKit wants seconds.
  func setEnvelopeParameter(_ key: String, _ value: Float) {
    guard let envelope else { return }
    switch key {
    case "attack": envelope.attackDuration = max(value / 1000, 0.0001)
    case "decay": envelope.decayDuration = max(value / 1000, 0.0001)
    case "sustain": envelope.sustainLevel = min(max(value, 0), 1)
    case "release": envelope.releaseDuration = max(value / 1000, 0.0001)
    default: break
    }
  }

  /// Open or close the gate directly, without retrigger handling.
  func setGate(_ on: Bool) {
    guard let envelope else { return }
    envelopeEngaged = true
    isGateOpen = on
    on ? envelope.openGate() : envelope.closeGate()
  }

  /// Hold the envelope open for a generator that is played rather than
  /// gated. No-op once a real note event has happened.
  func openGateIfUngated() {
    guard let envelope, !envelopeEngaged else { return }
    envelope.openGate()
    isGateOpen = true
  }

  /// Close the envelope when the transport stops, so a later play starts clean.
  func closeGateForTransport() {
    guard let envelope, !envelopeEngaged else { return }
    envelope.closeGate()
    isGateOpen = false
  }

  // MARK: - Chain structure

  func addSlot(_ slot: EffectSlot) {
    slots.append(slot)
    rebuild()
  }

  func removeSlot(id: Int) -> Bool {
    guard let index = slots.firstIndex(where: { $0.id == id }) else {
      return false
    }
    slots.remove(at: index)
    rebuild()
    return true
  }

  func slot(id: Int) -> EffectSlot? {
    slots.first { $0.id == id }
  }

  /// Reorder the chain. `order` must be a permutation of the current slots.
  func reorder(_ order: [Int]) -> Bool {
    guard order.count == slots.count, Set(order) == Set(slots.map(\.id)) else {
      return false
    }
    let byId = Dictionary(uniqueKeysWithValues: slots.map { ($0.id, $0) })
    slots = order.compactMap { byId[$0] }
    rebuild()
    return true
  }

  /// Recreate every effect node in order and reconnect the chain.
  private func rebuild() {
    // The tap is deliberately left attached. `output` is the same Mixer
    // object across every rebuild, so the tap stays valid — and tearing it
    // down and reinstalling it here is what made every measurement after a
    // chain change read zero, which looked like the audio had died when it
    // was only the meter.

    // Build the new chain first, then swap it in. Letting `output` drop to
    // zero inputs collapses its render chain and it never recovers — the
    // same failure the root mixer has, and the reason removing an effect
    // used to silence the source permanently.
    let previousTail = currentTail
    let previousNodes = builtNodes
    builtNodes = []

    var current: Node = head
    for slot in slots {
      guard let node = EffectFactory.make(type: slot.type, input: current) else {
        continue
      }
      slot.node = node
      slot.reapply()
      builtNodes.append(node.outputNode)
      current = node.outputNode
    }

    // Add before removing: letting `output` drop to zero inputs collapses
    // its render chain and it does not recover.
    output.addInput(current)
    if let previousTail, previousTail !== current {
      output.removeInput(previousTail)
    }
    currentTail = current

    // Only now are the replaced nodes safe to detach: they are out of the
    // live chain, and their stale connections to the source would otherwise
    // block the new one.
    if let avEngine = engine?.avEngine {
      for node in previousNodes where !builtNodes.contains(where: { $0 === node }) {
        avEngine.detach(node.avAudioNode)
      }
    }

  }

  // MARK: - Metering

  /**
   Start measuring output level.

   The tap sits on the chain's output mixer, so it reflects what is actually
   heard — effects included — rather than the dry source.
   */
  func startMetering() {
    guard amplitudeTap == nil else { return }
    let tap = AmplitudeTap(meter)
    // Keep the channels independent so a hard-panned source does not read as
    // half level on both sides of the meter.
    tap.stereoMode = .stereo
    tap.analysisMode = .rms
    tap.start()
    amplitudeTap = tap
  }

  func stopMetering() {
    amplitudeTap?.stop()
    amplitudeTap = nil
  }

  /// Current peak and RMS per channel, or nil when metering is off.
  var levels: (peakLeft: Float, peakRight: Float, rmsLeft: Float, rmsRight: Float)? {
    guard let tap = amplitudeTap else { return nil }
    let left = tap.leftAmplitude
    let right = tap.rightAmplitude
    // AmplitudeTap reports RMS; peak is approximated from it because a true
    // peak would need a second tap reading raw buffers.
    return (
      peakLeft: min(1, left * 1.414),
      peakRight: min(1, right * 1.414),
      rmsLeft: left,
      rmsRight: right
    )
  }

  var positionSec: Double {
    player?.currentTime ?? 0
  }

  var isPlaying: Bool {
    if let player { return player.isPlaying }
    return true
  }

  func teardown() {
    stopMetering()
    if let avEngine = engine?.avEngine {
      for node in builtNodes {
        avEngine.detach(node.avAudioNode)
      }
    }
    builtNodes.removeAll()
    player?.stop()
    generator?.stop()
    output.removeAllInputs()
    if let fileURL {
      FileImporter.discard(fileURL)
    }
  }
}
