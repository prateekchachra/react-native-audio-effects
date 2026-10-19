import Foundation

/**
 Objective-C facing facade over `AudioKitBackend`.

 Exists so the Swift audio code never has to import React. `AudioEffects.mm`
 adapts these completion handlers to React's promise blocks; everything below
 that line is plain Swift and can be exercised without a bridge.
 */
@objc(AudioEffectsImpl)
public final class AudioEffectsImpl: NSObject {
  private let backend = AudioKitBackend()

  /// Event sinks, wired up by the ObjC++ layer to the generated emitters.
  @objc public var onLevels: ((NSDictionary) -> Void)?
  @objc public var onProgress: ((NSDictionary) -> Void)?
  @objc public var onError: ((NSDictionary) -> Void)?

  @objc public override init() {
    super.init()

    backend.onLevels = { [weak self] id, peakL, peakR, rmsL, rmsR in
      self?.onLevels?([
        "sourceId": id,
        "peakLeft": peakL,
        "peakRight": peakR,
        "rmsLeft": rmsL,
        "rmsRight": rmsR,
      ])
    }

    backend.onProgress = { [weak self] id, position, duration, isPlaying in
      self?.onProgress?([
        "sourceId": id,
        "positionSec": position,
        "durationSec": duration,
        "isPlaying": isPlaying,
      ])
    }

    backend.onError = { [weak self] code, message, sourceId in
      self?.onError?([
        "code": code,
        "message": message,
        "sourceId": sourceId,
      ])
    }
  }

  // MARK: - Engine

  @objc public func configure(
    sampleRate: NSNumber?,
    bufferFrames: NSNumber?,
    category: String?,
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) {
      try self.backend.configure(
        sampleRate: sampleRate?.doubleValue,
        bufferFrames: bufferFrames?.doubleValue,
        category: category
      )
    }
  }

  @objc public func start(completion: @escaping (NSError?) -> Void) {
    run(completion) { try self.backend.start() }
  }

  @objc public func stop(completion: @escaping (NSError?) -> Void) {
    run(completion) { self.backend.stop() }
  }

  @objc public func teardown(completion: @escaping (NSError?) -> Void) {
    run(completion) { self.backend.teardown() }
  }

  // MARK: - Sources

  @objc public func loadFile(
    _ uri: String,
    completion: @escaping (Any?, NSError?) -> Void
  ) {
    runValue(completion) { try self.backend.loadFile(uri: uri) }
  }

  @objc public func createOscillator(
    _ waveform: String,
    frequency: NSNumber?,
    amplitude: NSNumber?,
    antialias: NSNumber?,
    completion: @escaping (Any?, NSError?) -> Void
  ) {
    runValue(completion) {
      // `antialias` is Android-only: AudioKit's oscillators are already
      // band-limited wavetables, so there is nothing to toggle here.
      try self.backend.createOscillator(
        waveform: waveform,
        frequency: frequency?.floatValue ?? 440,
        amplitude: amplitude?.floatValue ?? 0.5
      )
    }
  }

  @objc public func releaseSource(
    _ sourceId: Double,
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) { try self.backend.releaseSource(Int(sourceId)) }
  }

  @objc public func playSource(
    _ sourceId: Double,
    loop: Bool,
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) { try self.backend.play(Int(sourceId), loop: loop) }
  }

  @objc public func pauseSource(
    _ sourceId: Double,
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) { try self.backend.pause(Int(sourceId)) }
  }

  @objc public func stopSource(
    _ sourceId: Double,
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) { try self.backend.stopSource(Int(sourceId)) }
  }

  @objc public func seekSource(
    _ sourceId: Double,
    positionSec: Double,
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) {
      try self.backend.seek(Int(sourceId), positionSec: positionSec)
    }
  }

  @objc public func setSourceVolume(_ sourceId: Double, volume: Double) {
    backend.setSourceVolume(Int(sourceId), volume: Float(volume))
  }

  // MARK: - Effects

  @objc public func createEffect(
    _ sourceId: Double,
    type: String,
    completion: @escaping (Any?, NSError?) -> Void
  ) {
    runValue(completion) {
      try self.backend.createEffect(sourceId: Int(sourceId), type: type)
    }
  }

  @objc public func removeEffect(
    _ effectId: Double,
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) { try self.backend.removeEffect(Int(effectId)) }
  }

  @objc public func reorderChain(
    _ sourceId: Double,
    effectIds: [NSNumber],
    completion: @escaping (NSError?) -> Void
  ) {
    run(completion) {
      try self.backend.reorderChain(
        sourceId: Int(sourceId),
        effectIds: effectIds.map(\.intValue)
      )
    }
  }

  @objc public func setEffectEnabled(_ effectId: Double, enabled: Bool) {
    backend.setEffectEnabled(Int(effectId), enabled: enabled)
  }

  // MARK: - Parameters

  @objc public func setParameter(_ effectId: Double, key: String, value: Double) {
    backend.setParameter(Int(effectId), key: key, value: Float(value))
  }

  @objc public func setParameters(_ changes: [NSDictionary]) {
    let parsed: [(effectId: Int, key: String, value: Float)] = changes.compactMap {
      guard let effectId = ($0["effectId"] as? NSNumber)?.intValue,
        let key = $0["key"] as? String,
        let value = ($0["value"] as? NSNumber)?.floatValue
      else { return nil }
      return (effectId, key, value)
    }
    backend.setParameters(parsed)
  }

  @objc public func getParameter(_ effectId: Double, key: String) -> NSNumber {
    NSNumber(value: backend.getParameter(Int(effectId), key: key))
  }

  // MARK: - Capabilities and metering

  @objc public func capabilitiesJSON() -> String {
    guard
      let data = try? JSONSerialization.data(withJSONObject: backend.capabilities),
      let json = String(data: data, encoding: .utf8)
    else {
      return "{\"effects\":{},\"generators\":[]}"
    }
    return json
  }

  @objc public func setMeteringEnabled(_ enabled: Bool, intervalMs: Double) {
    backend.setMeteringEnabled(enabled, intervalMs: intervalMs)
  }

  // MARK: - Error plumbing

  private func run(
    _ completion: @escaping (NSError?) -> Void,
    _ work: @escaping () throws -> Void
  ) {
    do {
      try work()
      completion(nil)
    } catch let error as AudioEffectsError {
      completion(error.asNSError)
    } catch {
      completion(error as NSError)
    }
  }

  private func runValue(
    _ completion: @escaping (Any?, NSError?) -> Void,
    _ work: @escaping () throws -> Any
  ) {
    do {
      completion(try work(), nil)
    } catch let error as AudioEffectsError {
      completion(nil, error.asNSError)
    } catch {
      completion(nil, error as NSError)
    }
  }
}
