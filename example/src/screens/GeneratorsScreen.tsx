/**
 * Oscillators and noise sources, with a live effect chain on top.
 *
 * Needs no audio file, so this is also the quickest end-to-end check that the
 * engine, the effect chain and metering are all working.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AudioEngine,
  ENVELOPE_PARAMS,
  GENERATORS,
  SINE,
  envelopeDefaults,
  getEffect,
  getGenerator,
  midiToFrequency,
  noteName,
  type Effect,
  type EffectType,
  type Source,
  type Waveform,
} from 'react-native-audio-effects';
import {
  EffectRack,
  Keyboard,
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
  const [lastNote, setLastNote] = useState<number>();
  const [envelope, setEnvelope] =
    useState<Record<string, number>>(envelopeDefaults);

  // Read inside the create effect without making it a dependency, which
  // would rebuild the oscillator on every envelope tweak.
  const envelopeRef = useRef(envelope);
  envelopeRef.current = envelope;

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
      for (const [key, value] of Object.entries(envelopeRef.current)) {
        created.setEnvelopeParam(
          key as 'attack' | 'decay' | 'sustain' | 'release',
          value
        );
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

  // Playing a note retunes the oscillator and starts it if it was idle, so a
  // key press is audible without having to hit Play first.
  const noteOn = useCallback(
    async (midi: number) => {
      if (!source) {
        return;
      }
      const hz = midiToFrequency(midi);
      setLastNote(midi);
      setFrequency(hz);
      source.setOscillatorParam('frequency', hz);
      // The stream runs continuously; the envelope gate is what makes a note.
      // Restarting the stream per key press would click and add latency.
      if (!isPlaying) {
        await source.play({ loop: true });
        setIsPlaying(true);
      }
      source.gate(true);
    },
    [source, isPlaying]
  );

  // Hold-to-sound: releasing silences the oscillator again. A real instrument
  // would use an envelope here; this is a single-voice generator, so gating
  // amplitude is the honest equivalent.
  const noteOff = useCallback(() => {
    // Release the envelope and let it ring out; the stream stays up.
    source?.gate(false);
  }, [source]);

  const setEnvelopeParam = useCallback(
    (key: string, value: number) => {
      setEnvelope((previous) => ({ ...previous, [key]: value }));
      source?.setEnvelopeParam(
        key as 'attack' | 'decay' | 'sustain' | 'release',
        value
      );
    },
    [source]
  );

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

      {/* Noise has no notes to press, so it keeps a transport button.
          Pitched sources are played from the keyboard instead. */}
      {!isPitched ? (
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
      ) : null}

      {isPitched ? (
        <>
          <Text style={styles.subheading}>Envelope</Text>
          <View style={styles.adsrRow}>
            {ENVELOPE_PARAMS.map((param) => (
              <Knob
                key={param.key}
                param={param}
                value={envelope[param.key] ?? param.default}
                onChange={(value) => setEnvelopeParam(param.key, value)}
                size={60}
              />
            ))}
          </View>

          <View style={styles.keyboardHeader}>
            <Text style={styles.subheading}>Keyboard</Text>
            <Text style={styles.noteReadout}>
              {lastNote !== undefined ? noteName(lastNote) : '--'}
            </Text>
          </View>
          <Keyboard
            startOctave={3}
            octaves={2}
            onNoteOn={noteOn}
            onNoteOff={noteOff}
            activeNotes={isPlaying && lastNote !== undefined ? [lastNote] : []}
          />
        </>
      ) : null}

      <Text style={styles.subheading}>Add an effect</Text>
      <View style={styles.chips}>
        {QUICK_EFFECTS.map((type) => (
          <Pressable
            key={type}
            onPress={() => addEffect(type)}
            style={styles.chip}
          >
            <Text style={styles.chipText}>
              {getEffect(type)?.label ?? type}
            </Text>
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
    fontSize: 26,
    fontWeight: '700',
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.3,
  },
  subheading: {
    color: darkTheme.textMuted,
    fontSize: 10,
    fontFamily: darkTheme.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginTop: 8,
  },
  description: {
    color: darkTheme.textMuted,
    fontSize: 12,
    fontFamily: darkTheme.fontFamily,
    lineHeight: 18,
    marginBottom: 10,
  },
  adsrRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 4,
  },
  keyboardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  noteReadout: {
    color: darkTheme.accent,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: darkTheme.monoFontFamily,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    marginTop: 4,
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
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: darkTheme.control,
    shadowColor: darkTheme.shadowDark,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.85,
    shadowRadius: 5,
    elevation: 4,
  },
  chipActive: {
    backgroundColor: darkTheme.accent,
    borderColor: darkTheme.accent,
  },
  chipText: {
    color: darkTheme.text,
    fontSize: 12.5,
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.2,
  },
  chipTextActive: {
    color: darkTheme.surface,
    fontWeight: '600',
  },
  button: {
    paddingVertical: 14,
    borderRadius: darkTheme.radius,
    alignItems: 'center',
    backgroundColor: darkTheme.control,
    shadowColor: darkTheme.shadowDark,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
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
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.4,
  },
});
