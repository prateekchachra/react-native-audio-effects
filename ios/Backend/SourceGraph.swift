import AudioKit
import AudioKitEX
import AVFoundation
import Foundation

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

  /// Player for file sources; nil for generators.
  let player: AudioPlayer?
  /// Generator for oscillator sources; nil for files.
  let generator: GeneratorNode?
  /// Cached copy of an imported file, removed when the source is released.
  let fileURL: URL?
  let durationSec: Double

  /// Stable node the root mixer listens to, so the chain can be rebuilt
  /// underneath without touching the engine's output wiring.
  let output = Mixer()

  private(set) var slots: [EffectSlot] = []
  private var amplitudeTap: AmplitudeTap?

  var head: Node {
    if let player { return player }
    if let generator { return generator.node }
    fatalError("A source must have either a player or a generator")
  }

  init(id: Int, player: AudioPlayer, fileURL: URL, durationSec: Double) {
    self.id = id
    self.player = player
    self.generator = nil
    self.fileURL = fileURL
    self.durationSec = durationSec
    rebuild()
  }

  init(id: Int, generator: GeneratorNode) {
    self.id = id
    self.player = nil
    self.generator = generator
    self.fileURL = nil
    self.durationSec = 0
    rebuild()
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
    // A tap attached to `output` does not survive its inputs being swapped —
    // the graph keeps rendering silence afterwards. Detach around the rebuild
    // and restore it, so enabling metering before building a chain behaves
    // the same as enabling it after.
    let wasMetering = amplitudeTap != nil
    if wasMetering {
      stopMetering()
    }

    var current: Node = head
    for slot in slots {
      guard let node = EffectFactory.make(type: slot.type, input: current) else {
        continue
      }
      slot.node = node
      slot.reapply()
      current = node.outputNode
    }

    output.removeAllInputs()
    output.addInput(current)

    if wasMetering {
      startMetering()
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
    let tap = AmplitudeTap(output)
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
    player?.stop()
    generator?.stop()
    output.removeAllInputs()
    if let fileURL {
      FileImporter.discard(fileURL)
    }
  }
}
