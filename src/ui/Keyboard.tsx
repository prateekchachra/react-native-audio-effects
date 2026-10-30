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
 *
 * ## Latch or hold
 *
 * Pass {@link KeyboardProps.onNoteOff} for hold-to-sound: the note stops when
 * the finger lifts. Omit it to latch, and drive the highlight yourself
 * through {@link KeyboardProps.activeNotes} — on a touchscreen that is
 * usually the better default, since a finger covers the key it is playing
 * and you cannot sustain a note while reaching for a knob.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isBlackKey,
  noteName,
  octaveStart,
  PIANO_HIGHEST,
  PIANO_LOWEST,
} from '../schema';
import { useAudioTheme, type AudioTheme } from './theme';

/** Black keys are near-black regardless of theme, as on a real instrument. */
const BLACK_KEY_COLOR = '#101216';

export interface KeyboardProps {
  /** Lowest octave shown, in scientific pitch notation. C4 is middle C. */
  startOctave?: number;
  octaves?: number;
  /**
   * Show a full 88-key piano, A0 to C8, overriding the octave range.
   *
   * Scrolls horizontally, since 52 white keys will not fit a phone at a
   * playable width.
   */
  fullRange?: boolean;
  /**
   * Width of a white key when scrolling. Ignored when the whole range fits,
   * in which case keys share the available width evenly.
   */
  keyWidth?: number;
  /** Scroll position on first layout, as a MIDI note. Defaults to C4. */
  initialScrollToNote?: number;
  /** Fired with a MIDI note number when a key goes down. */
  onNoteOn: (midi: number) => void;
  /**
   * Fired when the finger lifts. Omit to latch — see the note on latch
   * versus hold above.
   */
  onNoteOff?: (midi: number) => void;
  /**
   * Notes to draw as held. Required when latching, since the component's own
   * press state only lasts as long as the touch.
   */
  activeNotes?: readonly number[];
  height?: number;
  /** Label the C of each octave, which is the usual orientation cue. */
  showOctaveLabels?: boolean;
  theme?: Partial<AudioTheme>;
}

/** A0 and C8: the bottom and top of a standard 88-key piano. */

export function Keyboard({
  startOctave = 3,
  octaves = 2,
  fullRange = false,
  keyWidth = 38,
  initialScrollToNote = 60,
  onNoteOn,
  onNoteOff,
  activeNotes,
  height = 110,
  showOctaveLabels = true,
  theme: themeOverride,
}: KeyboardProps) {
  const theme = useAudioTheme(themeOverride);
  const [pressed, setPressed] = useState<number | undefined>();

  /** Inclusive MIDI range being drawn. */
  const [lowest, highest] = useMemo(
    () =>
      fullRange
        ? [PIANO_LOWEST, PIANO_HIGHEST]
        : [octaveStart(startOctave), octaveStart(startOctave + octaves) - 1],
    [fullRange, startOctave, octaves]
  );

  const whiteNotes = useMemo(() => {
    const notes: number[] = [];
    for (let midi = lowest; midi <= highest; midi++) {
      if (!isBlackKey(midi)) {
        notes.push(midi);
      }
    }
    return notes;
  }, [lowest, highest]);

  /**
   * Black keys, each paired with the white key it sits after.
   *
   * Indexing against the white keys rather than spacing all twelve
   * semitones evenly is what makes the layout look like a piano — there is
   * no black key between E/F or B/C.
   */
  const blackNotes = useMemo(() => {
    const whiteIndexOf = new Map(
      whiteNotes.map((midi, index) => [midi, index])
    );
    const notes: Array<{ midi: number; whiteIndex: number }> = [];
    for (let midi = lowest; midi <= highest; midi++) {
      if (!isBlackKey(midi)) {
        continue;
      }
      // Sits immediately after the white key a semitone below it.
      const whiteIndex = whiteIndexOf.get(midi - 1);
      if (whiteIndex !== undefined) {
        notes.push({ midi, whiteIndex });
      }
    }
    return notes;
  }, [lowest, highest, whiteNotes]);

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

  const scrolls = fullRange;
  const totalWidth = whiteNotes.length * keyWidth;
  /** Scroll so the requested note starts roughly centred. */
  const initialOffset = useMemo(() => {
    if (!scrolls) {
      return 0;
    }
    const index = whiteNotes.findIndex((midi) => midi >= initialScrollToNote);
    return Math.max(0, (index < 0 ? 0 : index) * keyWidth - keyWidth * 3);
  }, [scrolls, whiteNotes, initialScrollToNote, keyWidth]);

  const body = (
    <View
      style={[styles.container, { height }, scrolls && { width: totalWidth }]}
    >
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
                scrolls ? { width: keyWidth } : styles.whiteKeyFlex,
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
                  ...(scrolls
                    ? {
                        width: keyWidth * 0.62,
                        // Centred on the boundary between two white keys.
                        left: keyWidth * (whiteIndex + 1) - keyWidth * 0.31,
                      }
                    : {
                        width: `${(100 / whiteNotes.length) * 0.62}%`,
                        left: `${(100 / whiteNotes.length) * (whiteIndex + 1) - (100 / whiteNotes.length) * 0.31}%`,
                      }),
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );

  if (!scrolls) {
    return body;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: initialOffset, y: 0 }}
      // The keys are the gesture targets, so the scroll view must not claim
      // a touch that starts on one.
      directionalLockEnabled
      style={{ height }}
    >
      {body}
    </ScrollView>
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
    borderWidth: 1,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 4,
  },
  whiteKeyFlex: {
    flex: 1,
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
