package com.audioeffects.effects

import com.vectencia.klarinet.AudioEffectType
import com.vectencia.klarinet.BPFParams
import com.vectencia.klarinet.ChorusParams
import com.vectencia.klarinet.CompressorParams
import com.vectencia.klarinet.DelayParams
import com.vectencia.klarinet.EQParams
import com.vectencia.klarinet.FlangerParams
import com.vectencia.klarinet.GainParams
import com.vectencia.klarinet.HPFParams
import com.vectencia.klarinet.LPFParams
import com.vectencia.klarinet.LimiterParams
import com.vectencia.klarinet.NoiseGateParams
import com.vectencia.klarinet.PanParams
import com.vectencia.klarinet.PhaserParams
import com.vectencia.klarinet.ReverbParams
import com.vectencia.klarinet.TremoloParams

/**
 * Translates the schema's parameter keys and units into Klarinet's integer
 * parameter ids.
 *
 * This is the Android half of the capability contract. Whatever is listed in
 * [EffectRegistry] is what `getCapabilities()` reports, and the parity test in
 * `src/__tests__/capabilities.test.ts` fails if it stops agreeing with
 * `src/schema/effects.ts`.
 *
 * Unit conversion lives here and nowhere else — JavaScript always speaks the
 * schema's units, and each backend converts on its own side. The number of
 * conversions is small because the schema deliberately adopted Klarinet's
 * units (milliseconds for delay time, for example) wherever the two backends
 * disagreed, pushing the arithmetic onto iOS instead.
 */
internal interface ParamMapping {
  /** Klarinet parameter id for a schema key, or null if unmapped. */
  fun id(key: String): Int?

  /** Convert a schema-unit value into what Klarinet expects. */
  fun convert(key: String, value: Float): Float = value

  /** Schema keys this effect implements, for the capability report. */
  val keys: List<String>
}

/** A mapping that needs no unit conversion at all. */
private class DirectMapping(private val table: Map<String, Int>) : ParamMapping {
  override fun id(key: String) = table[key]
  override val keys: List<String> get() = table.keys.toList()
}

private object GainMapping : ParamMapping {
  private val table = mapOf("level" to GainParams.GAIN_DB, "fade" to GainParams.FADE_MS)
  override fun id(key: String) = table[key]
  override val keys get() = table.keys.toList()
}

private object DelayMapping : ParamMapping {
  private val table = mapOf(
    "time" to DelayParams.TIME_MS,
    "feedback" to DelayParams.FEEDBACK,
    "mix" to DelayParams.WET_DRY_MIX,
  )
  override fun id(key: String) = table[key]
  override val keys get() = table.keys.toList()
}

private object ReverbMapping : ParamMapping {
  private val table = mapOf(
    "roomSize" to ReverbParams.ROOM_SIZE,
    "damping" to ReverbParams.DAMPING,
    "mix" to ReverbParams.WET_DRY_MIX,
    "width" to ReverbParams.WIDTH,
  )
  override fun id(key: String) = table[key]
  override val keys get() = table.keys.toList()
}

private object CompressorMapping : ParamMapping {
  private val table = mapOf(
    "threshold" to CompressorParams.THRESHOLD,
    "ratio" to CompressorParams.RATIO,
    "attack" to CompressorParams.ATTACK_MS,
    "release" to CompressorParams.RELEASE_MS,
    "makeupGain" to CompressorParams.MAKEUP_GAIN,
  )
  override fun id(key: String) = table[key]
  override val keys get() = table.keys.toList()
}

private object PhaserMapping : ParamMapping {
  private val table = mapOf(
    "rate" to PhaserParams.RATE_HZ,
    "depth" to PhaserParams.DEPTH,
    "feedback" to PhaserParams.FEEDBACK,
    "stages" to PhaserParams.STAGES,
  )
  override fun id(key: String) = table[key]
  override val keys get() = table.keys.toList()
}

/**
 * Parametric EQ.
 *
 * Keys are flat (`band2Gain`); Klarinet addresses the same value as
 * `bandIndex * PARAMS_PER_BAND + offset`, so the index is parsed out of the
 * key. Band count must match `EQ_BAND_COUNT` in the schema and `eqBandCount`
 * in the Swift.
 */
private object ParametricEqMapping : ParamMapping {
  const val BAND_COUNT = 4

  private val offsets = mapOf(
    "Frequency" to EQParams.BAND_FREQUENCY,
    "Gain" to EQParams.BAND_GAIN,
    "Q" to EQParams.BAND_Q,
  )

