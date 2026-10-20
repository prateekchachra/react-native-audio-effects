package com.audioeffects.io

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import com.audioeffects.backend.AudioEffectsException
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Turns whatever URI JavaScript hands over into a local file the engine can
 * open.
 *
 * Two problems to solve on Android that iOS does not have:
 *
 * 1. A document picker returns a `content://` URI, not a path. It is backed
 *    by another app's content provider, the grant can expire, and Klarinet's
 *    reader wants a real file — so the content is copied into the cache.
 *
 * 2. Klarinet decodes WAV everywhere but relies on the platform for
 *    compressed formats. Anything it cannot read is transcoded to WAV with
 *    `MediaExtractor` + `MediaCodec` first, so an MP3 behaves the same as it
 *    does on iOS.
 */
internal class FileImporter(private val context: Context) {

  companion object {
    private const val CACHE_DIR = "rn-audio-effects"

    /** Formats Klarinet's own reader handles without a transcode. */
    private val NATIVE_FORMATS = setOf("wav", "wave")

    /** Handled by rewriting the container rather than by the platform codec. */
    private val AIFF_FORMATS = setOf("aif", "aiff", "aifc")

    /** Buckets in the waveform peak array, matching the iOS importer. */
    const val PEAK_BUCKET_COUNT = 1000

    /** How long to wait on a remote sample before giving up. */
    private const val DOWNLOAD_TIMEOUT_MS = 60_000
  }

  data class ImportedFile(
    val path: String,
    val durationSec: Double,
    val sampleRate: Int,
    val channelCount: Int,
    val peaks: FloatArray,
  ) {
    override fun equals(other: Any?) =
      this === other || (other is ImportedFile && path == other.path)

    override fun hashCode() = path.hashCode()
  }

  private fun cacheDir(): File =
    File(context.cacheDir, CACHE_DIR).apply { mkdirs() }

  /** Copy whatever the URI points at into our cache, returning the file. */
  /**
   * Open a stream to a remote file.
   *
   * Blocking, like the rest of the importer: this runs on the module's
   * worker thread and the caller is already awaiting a promise.
   */
  private fun openRemote(uri: String): java.io.InputStream {
    val connection = (java.net.URL(uri).openConnection() as java.net.HttpURLConnection)
      .apply {
        connectTimeout = DOWNLOAD_TIMEOUT_MS
        readTimeout = DOWNLOAD_TIMEOUT_MS
        // Redirects are the norm for CDN-hosted audio.
        instanceFollowRedirects = true
      }
    val status = try {
      connection.responseCode
    } catch (error: Exception) {
      connection.disconnect()
      throw AudioEffectsException.DownloadFailed(uri, "unreachable", error)
    }
    if (status !in 200..299) {
      connection.disconnect()
      throw AudioEffectsException.DownloadFailed(uri, "HTTP $status")
    }
    return connection.inputStream
  }

  private fun copyToCache(uri: String): File {
    val parsed = Uri.parse(uri)
    val name = parsed.lastPathSegment?.substringAfterLast('/') ?: "audio"
    val destination = File(cacheDir(), "${System.nanoTime()}-$name")

    val stream = when {
      // Remote samples. Fetched here rather than in JavaScript because the
      // importer already owns the cache, and React Native has no file
      // system to download into without an extra dependency.
      parsed.scheme == "http" || parsed.scheme == "https" -> openRemote(uri)
      parsed.scheme == "content" -> context.contentResolver.openInputStream(parsed)
      parsed.scheme == "file" -> File(parsed.path ?: uri).inputStream()
      // A bare relative path is a bundled asset. This is the Android
      // counterpart of resolving against the main bundle on iOS, so the same
      // `"Samples/beat.aiff"` works on both platforms.
      parsed.scheme == null && !uri.startsWith("/") ->
        runCatching { context.assets.open(uri) }.getOrNull()
      parsed.scheme == null -> File(uri).inputStream()
      else -> context.contentResolver.openInputStream(parsed)
    } ?: throw AudioEffectsException.FileNotFound(uri)

    stream.use { input ->
      FileOutputStream(destination).use { output -> input.copyTo(output) }
    }
    return destination
  }

  fun import(uri: String): ImportedFile {
    val cached = try {
      copyToCache(uri)
    } catch (error: AudioEffectsException) {
      throw error
    } catch (error: Exception) {
      throw AudioEffectsException.FileNotFound(uri)
    }

    val extension = cached.extension.lowercase()
    val playable = when {
      extension in NATIVE_FORMATS -> cached
      // MediaExtractor has no AIFF support, but AIFF is uncompressed PCM in
      // a chunked container, so it is cheaper to rewrite the header than to
      // tell the caller the file is unplayable.
      extension in AIFF_FORMATS -> convertAiffToWav(cached, uri)
      else -> transcodeToWav(cached, uri)
    }

    val info = readWavInfo(playable, uri)
    return ImportedFile(
      path = playable.absolutePath,
      durationSec = info.durationSec,
      sampleRate = info.sampleRate,
      channelCount = info.channelCount,
      peaks = info.peaks,
    )
  }

