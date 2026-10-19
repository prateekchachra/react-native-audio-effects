import AudioKit
import Foundation
import SoundpipeAudioKit

/**
 Oscillators and noise sources.

 AudioKit ships band-limited wavetable oscillators, so unlike Android — where
 Klarinet has no generators and the samples are synthesised with PolyBLEP in
 the stream callback — there is nothing to hand-roll here. The `antialias`
 option is therefore accepted and ignored on iOS; the schema marks it
 Android-only.
 */
enum GeneratorFactory {
  static let waveforms = [
    "sine", "square", "sawtooth", "triangle",
    "whiteNoise", "pinkNoise", "brownNoise",
  ]

  static func isSupported(_ waveform: String) -> Bool {
    waveforms.contains(waveform)
  }

  static func make(waveform: String, frequency: Float, amplitude: Float) -> GeneratorNode? {
    switch waveform {
    case "sine":
      return OscillatorGenerator(.sine, frequency: frequency, amplitude: amplitude)
    case "square":
      return OscillatorGenerator(.square, frequency: frequency, amplitude: amplitude)
    case "sawtooth":
      return OscillatorGenerator(.sawtooth, frequency: frequency, amplitude: amplitude)
    case "triangle":
      return OscillatorGenerator(.triangle, frequency: frequency, amplitude: amplitude)
    case "whiteNoise":
      return WhiteNoiseGenerator(amplitude: amplitude)
    case "pinkNoise":
      return PinkNoiseGenerator(amplitude: amplitude)
    case "brownNoise":
      return BrownNoiseGenerator(amplitude: amplitude)
    default:
      return nil
    }
  }
}

/// A signal source that can be started and stopped.
protocol GeneratorNode: AnyObject {
  var node: Node { get }
  func play()
  func stop()
  func setFrequency(_ hz: Float)
  func setAmplitude(_ amplitude: Float)
}

final class OscillatorGenerator: GeneratorNode {
  private let oscillator: Oscillator
  var node: Node { oscillator }

  init(_ shape: TableType, frequency: Float, amplitude: Float) {
    oscillator = Oscillator(
      waveform: Table(shape),
      frequency: frequency,
      amplitude: amplitude
    )
  }

  func play() { oscillator.start() }
  func stop() { oscillator.stop() }
  func setFrequency(_ hz: Float) {
    oscillator.frequency = Convert.clamp(hz, 0, 20000)
  }
  func setAmplitude(_ amplitude: Float) {
    oscillator.amplitude = Convert.clamp(amplitude, 0, 1)
  }
}

final class WhiteNoiseGenerator: GeneratorNode {
  private let noise: WhiteNoise
  var node: Node { noise }

  init(amplitude: Float) {
    noise = WhiteNoise(amplitude: amplitude)
  }

  func play() { noise.start() }
  func stop() { noise.stop() }
  /// Noise has no fundamental; frequency is accepted and ignored.
  func setFrequency(_ hz: Float) {}
  func setAmplitude(_ amplitude: Float) {
    noise.amplitude = Convert.clamp(amplitude, 0, 1)
  }
}

final class PinkNoiseGenerator: GeneratorNode {
  private let noise: PinkNoise
  var node: Node { noise }

  init(amplitude: Float) {
    noise = PinkNoise(amplitude: amplitude)
  }

  func play() { noise.start() }
  func stop() { noise.stop() }
  func setFrequency(_ hz: Float) {}
  func setAmplitude(_ amplitude: Float) {
    noise.amplitude = Convert.clamp(amplitude, 0, 1)
  }
}

final class BrownNoiseGenerator: GeneratorNode {
  private let noise: BrownianNoise
  var node: Node { noise }

  init(amplitude: Float) {
    noise = BrownianNoise(amplitude: amplitude)
  }

  func play() { noise.start() }
  func stop() { noise.stop() }
  func setFrequency(_ hz: Float) {}
  func setAmplitude(_ amplitude: Float) {
    noise.amplitude = Convert.clamp(amplitude, 0, 1)
  }
}