  override fun id(key: String): Int? {
    val (band, field) = parse(key) ?: return null
    if (band >= BAND_COUNT) return null
    val offset = offsets[field] ?: return null
    return band * EQParams.PARAMS_PER_BAND + offset
  }

  /** Splits `band2Gain` into `2 to "Gain"`. */
  private fun parse(key: String): Pair<Int, String>? {
    if (!key.startsWith("band")) return null
    val rest = key.removePrefix("band")
    val digits = rest.takeWhile { it.isDigit() }
    if (digits.isEmpty()) return null
    return digits.toInt() to rest.drop(digits.length)
  }

  override val keys: List<String>
    get() = (0 until BAND_COUNT).flatMap { band ->
      offsets.keys.map { field -> "band$band$field" }
    }
}

/**
 * Every effect Android implements, with its mapping.
 *
 * Distortion and bitCrusher are absent: Klarinet 0.5 has no equivalent, and
 * the schema marks them iOS-only. Creating one rejects with
 * `EFFECT_UNAVAILABLE` rather than returning a handle that does nothing.
 */
internal object EffectRegistry {
  private val mappings: Map<String, Pair<AudioEffectType, ParamMapping>> = mapOf(
    "gain" to (AudioEffectType.GAIN to GainMapping),
    "pan" to (AudioEffectType.PAN to DirectMapping(mapOf("pan" to PanParams.PAN))),
    "delay" to (AudioEffectType.DELAY to DelayMapping),
    "reverb" to (AudioEffectType.REVERB to ReverbMapping),
    "chorus" to (
      AudioEffectType.CHORUS to DirectMapping(
        mapOf(
          "rate" to ChorusParams.RATE_HZ,
          "depth" to ChorusParams.DEPTH,
          "mix" to ChorusParams.WET_DRY_MIX,
        )
      )
      ),
    "flanger" to (
      AudioEffectType.FLANGER to DirectMapping(
        mapOf(
          "rate" to FlangerParams.RATE_HZ,
          "depth" to FlangerParams.DEPTH,
          "feedback" to FlangerParams.FEEDBACK,
          "mix" to FlangerParams.WET_DRY_MIX,
        )
      )
      ),
    "phaser" to (AudioEffectType.PHASER to PhaserMapping),
    "tremolo" to (
      AudioEffectType.TREMOLO to DirectMapping(
        mapOf("rate" to TremoloParams.RATE_HZ, "depth" to TremoloParams.DEPTH)
      )
      ),
    "compressor" to (AudioEffectType.COMPRESSOR to CompressorMapping),
    "limiter" to (
      AudioEffectType.LIMITER to DirectMapping(
        mapOf(
          "threshold" to LimiterParams.THRESHOLD,
          "release" to LimiterParams.RELEASE_MS,
        )
      )
      ),
    "noiseGate" to (
      AudioEffectType.NOISE_GATE to DirectMapping(
        mapOf(
          "threshold" to NoiseGateParams.THRESHOLD,
          "attack" to NoiseGateParams.ATTACK_MS,
          "release" to NoiseGateParams.RELEASE_MS,
          "hold" to NoiseGateParams.HOLD_MS,
        )
      )
      ),
    "parametricEq" to (AudioEffectType.PARAMETRIC_EQ to ParametricEqMapping),
    "lowPassFilter" to (
      AudioEffectType.LOW_PASS_FILTER to DirectMapping(
        mapOf("cutoff" to LPFParams.CUTOFF_HZ, "resonance" to LPFParams.RESONANCE)
      )
      ),
    "highPassFilter" to (
      AudioEffectType.HIGH_PASS_FILTER to DirectMapping(
        mapOf("cutoff" to HPFParams.CUTOFF_HZ, "resonance" to HPFParams.RESONANCE)
      )
      ),
    "bandPassFilter" to (
      AudioEffectType.BAND_PASS_FILTER to DirectMapping(
        mapOf("center" to BPFParams.CENTER_HZ, "bandwidth" to BPFParams.BANDWIDTH)
      )
      ),
  )

  fun isSupported(type: String): Boolean = mappings.containsKey(type)

  fun klarinetType(type: String): AudioEffectType? = mappings[type]?.first

  fun mapping(type: String): ParamMapping? = mappings[type]?.second

  /** `{ effectType: [parameterKey, ...] }` for `getCapabilitiesJSON()`. */
  fun capabilities(): Map<String, List<String>> =
    mappings.mapValues { (_, value) -> value.second.keys }
}
