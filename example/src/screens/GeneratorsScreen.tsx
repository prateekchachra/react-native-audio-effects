/**
 * Oscillators and noise sources, with a live effect chain on top.
 *
 * Needs no audio file, so this is also the quickest end-to-end check that the
 * engine, the effect chain and metering are all working.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  EFFECTS,
  GENERATORS,
  LFO,
  PolySynth,
  PresetStore,
  envelopeDefaults,
  getGenerator,
  isEffectAvailable,
  noteName,
  type EffectType,
  type ParamDescriptor,
  type PlayMode,
  type VoiceStackEffect,
} from 'react-native-audio-effects';
import type { Waveform } from 'react-native-audio-effects';
import {
  EffectRack,
  EnvelopeEditor,
  Keyboard,
  Knob,
  LFOPanel,
  PresetPanel,
  darkTheme,
} from 'react-native-audio-effects/ui';

/**
 * Unison controls are synth settings, not effect parameters, so they have
 * no schema entry. These stand in so `Knob` keeps taking one kind of thing.
 */
const DETUNE_PARAM: ParamDescriptor = {
  key: 'unisonSpread',
  label: 'Detune',
  min: 0,
  max: 60,
  default: 14,
  unit: 'cents',
  taper: 'linear',
};

const WIDTH_PARAM: ParamDescriptor = {
  key: 'unisonPan',
  label: 'Width',
  min: 0,
  max: 1,
  default: 0.6,
  unit: '%',
  taper: 'linear',
};

/**
 * One store for the screen.
 *
 * No storage is passed, so presets live for the session. Wiring
 * AsyncStorage here is a one-liner and is what a real app would do.
 */
const presetStore = new PresetStore({ namespace: 'generators' });

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
  const [detuneCents, setDetuneCents] = useState<number>(DETUNE_PARAM.default);
  const [width, setWidth] = useState<number>(WIDTH_PARAM.default);
  const [synth, setSynth] = useState<PolySynth>();
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [effects, setEffects] = useState<VoiceStackEffect[]>([]);
  const [status, setStatus] = useState<string>();
  const [envelope, setEnvelope] =
    useState<Record<string, number>>(envelopeDefaults);

  const envelopeRef = useRef(envelope);
  envelopeRef.current = envelope;

  // Read when a synth is built, so turning either knob does not land in the
  // rebuild effect's dependencies and tear the voice pool down mid-note.
  const unisonRef = useRef({ spread: detuneCents, pan: width });
  unisonRef.current = { spread: detuneCents, pan: width };

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
        unisonSpread: unisonRef.current.spread,
        unisonPan: unisonRef.current.pan,
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
      // Effects belong to the old pool's sources, which are being released.
      setEffects([]);
    })();

    return () => {
      cancelled = true;
      created?.dispose().catch(() => {});
      setSynth(undefined);
    };
  }, [waveform, mode, unison]);

  /**
   * One LFO for the screen, driven by its own panel.
   *
   * Built once and kept, rather than recreated whenever the patch changes:
   * the panel holds the assignment, and rebuilding the LFO underneath it
   * would silently drop whatever the user had pointed it at.
   */
  const lfo = useMemo(
    () => new LFO({ rate: 1.2, shape: 'sine', depth: 0.9 }),
    []
  );

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

  const addEffect = useCallback(
    async (type: EffectType) => {
      if (!synth) {
        return;
      }
      try {
        const stack = await synth.addEffect(type);
        setEffects((previous) => [...previous, stack]);
        setStatus(undefined);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [synth]
  );

  const removeEffect = useCallback(
    (stack: VoiceStackEffect) => {
      if (!synth) {
        return;
      }
      synth.removeEffect(stack).then(() => {
        setEffects((previous) => previous.filter((e) => e.id !== stack.id));
      });
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
      </View>

      {unison > 1 ? (
        <>
          <Text style={styles.hintLine}>
            Detune spreads the stack in pitch; width spreads it across the
            stereo field. Detune alone just beats in the middle — the two
            together are what make a stack sound large.
          </Text>
          <View style={styles.adsrRow}>
            <Knob
              param={DETUNE_PARAM}
              value={detuneCents}
              onChange={(value) => {
                setDetuneCents(value);
                synth?.setUnisonSpread(value);
              }}
              size={60}
            />
            <Knob
              param={WIDTH_PARAM}
              value={width}
              onChange={(value) => {
                setWidth(value);
                synth?.setUnisonPan(value);
              }}
              size={60}
            />
          </View>
        </>
      ) : null}

      <Text style={styles.subheading}>Modulation</Text>
      <View style={styles.panel}>
        <LFOPanel
          // Remounting on a rebuild drops an assignment that now points at
          // effects which no longer exist.
          key={`${waveform}:${mode}:${unison}`}
          lfo={lfo}
          targets={effects}
          theme={darkTheme}
        />
      </View>

      <Text style={styles.subheading}>Envelope</Text>
      <Text style={styles.hintLine}>
        Drag the handles. Pull Sustain to the floor and shorten Decay for a
        pluck — time-based effects like delay and reverb only read clearly
        on a patch that actually stops.
      </Text>
      <EnvelopeEditor
        values={envelope}
        onChange={setEnvelopeParam}
        theme={darkTheme}
      />

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

      <Text style={styles.subheading}>Add an effect</Text>
      {status ? <Text style={styles.hintLine}>{status}</Text> : null}
      <View style={styles.chips}>
        {EFFECTS.map((descriptor) => {
          const available = isEffectAvailable(descriptor.type);
          return (
            <Pressable
              key={descriptor.type}
              disabled={!available || !synth}
              onPress={() => addEffect(descriptor.type)}
              style={[styles.chip, !available && styles.chipDisabled]}
            >
              <Text
                style={[styles.chipText, !available && styles.chipTextDisabled]}
              >
                {descriptor.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.subheading}>
        Chain {effects.length > 0 ? `(${effects.length})` : ''}
      </Text>
      <EffectRack effects={effects} onRemove={removeEffect as never} />

      <Text style={styles.subheading}>Presets</Text>
      <View style={styles.panel}>
        <PresetPanel store={presetStore} chain={effects} theme={darkTheme} />
      </View>
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
  /** Wrapper for the kit's own panels, which bring their own padding. */
  panel: {
    marginTop: 2,
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
  chipDisabled: {
    opacity: 0.4,
  },
  chipTextDisabled: {
    color: darkTheme.disabled,
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
