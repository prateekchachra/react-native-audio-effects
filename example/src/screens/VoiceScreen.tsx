/**
 * Live microphone through an effect chain.
 *
 * The one screen here that can make the phone misbehave physically, so
 * most of what follows is about not doing that. Monitoring starts off,
 * the route is checked before it can be turned on, and unplugging
 * headphones mutes it again without asking.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AudioEngine,
  EFFECTS,
  MidiInput,
  getEffect,
  isUsingHeadphones,
  midiToFrequency,
  type Effect,
  type EffectType,
  type Source,
} from 'react-native-audio-effects';
import { EffectRack, darkTheme } from 'react-native-audio-effects/ui';

/** The voice effects, in the order they are most useful to reach for. */
const VOICE_EFFECTS: EffectType[] = [
  'pitchCorrect',
  'vocoder',
  'talkbox',
  'formantFilter',
  'pitchShift',
];

/** Effects worth offering alongside them. */
const EXTRA_EFFECTS: EffectType[] = [
  'reverb',
  'delay',
  'chorus',
  'compressor',
  'distortion',
];

export function VoiceScreen() {
  const engine = AudioEngine;
  const [mic, setMic] = useState<Source>();
  const [effects, setEffects] = useState<Effect[]>([]);
  const [monitoring, setMonitoring] = useState(false);
  const [headphones, setHeadphones] = useState(false);
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Polled rather than subscribed: a route change has no event in this
  // library yet, and the cost of asking is a property read. Unplugging
  // headphones mid-note is exactly when a stale answer is dangerous.
  useEffect(() => {
    const check = () => setHeadphones(isUsingHeadphones());
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, []);

  // Pulling the headphones out drops monitoring immediately. Asking first
  // would mean howling through the question.
  useEffect(() => {
    if (!headphones && monitoring) {
      mic?.setVolume(0);
      setMonitoring(false);
      setStatus('Monitoring stopped — headphones unplugged.');
    }
  }, [headphones, monitoring, mic]);

  const openMic = useCallback(async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      // playAndRecord is what makes the engine expose an input at all.
      await engine.configure({ category: 'playAndRecord', bufferFrames: 256 });
      const source = await engine.createMicrophone();
      setMic(source);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [engine]);

  const toggleMonitor = useCallback(() => {
    if (!mic) return;
    const next = !monitoring;
    if (next && !headphones) {
      setStatus('Plug in headphones first — the speaker will feed back.');
      return;
    }
    mic.setVolume(next ? 1 : 0);
    setMonitoring(next);
    setStatus(undefined);
  }, [mic, monitoring, headphones]);

  const addEffect = useCallback(
    async (type: EffectType) => {
      if (!mic) return;
      try {
        const effect = await mic.addEffect(type);
        setEffects((previous) => [...previous, effect]);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [mic]
  );

  const removeEffect = useCallback(
    async (effect: Effect) => {
      if (!mic) return;
      await mic.removeEffect(effect);
      setEffects((previous) => previous.filter((e) => e !== effect));
    },
    [mic]
  );

  useCarrierFromMidi(effects);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Voice</Text>

      <View style={[styles.banner, headphones ? styles.ok : styles.warn]}>
        <Text style={styles.bannerText}>
          {headphones
            ? 'Headphones detected — safe to monitor.'
            : 'Use headphones. Monitoring through the speaker feeds back.'}
        </Text>
      </View>

      {!mic ? (
        <Pressable
          onPress={openMic}
          style={styles.primary}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={darkTheme.surface} />
          ) : (
            <Text style={styles.primaryLabel}>Open microphone</Text>
          )}
        </Pressable>
      ) : (
        <Pressable
          onPress={toggleMonitor}
          style={[styles.primary, monitoring && styles.primaryOn]}
          accessibilityRole="switch"
          accessibilityState={{ checked: monitoring }}
        >
          <Text style={styles.primaryLabel}>
            {monitoring ? 'Monitoring — tap to mute' : 'Start monitoring'}
          </Text>
        </Pressable>
      )}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      {mic ? (
        <>
          <Text style={styles.subheading}>Voice effects</Text>
          <View style={styles.chips}>
            {VOICE_EFFECTS.map((type) => (
              <EffectChip key={type} type={type} onPress={addEffect} />
            ))}
          </View>

          <Text style={styles.subheading}>Also useful</Text>
          <View style={styles.chips}>
            {EXTRA_EFFECTS.map((type) => (
              <EffectChip key={type} type={type} onPress={addEffect} />
            ))}
          </View>

          <Text style={styles.subheading}>Chain</Text>
          {effects.length === 0 ? (
            <Text style={styles.hint}>
              Nothing yet. Pitch Correct tunes you to a key; Vocoder plays your
              formants over a synth you can drive from a MIDI keyboard.
            </Text>
          ) : (
            <EffectRack effects={effects} onRemove={removeEffect as never} />
          )}

          <Text style={styles.footnote}>
            Latency is the buffer plus the device's own input and output delay,
            so a lower buffer helps but cannot remove it. Wired headphones are
            far better than Bluetooth here — Bluetooth adds 150–250 ms, which is
            too much to sing against.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function EffectChip({
  type,
  onPress,
}: {
  type: EffectType;
  onPress: (type: EffectType) => void;
}) {
  const descriptor = getEffect(type);
  const available = EFFECTS.some(
    (effect) => effect.type === type && effect.platforms.includes('ios')
  );
  return (
    <Pressable
      onPress={() => onPress(type)}
      disabled={!available}
      style={[styles.chip, !available && styles.chipOff]}
    >
      <Text style={styles.chipLabel}>{descriptor?.label ?? type}</Text>
    </Pressable>
  );
}

/**
 * Play the vocoder's carrier from a MIDI keyboard.
 *
 * This is the whole reason the carrier has a `pitchSource` of `midi`:
 * sing into the microphone, play the notes you want it to sing. No native
 * work is needed for it — a parameter write is synchronous over JSI, so a
 * key press costs the same as turning a knob, and the effect already
 * exposes `carrierFrequency`.
 */
function useCarrierFromMidi(effects: Effect[]) {
  // Held in a ref so the listener does not need rebuilding for every
  // chain edit, which would drop notes held across the change.
  const carriers = useRef<Effect[]>([]);
  carriers.current = effects.filter(
    (effect) => effect.type === 'vocoder' || effect.type === 'talkbox'
  );

  useEffect(
    () =>
      MidiInput.addListener((message) => {
        if (message.type !== 'noteOn') return;
        const hz = midiToFrequency(message.note);
        for (const carrier of carriers.current) {
          // Only when the effect is actually set to follow MIDI; a fixed
          // carrier should stay where the knob put it.
          if (carrier.get('pitchSource') >= 1) {
            carrier.set('carrierFrequency', hz);
          }
        }
      }),
    []
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  heading: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 28,
    fontWeight: '700',
  },
  subheading: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingTop: 6,
  },
  banner: { padding: 12, borderRadius: 12, borderWidth: 1 },
  ok: { borderColor: darkTheme.accent, backgroundColor: darkTheme.surface },
  warn: {
    borderColor: darkTheme.meterHigh,
    backgroundColor: darkTheme.surface,
  },
  bannerText: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  primary: {
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: darkTheme.control,
    borderWidth: 1,
    borderColor: darkTheme.track,
  },
  primaryOn: {
    backgroundColor: darkTheme.accent,
    borderColor: darkTheme.accent,
  },
  primaryLabel: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: darkTheme.control,
  },
  chipOff: { opacity: 0.35 },
  chipLabel: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 13,
  },
  status: {
    color: darkTheme.meterHigh,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  hint: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  footnote: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 10,
    lineHeight: 15,
    paddingTop: 10,
  },
});
