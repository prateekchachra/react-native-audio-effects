/**
 * A playable MIDI-style keyboard.
 *
 * Drives a generator by note rather than by frequency, which is how anything
 * musical is actually thought about. Note numbers are standard MIDI, so the
 * same callbacks accept input from a real controller or a sequencer without
 * translation.
 *
 * Black keys overlay the white ones at their true positions, so the layout
 * matches a piano rather than spacing all twelve semitones evenly.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isBlackKey, noteName, octaveStart } from '../schema';
import { useAudioTheme, type AudioTheme } from './theme';

/** Black keys are near-black regardless of theme, as on a real instrument. */
const BLACK_KEY_COLOR = '#101216';

/** Semitone offsets of the white keys within an octave. */
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];

/**
 * Which white key each black key sits after, as an index into
 * {@link WHITE_OFFSETS}. There is no black key between E/F or B/C, which is
 * why this is a lookup rather than an even distribution.
 */
const BLACK_AFTER_WHITE: Record<number, number> = {
  1: 0, // C#
  3: 1, // D#
  6: 3, // F#
  8: 4, // G#
  10: 5, // A#
};

export interface KeyboardProps {
  /** Lowest octave shown, in scientific pitch notation. C4 is middle C. */
  startOctave?: number;
  octaves?: number;
  /** Fired with a MIDI note number when a key goes down. */
  onNoteOn: (midi: number) => void;
  /** Fired when the key is released. Omit for a one-shot trigger. */
  onNoteOff?: (midi: number) => void;
  /** Notes to draw as held, e.g. from a sequencer. */
  activeNotes?: readonly number[];
  height?: number;
  /** Label the C of each octave, which is the usual orientation cue. */
  showOctaveLabels?: boolean;
  theme?: Partial<AudioTheme>;
}

export function Keyboard({
  startOctave = 3,
  octaves = 2,
  onNoteOn,
  onNoteOff,
  activeNotes,
  height = 110,
  showOctaveLabels = true,
  theme: themeOverride,
}: KeyboardProps) {
  const theme = useAudioTheme(themeOverride);
  const [pressed, setPressed] = useState<number | undefined>();

  const whiteNotes = useMemo(() => {
    const notes: number[] = [];
    for (let octave = 0; octave < octaves; octave++) {
      const base = octaveStart(startOctave + octave);
      for (const offset of WHITE_OFFSETS) {
        notes.push(base + offset);
      }
    }
    return notes;
  }, [startOctave, octaves]);

  const blackNotes = useMemo(() => {
    const notes: Array<{ midi: number; whiteIndex: number }> = [];
    for (let octave = 0; octave < octaves; octave++) {
      const base = octaveStart(startOctave + octave);
      for (const [semitone, afterWhite] of Object.entries(BLACK_AFTER_WHITE)) {
        notes.push({
          midi: base + Number(semitone),
          whiteIndex: octave * WHITE_OFFSETS.length + afterWhite,
        });
      }
    }
    return notes;
  }, [startOctave, octaves]);

  const isHeld = useCallback(
    (midi: number) => pressed === midi || activeNotes?.includes(midi) === true,
    [pressed, activeNotes]
  );

  const press = useCallback(
    (midi: number) => {
      setPressed(midi);
      onNoteOn(midi);
    },
    [onNoteOn]
  );

  const release = useCallback(
    (midi: number) => {
      setPressed((current) => (current === midi ? undefined : current));
      onNoteOff?.(midi);
    },
    [onNoteOff]
  );

  const whiteWidthPercent = 100 / whiteNotes.length;

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.whiteRow}>
        {whiteNotes.map((midi) => {
          const held = isHeld(midi);
          return (
            <Pressable
              key={midi}
              onPressIn={() => press(midi)}
              onPressOut={() => release(midi)}
              accessibilityRole="button"
              accessibilityLabel={noteName(midi)}
              accessibilityState={{ selected: held }}
              style={[
                styles.whiteKey,
                {
                  backgroundColor: held ? theme.accent : theme.pointer,
                  borderColor: theme.surface,
                },
              ]}
            >
              {showOctaveLabels && midi % 12 === 0 ? (
                <Text style={[styles.keyLabel, { color: theme.surface }]}>
                  {noteName(midi)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* Overlaid so they sit between the white keys, as on a real keyboard. */}
      <View style={styles.blackLayer} pointerEvents="box-none">
        {blackNotes.map(({ midi, whiteIndex }) => {
          const held = isHeld(midi);
          return (
            <Pressable
              key={midi}
              onPressIn={() => press(midi)}
              onPressOut={() => release(midi)}
              accessibilityRole="button"
              accessibilityLabel={noteName(midi)}
              accessibilityState={{ selected: held }}
              style={[
                styles.blackKey,
                {
                  backgroundColor: held ? theme.accent : BLACK_KEY_COLOR,
                  borderColor: BLACK_KEY_COLOR,
                  height: height * 0.62,
                  width: `${whiteWidthPercent * 0.62}%`,
                  // Centre it on the boundary between two white keys.
                  left: `${whiteWidthPercent * (whiteIndex + 1) - whiteWidthPercent * 0.31}%`,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

/** Re-exported so callers can label their own note UI consistently. */
export { isBlackKey, noteName };

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
  },
  whiteRow: {
    flex: 1,
    flexDirection: 'row',
  },
  whiteKey: {
    flex: 1,
    borderWidth: 1,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 4,
  },
  keyLabel: {
    fontSize: 9,
    fontWeight: '700',
  },
  // Explicit rather than absoluteFillObject: the overlay must anchor to the
  // container's top, not flow after the white row.
  blackLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  blackKey: {
    position: 'absolute',
    top: 0,
    borderWidth: 1,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
});