  // ------------------------------------------------------------- transcode

  /**
   * Decode a compressed file to 16-bit PCM WAV in the cache.
   *
   * Synchronous and blocking: this runs on the module's worker thread, never
   * on the audio thread, and the caller is already awaiting a promise.
   */
  private fun transcodeToWav(source: File, originalUri: String): File {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    val destination = File(cacheDir(), "${source.nameWithoutExtension}.wav")

    try {
      extractor.setDataSource(source.absolutePath)
      val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
        extractor.getTrackFormat(index)
          .getString(MediaFormat.KEY_MIME)
          ?.startsWith("audio/") == true
      } ?: throw AudioEffectsException.DecodeFailed(originalUri)

      extractor.selectTrack(trackIndex)
      val format = extractor.getTrackFormat(trackIndex)
      val mime = format.getString(MediaFormat.KEY_MIME)!!
      val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      val channelCount = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

      codec = MediaCodec.createDecoderByType(mime).apply {
        configure(format, null, null, 0)
        start()
      }

      val pcm = java.io.ByteArrayOutputStream()
      val bufferInfo = MediaCodec.BufferInfo()
      var sawInputEnd = false
      var sawOutputEnd = false

      while (!sawOutputEnd) {
        if (!sawInputEnd) {
          val inputIndex = codec.dequeueInputBuffer(10_000)
          if (inputIndex >= 0) {
            val inputBuffer = codec.getInputBuffer(inputIndex)!!
            val size = extractor.readSampleData(inputBuffer, 0)
            if (size < 0) {
              codec.queueInputBuffer(
                inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM
              )
              sawInputEnd = true
            } else {
              codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        val outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000)
        if (outputIndex >= 0) {
          val outputBuffer = codec.getOutputBuffer(outputIndex)!!
          val chunk = ByteArray(bufferInfo.size)
          outputBuffer.get(chunk)
          outputBuffer.clear()
          pcm.write(chunk)
          codec.releaseOutputBuffer(outputIndex, false)
          if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            sawOutputEnd = true
          }
        }
      }

      writeWav(destination, pcm.toByteArray(), sampleRate, channelCount)
      return destination
    } catch (error: AudioEffectsException) {
      throw error
    } catch (error: Exception) {
      throw AudioEffectsException.DecodeFailed(originalUri, error)
    } finally {
      runCatching { codec?.stop() }
      runCatching { codec?.release() }
      runCatching { extractor.release() }
    }
  }

