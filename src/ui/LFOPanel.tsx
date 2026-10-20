/**
 * Controls for a modulation LFO.
 *
 * The {@link LFO} itself is headless — it writes numbers into whatever you
 * point it at. This is the front panel for one: rate, depth, shape, and a
 * picker for which parameter it drives.
 *
 * ## Why the target is a picker rather than a drag
 *
 * Hardware and most plugins do modulation assignment by dragging a source
 * onto a destination. That needs a drag layer spanning the whole rack, and
 * on a phone it competes with scrolling. A list of the chain's own
 * parameters is less elegant and much easier to hit with a thumb.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { EffectLike } from '../api/EffectLike';
import type { LFO, LFOShape } from '../api/LFO';
import { formatValue, type ParamDescriptor } from '../schema';
import { Knob } from './Knob';
import {
  neuroInner,
  neuroRaised,
  useAudioTheme,
  type AudioTheme,
} from './theme';

const SHAPES: readonly LFOShape[] = [
  'sine',
  'triangle',
  'square',
  'sawtooth',
  'random',
];

/** Shown under the shape buttons, because 'random' is not self-explanatory. */
const SHAPE_HINTS: Record<LFOShape, string> = {
  sine: 'Smooth, even sweep. The default for vibrato and tremolo.',
  triangle: 'Linear up and down. Slightly harder turnarounds than a sine.',
  square: 'Jumps between two values. Trills and gated effects.',
  sawtooth: 'Ramps up, then snaps back. Good for rhythmic sweeps.',
  random: 'Holds a new random value each cycle. Sample and hold.',
};

/**
 * Rate and depth are LFO settings rather than effect parameters, so they
 * have no schema entry of their own. These stand in, which keeps `Knob`
 * taking exactly one kind of thing.
 */
const RATE_PARAM: ParamDescriptor = {
  key: 'rate',
  label: 'Rate',
  min: 0.05,
  max: 20,
  default: 1,
  unit: 'Hz',
  // Log, because the musically interesting range is all below 8 Hz and a
  // linear knob would cram it into the first third of the travel.
  taper: 'log',
};

const DEPTH_PARAM: ParamDescriptor = {
  key: 'depth',
  label: 'Depth',
  min: 0,
  max: 1,
  default: 1,
  unit: '%',
  taper: 'linear',
};

export interface LFOPanelProps {
  lfo: LFO;
  /** Effects whose parameters the LFO may be pointed at. */
  targets: readonly EffectLike[];
  title?: string;
  theme?: Partial<AudioTheme>;
}

interface Assignment {
  effectId: number;
  paramKey: string;
}

