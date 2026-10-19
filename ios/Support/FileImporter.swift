import AVFoundation
import Foundation

/**
 Turns whatever URI JavaScript hands over into a local file the engine can
 open.

 v1 of this library passed a JS-relative path (`./src/assets/...`) straight to
 `AVAudioFile`, which can never resolve on device. Everything is normalised to
 a real file here before the engine sees it.

 Picked documents arrive as security-scoped URLs that are only readable inside
 a `startAccessingSecurityScopedResource()` window and may disappear afterwards,
 so imported files are copied into the cache directory and played from there.
 */
enum FileImporter {
  private static let cacheDirectoryName = "RNAudioEffects"

  /// Peak buckets computed for the waveform view. Enough for a wide display
  /// without sending a large array across the bridge.
  static let peakBucketCount = 1000

  struct ImportedFile {
    let url: URL
    let file: AVAudioFile
    let durationSec: Double
    let sampleRate: Double
    let channelCount: Int
    /// Interleaved min/max pairs in -1..1, `peakBucketCount` pairs long.
    let peaks: [Float]
  }

  static func cacheDirectory() throws -> URL {
    let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let directory = base.appendingPathComponent(cacheDirectoryName, isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true
    )
    return directory
  }

  /// Resolve a `file://`, `/absolute`, or bundle-relative URI to a URL.
  private static func resolve(_ uri: String) -> URL? {
    if uri.hasPrefix("file://"), let url = URL(string: uri) {
      return url
    }
    if uri.hasPrefix("/") {
      return URL(fileURLWithPath: uri)
    }
    if let url = URL(string: uri), url.scheme != nil {
      return url
    }
    // Last resort: a resource inside the app bundle.
    let name = (uri as NSString).deletingPathExtension
    let ext = (uri as NSString).pathExtension
    return Bundle.main.url(forResource: name, withExtension: ext.isEmpty ? nil : ext)
  }

  static func `import`(uri: String) throws -> ImportedFile {
    guard let source = resolve(uri) else {
      throw AudioEffectsError.fileNotFound(uri)
    }

    // Document-picker URLs need an explicit access window, and the call
    // returns false for URLs that were never security-scoped — which is fine,
    // so the result is only used to decide whether to balance it.
    let scoped = source.startAccessingSecurityScopedResource()
    defer {
      if scoped { source.stopAccessingSecurityScopedResource() }
    }

    let destination = try cacheDirectory()
      .appendingPathComponent(UUID().uuidString + "-" + source.lastPathComponent)

    do {
      try FileManager.default.copyItem(at: source, to: destination)
    } catch {
      throw AudioEffectsError.fileNotFound(uri)
    }

    let file: AVAudioFile
    do {
      // AVFoundation decodes wav, aiff, caf, mp3, m4a and aac, so there is no
      // separate transcode step on iOS the way there is on Android.
      file = try AVAudioFile(forReading: destination)
    } catch {
      try? FileManager.default.removeItem(at: destination)
      throw AudioEffectsError.decodeFailed(uri, underlying: error)
    }

    let format = file.processingFormat
    let frames = file.length
    let duration = format.sampleRate > 0 ? Double(frames) / format.sampleRate : 0

    return ImportedFile(
      url: destination,
      file: file,
      durationSec: duration,
      sampleRate: format.sampleRate,
      channelCount: Int(format.channelCount),
      peaks: computePeaks(file: file)
    )
  }

  /**
   Downsample the file to min/max pairs for drawing.

   Done once at load rather than streamed: a waveform never changes, and
   pushing it across the bridge repeatedly would be pure waste. Reads in
   chunks so a long file does not need to be resident in memory.
   */
  private static func computePeaks(file: AVAudioFile) -> [Float] {
    let totalFrames = file.length
    guard totalFrames > 0 else {
      return Array(repeating: 0, count: peakBucketCount * 2)
    }

    let format = file.processingFormat
    let framesPerBucket = max(1, Int(totalFrames) / peakBucketCount)
    var peaks: [Float] = []
    peaks.reserveCapacity(peakBucketCount * 2)

    let originalPosition = file.framePosition
    file.framePosition = 0
    defer { file.framePosition = originalPosition }

    guard
      let buffer = AVAudioPCMBuffer(
        pcmFormat: format, frameCapacity: AVAudioFrameCount(framesPerBucket)
      )
    else {
      return Array(repeating: 0, count: peakBucketCount * 2)
    }

    for _ in 0..<peakBucketCount {
      buffer.frameLength = 0
      do {
        try file.read(into: buffer, frameCount: AVAudioFrameCount(framesPerBucket))
      } catch {
        break
      }
      guard buffer.frameLength > 0, let channels = buffer.floatChannelData else {
        break
      }

      var minimum: Float = 0
      var maximum: Float = 0
      for channel in 0..<Int(format.channelCount) {
        let samples = channels[channel]
        for frame in 0..<Int(buffer.frameLength) {
          let sample = samples[frame]
          if sample < minimum { minimum = sample }
          if sample > maximum { maximum = sample }
        }
      }
      peaks.append(minimum)
      peaks.append(maximum)
    }

    // Pad short reads so the array length is always predictable in JS.
    while peaks.count < peakBucketCount * 2 {
      peaks.append(0)
    }
    return peaks
  }

  /// Remove a file this importer copied into the cache.
  static func discard(_ url: URL) {
    guard url.path.contains(cacheDirectoryName) else { return }
    try? FileManager.default.removeItem(at: url)
  }
}