  /**
   * Rewrite an AIFF as a WAV.
   *
   * Both are uncompressed PCM in a chunked container; they differ in chunk
   * names, in the layout of the format chunk, and in byte order — AIFF is
   * big-endian. So this reads the COMM chunk for the format, reads SSND for
   * the samples, swaps each frame, and writes a WAV header in front.
   *
   * Only linear PCM is handled. Compressed AIFC variants fall through to the
   * platform decoder, which will reject them with a clear error.
   */
  private fun convertAiffToWav(source: File, originalUri: String): File {
    try {
      val bytes = source.readBytes()
      val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)

      if (bytes.size < 12 || String(bytes, 0, 4) != "FORM") {
        throw AudioEffectsException.DecodeFailed(originalUri)
      }

      var channelCount = 0
      var sampleRate = 0
      var bitsPerSample = 0
      var dataOffset = -1
      var dataSize = 0

      // Walk the chunk list; COMM and SSND can appear in either order.
      var offset = 12
      while (offset + 8 <= bytes.size) {
        val id = String(bytes, offset, 4)
        val size = buffer.getInt(offset + 4)
        val body = offset + 8

        when (id) {
          "COMM" -> {
            channelCount = buffer.getShort(body).toInt()
            bitsPerSample = buffer.getShort(body + 6).toInt()
            // The rate is an 80-bit IEEE 754 extended float.
            sampleRate = readExtendedFloat(bytes, body + 8)
          }
          "SSND" -> {
            // Skip the offset and blockSize fields that precede the samples.
            val ssndOffset = buffer.getInt(body)
            dataOffset = body + 8 + ssndOffset
            dataSize = size - 8 - ssndOffset
          }
        }

        offset = body + size + (size % 2)
      }

      if (dataOffset < 0 || channelCount <= 0 || sampleRate <= 0) {
        throw AudioEffectsException.DecodeFailed(originalUri)
      }
      if (bitsPerSample != 16) {
        // Anything other than 16-bit would need resampling the sample words
        // too; let the platform decoder try instead of guessing.
        return transcodeToWav(source, originalUri)
      }

      dataSize = dataSize.coerceAtMost(bytes.size - dataOffset)
      val pcm = ByteArray(dataSize)
      // AIFF samples are big-endian; WAV wants little-endian.
      var index = 0
      while (index + 1 < dataSize) {
        pcm[index] = bytes[dataOffset + index + 1]
        pcm[index + 1] = bytes[dataOffset + index]
        index += 2
      }

      val destination = File(cacheDir(), "${source.nameWithoutExtension}.wav")
      writeWav(destination, pcm, sampleRate, channelCount)
      return destination
    } catch (error: AudioEffectsException) {
      throw error
    } catch (error: Exception) {
      throw AudioEffectsException.DecodeFailed(originalUri, error)
    }
  }

  /**
   * Read an 80-bit IEEE 754 extended float, which is how AIFF stores its
   * sample rate. Only the integer range matters here, so the mantissa is
   * shifted by the exponent rather than reconstructed exactly.
   */
  private fun readExtendedFloat(bytes: ByteArray, offset: Int): Int {
    val exponent =
      (((bytes[offset].toInt() and 0x7F) shl 8) or
        (bytes[offset + 1].toInt() and 0xFF)) - 16383
    var mantissa = 0L
    for (i in 0 until 8) {
      mantissa = (mantissa shl 8) or (bytes[offset + 2 + i].toLong() and 0xFF)
    }
    // The leading bit is explicit in this format, so the mantissa spans 63
    // bits below it.
    val shift = 63 - exponent
    if (shift !in 0..63) {
      return 0
    }
    return (mantissa ushr shift).toInt()
  }

  /** Prepend a 44-byte canonical WAV header to raw 16-bit PCM. */
  private fun writeWav(
    destination: File,
    pcm: ByteArray,
    sampleRate: Int,
    channelCount: Int,
  ) {
    val bitsPerSample = 16
    val byteRate = sampleRate * channelCount * bitsPerSample / 8
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray())
    header.putInt(36 + pcm.size)
    header.put("WAVE".toByteArray())
    header.put("fmt ".toByteArray())
    header.putInt(16)
    header.putShort(1) // PCM
    header.putShort(channelCount.toShort())
    header.putInt(sampleRate)
    header.putInt(byteRate)
    header.putShort((channelCount * bitsPerSample / 8).toShort())
    header.putShort(bitsPerSample.toShort())
    header.put("data".toByteArray())
    header.putInt(pcm.size)

    FileOutputStream(destination).use { out ->
      out.write(header.array())
      out.write(pcm)
    }
  }

  // ------------------------------------------------------------- analysis

  private data class WavInfo(
    val durationSec: Double,
    val sampleRate: Int,
    val channelCount: Int,
    val peaks: FloatArray,
  )

  /**
   * Read a WAV header and downsample the samples to min/max peak pairs.
   *
   * Done once at import, like the iOS side: a waveform never changes, so
   * streaming it would be pure bridge traffic.
   */
  private fun readWavInfo(file: File, originalUri: String): WavInfo {
    try {
      val bytes = file.readBytes()
      if (bytes.size < 44) throw AudioEffectsException.DecodeFailed(originalUri)

      val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      val channelCount = buffer.getShort(22).toInt().coerceAtLeast(1)
      val sampleRate = buffer.getInt(24)
      val bitsPerSample = buffer.getShort(34).toInt().coerceAtLeast(8)

      // Walk the chunk list rather than assuming data starts at byte 44 —
      // encoders often insert LIST or fact chunks first.
      var offset = 12
      var dataOffset = 44
      var dataSize = bytes.size - 44
      while (offset + 8 <= bytes.size) {
        val id = String(bytes, offset, 4)
        val size = buffer.getInt(offset + 4)
        if (id == "data") {
          dataOffset = offset + 8
          dataSize = size.coerceAtMost(bytes.size - dataOffset)
          break
        }
        offset += 8 + size + (size % 2)
      }

      val bytesPerSample = bitsPerSample / 8
      val totalSamples = dataSize / bytesPerSample
      val totalFrames = totalSamples / channelCount
      val durationSec =
        if (sampleRate > 0) totalFrames.toDouble() / sampleRate else 0.0

      val peaks = FloatArray(PEAK_BUCKET_COUNT * 2)
      if (totalFrames > 0 && bitsPerSample == 16) {
        val framesPerBucket = (totalFrames / PEAK_BUCKET_COUNT).coerceAtLeast(1)
        for (bucket in 0 until PEAK_BUCKET_COUNT) {
          var minimum = 0f
          var maximum = 0f
          val startFrame = bucket.toLong() * framesPerBucket
          for (frame in 0 until framesPerBucket) {
            val sampleIndex = (startFrame + frame) * channelCount
            val byteIndex = dataOffset + sampleIndex * bytesPerSample
            if (byteIndex + 1 >= bytes.size) break
            val sample = buffer.getShort(byteIndex.toInt()) / 32768f
            if (sample < minimum) minimum = sample
            if (sample > maximum) maximum = sample
          }
          peaks[bucket * 2] = minimum
          peaks[bucket * 2 + 1] = maximum
        }
      }

      return WavInfo(durationSec, sampleRate, channelCount, peaks)
    } catch (error: AudioEffectsException) {
      throw error
    } catch (error: Exception) {
      throw AudioEffectsException.DecodeFailed(originalUri, error)
    }
  }

  /** Remove a file this importer wrote. */
  fun discard(path: String) {
    val file = File(path)
    if (file.absolutePath.contains(CACHE_DIR)) {
      runCatching { file.delete() }
    }
  }
}
