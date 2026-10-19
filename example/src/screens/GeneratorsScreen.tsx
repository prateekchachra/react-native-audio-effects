/**
 * Oscillators and noise sources, with a live effect chain on top.
 *
 * Needs no audio file, so this is also the quickest end-to-end check that the
 * engine, the effect chain and metering are all working.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ENVELOPE_PARAMS,
  GENERATORS,
  LFO,
  PolySynth,
  envelopeDefaults,
  getGenerator,
  noteName,
  type PlayMode,
  type Waveform,
} from 'react-native-audio-effects';
import { Keyboard, Knob, darkTheme } from 'react-native-audio-effects/ui';

const MODES: Array<{ key: PlayMode; label: string; hint: string }> = [
  {
    key: 'poly',
    label: 'Chord',
    hint: 'Notes stack. Tap a held key to drop it.',
  },
  { key: 'mono', label: 'Mono', hint: 'One note; every note re-attacks.' },
  {
    key: 'legato',
    label: 'Legato',
    hint: 'One note; the envelope keeps running.',
  },
  {
    key: 'portamento',
    label: 'Porta',
    hint: 'Legato, with the pitch gliding.',
  },
];

export function GeneratorsScreen() {
  const [waveform, setWaveform] = useState<Waveform>('sawtooth');
  const [mode, setMode] = useState<PlayMode>('poly');
  const [unison, setUnison] = useState(1);
  const [synth, setSynth] = useState<PolySynth>();
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [lfoOn, setLfoOn] = useState(false);
  const [envelope, setEnvelope] =
    useState<Record<string, number>>(envelopeDefaults);

  const envelopeRef = useRef(envelope);
  envelopeRef.current = envelope;
  const lfoRef = useRef<LFO | undefined>(undefined);

  const descriptor = getGenerator(waveform);
  const isPitched = descriptor?.pitched ?? false;

  // Rebuilt when the waveform, mode or unison count changes, since each
  // determines how many native sources the pool needs.
  useEffect(() => {
    let cancelled = false;
    let created: PolySynth | undefined;

    (async () => {
      created = await PolySynth.create({
        waveform,
        mode,
        unison,
        maxVoices: 6,
        amplitude: 0.22,
      });
      for (const [key, value] of Object.entries(envelopeRef.current)) {
        created.setEnvelopeParam(
          key as 'attack' | 'decay' | 'sustain' | 'release',
          value
        );
      }
      if (cancelled) {
        await created.dispose();
        return;
      }
      setSynth(created);
      setActiveNotes([]);
    })();

    return () => {
      cancelled = true;
      created?.dispose().catch(() => {});
      setSynth(undefined);
    };
  }, [waveform, mode, unison]);

  // Modulated onto the synth's own level rather than an effect, because
  // effects currently attach to a single source and this patch spans a
  // whole voice pool. A per-synth effects bus is tracked as follow-up.
  useEffect(() => {
    lfoRef.current?.dispose();
    lfoRef.current = undefined;

    if (!lfoOn || !synth) {
      return;
    }
    const lfo = new LFO({ rate: 4, shape: 'sine', depth: 0.8 });
    lfo.add({
      min: 0.02,
      max: 0.24,
      write: (value) => synth.setAmplitude(value),
    });
    lfo.start();
    lfoRef.current = lfo;

    return () => {
      lfo.dispose();
      synth.setAmplitude(0.22);
    };
  }, [lfoOn, synth]);

  const noteOn = useCallback(
    (midi: number) => {
      if (!synth) {
        return;
      }
      synth.noteOn(midi);
      setActiveNotes(synth.activeNotes);
    },
    [synth]
  );

  const setEnvelopeParam = useCallback(
    (key: string, value: number) => {
      setEnvelope((previous) => ({ ...previous, [key]: value }));
      synth?.setEnvelopeParam(
        key as 'attack' | 'decay' | 'sustain' | 'release',
        value
      );
    },
    [synth]
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

      <Text style={styles.subheading}>Mode</Text>
      <View style={styles.chips}>
        {MODES.map((entry) => (
          <Pressable
            key={entry.key}
            onPress={() => setMode(entry.key)}
            style={[styles.chip, mode === entry.key && styles.chipActive]}
          >
            <Text
              style={[
                styles.chipText,
                mode === entry.key && styles.chipTextActive,
              ]}
            >
              {entry.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hintLine}>
        {MODES.find((entry) => entry.key === mode)?.hint}
      </Text>

      <Text style={styles.subheading}>Unison</Text>
      <View style={styles.chips}>
        {[1, 2, 3, 5].map((count) => (
          <Pressable
            key={count}
            onPress={() => setUnison(count)}
            style={[styles.chip, unison === count && styles.chipActive]}
          >
            <Text
              style={[
                styles.chipText,
                unison === count && styles.chipTextActive,
              ]}
            >
              {count === 1 ? 'Off' : `${count}x`}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setLfoOn((on) => !on)}
          style={[styles.chip, lfoOn && styles.chipActive]}
        >
          <Text style={[styles.chipText, lfoOn && styles.chipTextActive]}>
            LFO
          </Text>
        </Pressable>
      </View>

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

      {isPitched ? (
        <>
          <View style={styles.keyboardHeader}>
            <Text style={styles.subheading}>Keyboard</Text>
            <Text style={styles.noteReadout}>
              {activeNotes.length > 0
                ? activeNotes.map(noteName).join(' ')
                : '--'}
            </Text>
          </View>
          <Keyboard fullRange onNoteOn={noteOn} activeNotes={activeNotes} />
        </>
      ) : (
        <Text style={styles.hintLine}>
          Noise has no pitch, so the keyboard is hidden. Pick a pitched waveform
          to play notes.
        </Text>
      )}
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
  hintLine: {
    color: darkTheme.textMuted,
    fontSize: 11.5,
    fontFamily: darkTheme.fontFamily,
    fontStyle: 'italic',
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