export function LFOPanel({
  lfo,
  targets,
  title = 'LFO',
  theme: themeOverride,
}: LFOPanelProps) {
  const theme = useAudioTheme(themeOverride);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [rate, setRate] = useState(lfo.rate);
  const [depth, setDepth] = useState(lfo.depth);
  const [shape, setShape] = useState<LFOShape>(lfo.shape);
  const [running, setRunning] = useState(lfo.isRunning);
  const [assignment, setAssignment] = useState<Assignment | undefined>();

  // Every parameter in the chain, flattened into one pickable list.
  const choices = useMemo(
    () =>
      targets.flatMap((effect) =>
        effect.params.map((param) => ({
          effect,
          param,
          id: `${effect.id}:${param.key}`,
        }))
      ),
    [targets]
  );

  /**
   * Re-point the LFO.
   *
   * The LFO holds one assignment at a time here, so switching targets has
   * to release the old one — otherwise the previous parameter is left
   * wherever the last tick happened to put it, which reads as a stuck knob.
   */
  const assign = useCallback(
    (effect: EffectLike, param: ParamDescriptor) => {
      const already =
        assignment?.effectId === effect.id && assignment.paramKey === param.key;
      lfo.clear();
      if (already) {
        setAssignment(undefined);
        if (lfo.isRunning) {
          lfo.stop();
          setRunning(false);
        }
        return;
      }
      lfo.addParam(effect, param.key);
      setAssignment({ effectId: effect.id, paramKey: param.key });
      if (!lfo.isRunning) {
        lfo.start();
        setRunning(true);
      }
    },
    [assignment, lfo]
  );

  const toggleRun = useCallback(() => {
    if (lfo.isRunning) {
      lfo.stop();
      setRunning(false);
    } else if (assignment) {
      lfo.start();
      setRunning(true);
    }
  }, [assignment, lfo]);

  // A panel unmounting should not leave a timer writing into dead effects.
  useEffect(
    () => () => {
      lfo.stop();
    },
    [lfo]
  );

  return (
    <View style={neuroRaised(theme, 20)}>
      <View style={[neuroInner(theme, 20), styles.card]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            onPress={toggleRun}
            disabled={!assignment}
            accessibilityRole="switch"
            accessibilityState={{ checked: running, disabled: !assignment }}
            accessibilityLabel={running ? 'Stop the LFO' : 'Start the LFO'}
            style={[
              styles.runButton,
              running && styles.runButtonOn,
              !assignment && styles.disabled,
            ]}
          >
            <Text style={[styles.runLabel, running && styles.runLabelOn]}>
              {running ? 'Running' : 'Stopped'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.description}>
          Sweeps one parameter back and forth on its own. Pick a destination
          below, then set how fast and how far it travels.
        </Text>

        <View style={styles.knobs}>
          <Knob
            param={RATE_PARAM}
            value={rate}
            onChange={(value) => {
              lfo.rate = value;
              setRate(value);
            }}
          />
          <Knob
            param={DEPTH_PARAM}
            value={depth}
            onChange={(value) => {
              lfo.depth = value;
              setDepth(value);
            }}
          />
        </View>

        <Text style={styles.sectionLabel}>Shape</Text>
        <View style={styles.shapes}>
          {SHAPES.map((option) => {
            const active = option === shape;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  lfo.shape = option;
                  setShape(option);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>{SHAPE_HINTS[shape]}</Text>

        <Text style={styles.sectionLabel}>Destination</Text>
        {choices.length === 0 ? (
          <Text style={styles.hint}>
            Add an effect and its parameters will show up here.
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.targets}
          >
            {choices.map(({ effect, param, id }) => {
              const active =
                assignment?.effectId === effect.id &&
                assignment.paramKey === param.key;
              return (
                <Pressable
                  key={id}
                  onPress={() => assign(effect, param)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Modulate ${effect.descriptor.label} ${param.label}`}
                  style={[styles.target, active && styles.targetActive]}
                >
                  <Text style={styles.targetEffect}>
                    {effect.descriptor.label}
                  </Text>
                  <Text
                    style={[
                      styles.targetParam,
                      active && styles.targetParamActive,
                    ]}
                  >
                    {param.label}
                  </Text>
                  <Text style={styles.targetRange}>
                    {formatValue(param, param.min)} –{' '}
                    {formatValue(param, param.max)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function makeStyles(theme: AudioTheme) {
  return StyleSheet.create({
    card: { padding: 18, gap: 12 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      color: theme.text,
      fontFamily: theme.fontFamily,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    description: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 12,
      lineHeight: 17,
    },
    runButton: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.textMuted,
    },
    runButtonOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    disabled: { opacity: 0.4 },
    runLabel: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    runLabelOn: { color: theme.surface },
    knobs: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: 4,
    },
    sectionLabel: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginTop: 4,
    },
    shapes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    chipActive: { borderColor: theme.accent },
    chipText: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 12,
      textTransform: 'capitalize',
    },
    chipTextActive: { color: theme.accent, fontWeight: '700' },
    hint: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 11,
      lineHeight: 16,
      fontStyle: 'italic',
    },
    targets: { gap: 8, paddingVertical: 2, paddingRight: 8 },
    target: {
      minWidth: 104,
      padding: 10,
      borderRadius: 14,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: 'transparent',
      gap: 2,
    },
    targetActive: { borderColor: theme.accent },
    targetEffect: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 10,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    targetParam: {
      color: theme.text,
      fontFamily: theme.fontFamily,
      fontSize: 13,
      fontWeight: '600',
    },
    targetParamActive: { color: theme.accent },
    targetRange: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 10,
    },
  });
}
