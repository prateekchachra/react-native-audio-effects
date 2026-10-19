/**
 * Oscillators and noise sources, with a live effect chain on top.
 *
 * Needs no audio file, so this is also the quickest end-to-end check that the
 * engine, the effect chain and metering are all working.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AudioEngine,
  GENERATORS,
  SINE,
  getGenerator,
  type Effect,
  type EffectType,
  type Source,
  type Waveform,
} from 'react-native-audio-effects';
import {
  EffectRack,
  Knob,
  LevelMeter,
  darkTheme,
} from 'react-native-audio-effects/ui';

import { useLiveLevels } from '../useLive';

/** Effects worth reaching for on a raw oscillator. */
const QUICK_EFFECTS: EffectType[] = [
  'lowPassFilter',
  'delay',
  'reverb',
  'tremolo',
  'distortion',
];

const FREQUENCY_PARAM = SINE.params[0]!;
const AMPLITUDE_PARAM = SINE.params[1]!;

export function GeneratorsScreen() {
  const [waveform, setWaveform] = useState<Waveform>('sine');
  const [source, setSource] = useState<Source>();
  const [effects, setEffects] = useState<Effect[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [frequency, setFrequency] = useState(220);
  const [amplitude, setAmplitude] = useState(0.3);

  const levels = useLiveLevels(source);
  const descriptor = getGenerator(waveform);
  const isPitched = descriptor?.pitched ?? false;

  // Switching waveform replaces the native source, so the old one is released
  // and the chain starts over.
  useEffect(() => {
    let cancelled = false;
    let created: Source | undefined;

    (async () => {
      created = await AudioEngine.createOscillator(waveform, {
        frequency,
        amplitude,
      });
      if (cancelled) {
        await created.release();
        return;
      }
      setSource(created);
      setEffects([]);
      setIsPlaying(false);
    })();

    return () => {
      cancelled = true;
      created?.release().catch(() => {});
      setSource(undefined);
    };
    // Frequency and amplitude are applied live below, not by recreating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveform]);

  const toggle = useCallback(async () => {
    if (!source) {
      return;
    }
    if (isPlaying) {
      await source.stop();
      setIsPlaying(false);
    } else {
      await source.play({ loop: true });
      setIsPlaying(true);
    }
  }, [source, isPlaying]);

  const addEffect = useCallback(
    async (type: EffectType) => {
      if (!source) {
        return;
      }
      try {
        const effect = await source.addEffect(type);
        setEffects((previous) => [...previous, effect]);
      } catch {
        // Unavailable on this platform; the chip is disabled anyway.
      }
    },
    [source]
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Generators</Text>

      <View style={styles.chips}>
        {GENERATORS.map((generator) => (
          <Pressable
            key={generator.waveform}
            onPress={() => setWaveform(generator.waveform)}
            style={[
              styles.chip,
              waveform === generator.waveform && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                waveform === generator.waveform && styles.chipTextActive,
              ]}
            >
              {generator.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {descriptor?.description ? (
        <Text style={styles.description}>{descriptor.description}</Text>
      ) : null}

      <View style={styles.controls}>
        {isPitched ? (
          <Knob
            param={FREQUENCY_PARAM}
            value={frequency}
            onChange={(value) => {
              setFrequency(value);
              source?.setOscillatorParam('frequency', value);
            }}
            size={72}
          />
        ) : null}
        <Knob
          param={AMPLITUDE_PARAM}
          value={amplitude}
          onChange={(value) => {
            setAmplitude(value);
            source?.setOscillatorParam('amplitude', value);
          }}
          size={72}
          label="Level"
        />
        <View style={styles.meters}>
          <LevelMeter peak={levels.peakLeft} rms={levels.rmsLeft} length={72} />
          <LevelMeter
            peak={levels.peakRight}
            rms={levels.rmsRight}
            length={72}
          />
        </View>
      </View>

      <Pressable
        onPress={toggle}
        style={({ pressed }) => [
          styles.button,
          isPlaying && styles.buttonActive,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>{isPlaying ? 'Stop' : 'Play'}</Text>
      </Pressable>

      <Text style={styles.subheading}>Add an effect</Text>
      <View style={styles.chips}>
        {QUICK_EFFECTS.map((type) => (
          <Pressable
            key={type}
            onPress={() => addEffect(type)}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{type}</Text>
          </Pressable>
        ))}
      </View>

      <EffectRack
        effects={effects}
        onRemove={async (effect) => {
          await source?.removeEffect(effect);
          setEffects((previous) => previous.filter((e) => e !== effect));
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: darkTheme.surface,
  },
  content: {
    padding: 16,
    gap: 14,
    paddingBottom: 48,
  },
  heading: {
    color: darkTheme.text,
    fontSize: 24,
    fontWeight: '700',
  },
  subheading: {
    color: darkTheme.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 6,
  },
  description: {
    color: darkTheme.textMuted,
    fontSize: 12,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  meters: {
    flexDirection: 'row',
    gap: 4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: darkTheme.control,
    borderWidth: 1,
    borderColor: darkTheme.track,
  },
  chipActive: {
    backgroundColor: darkTheme.accent,
    borderColor: darkTheme.accent,
  },
  chipText: {
    color: darkTheme.text,
    fontSize: 12,
  },
  chipTextActive: {
    color: darkTheme.surface,
    fontWeight: '600',
  },
  button: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: darkTheme.control,
    borderWidth: 1,
    borderColor: darkTheme.track,
  },
  buttonActive: {
    backgroundColor: darkTheme.accent,
    borderColor: darkTheme.accent,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: darkTheme.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
