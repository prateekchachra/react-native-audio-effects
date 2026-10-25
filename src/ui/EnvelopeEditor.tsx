/**
 * Draggable ADSR envelope.
 *
 * Four knobs tell you four numbers. A shape tells you what the note will
 * do — that a pluck is a pluck, that the release outlasts the note —
 * which is the thing you are actually choosing.
 *
 * ## Why this does not run on the UI thread
 *
 * `Knob` drives its arc from `useAnimatedProps`, which keeps a 60 fps
 * drag smooth while JS is busy. That path is not available here: the
 * geometry depends on `toNormalized` and `fromNormalized`, which live in
 * the schema and are plain JS. Marking them as worklets is not an option
 * either — they are called during render too, and a worklet calling
 * another worklet from the JS thread is exactly what once crashed `Knob`
 * with "undefined is not a function".
 *
 * So the gesture reports deltas back with `runOnJS` and the shape is
 * ordinary React state. An envelope is dragged in short deliberate
 * movements rather than swept continuously, so the difference does not
 * show, and correctness here is worth more than the last few
 * milliseconds of smoothness.
 *
 * ## Why the handles are Views rather than SVG circles
 *
 * `GestureDetector` needs a real view to attach to. The curve is drawn
 * in SVG and left inert; the grab targets are absolutely positioned
 * views on top of it, which also lets them be far larger than the dots
 * they display — a 9 px circle is well under a comfortable touch target.
 *
 * ## Why the axis is not linear in time
 *
 * Attack spans 1 ms to 4 s. On a shared time axis a 1 ms attack is a
 * subpixel sliver you cannot grab. Each stage is therefore drawn
 * proportionally to its *tapered* position within its own range, which
 * is what hardware editors do: every handle stays reachable whatever the
 * absolute times are. The shape is honest about proportion, not about
 * absolute duration.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';

import {
  ENVELOPE_PARAMS,
  formatValue,
  fromNormalized,
  quantize,
  toNormalized,
  type ParamDescriptor,
} from '../schema';
import { useAudioTheme, type AudioTheme } from './theme';

/**
 * Share of the canvas each stage occupies.
 *
 * Sustain is a level, not a duration, so its segment is a fixed plateau —
 * there is no time to represent. Release gets the most room because it
 * has the widest range, up to 8 s.
 */
const WIDTH_SHARE = {
  attack: 0.24,
  decay: 0.24,
  sustainHold: 0.18,
  release: 0.34,
} as const;

const HANDLE_RADIUS = 9;
/** Touch target, much larger than the dot it draws. */
const HANDLE_TOUCH = 44;

export type EnvelopeKey = 'attack' | 'decay' | 'sustain' | 'release';

export interface EnvelopeEditorProps {
  /** Current values, keyed as in {@link ENVELOPE_PARAMS}. */
  values: Record<string, number>;
  onChange: (key: EnvelopeKey, value: number) => void;
  /** Called once a drag ends, for undo or preset bookkeeping. */
  onChangeEnd?: (key: EnvelopeKey, value: number) => void;
  height?: number;
  /** Show stage names and values under the curve. */
  showReadout?: boolean;
  theme?: Partial<AudioTheme>;
}

const PARAM_BY_KEY: Record<EnvelopeKey, ParamDescriptor> = Object.fromEntries(
  ENVELOPE_PARAMS.map((param) => [param.key, param])
) as Record<EnvelopeKey, ParamDescriptor>;

export function EnvelopeEditor({
  values,
  onChange,
  onChangeEnd,
  height = 150,
  showReadout = true,
  theme: themeOverride,
}: EnvelopeEditorProps) {
  const theme = useAudioTheme(themeOverride);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [width, setWidth] = useState(0);

  /**
   * Value each handle held when its drag began.
   *
   * Read at gesture start rather than at render. Taking it from props on
   * every frame would compound: the delta is measured from the start of
   * the gesture, so applying it to an already-updated value makes the
   * handle accelerate away from the finger.
   */
  const dragStart = useRef<Partial<Record<EnvelopeKey, number>>>({});

  /**
   * Latest values, so a gesture can read the current one at touch-down.
   *
   * Without this the start value would be whatever the closure captured
   * when the gesture object was built, which goes stale the moment
   * anything re-renders — including the drag's own updates.
   */
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const pad = HANDLE_RADIUS + 5;
  const top = pad;
  const baseline = height - pad;
  const usable = Math.max(0, width - pad * 2);
  const plotHeight = baseline - top;

  const valueOf = (key: EnvelopeKey) =>
    values[key] ?? PARAM_BY_KEY[key].default;

  const nAttack = toNormalized(PARAM_BY_KEY.attack, valueOf('attack'));
  const nDecay = toNormalized(PARAM_BY_KEY.decay, valueOf('decay'));
  const nSustain = toNormalized(PARAM_BY_KEY.sustain, valueOf('sustain'));
  const nRelease = toNormalized(PARAM_BY_KEY.release, valueOf('release'));

  const wAttack = usable * WIDTH_SHARE.attack;
  const wDecay = usable * WIDTH_SHARE.decay;
  const wHold = usable * WIDTH_SHARE.sustainHold;
  const wRelease = usable * WIDTH_SHARE.release;

  const x0 = pad;
  const xA = x0 + wAttack * nAttack;
  const xD = xA + wDecay * nDecay;
  const xS = xD + wHold;
  const xR = xS + wRelease * nRelease;
  const ySustain = baseline - plotHeight * nSustain;

  const curve =
    `M ${x0} ${baseline} L ${xA} ${top} L ${xD} ${ySustain} ` +
    `L ${xS} ${ySustain} L ${xR} ${baseline}`;

  const beginDrag = useCallback((key: EnvelopeKey) => {
    dragStart.current[key] =
      valuesRef.current[key] ?? PARAM_BY_KEY[key].default;
  }, []);

  /**
   * Apply a drag delta to one parameter.
   *
   * The delta is converted through that stage's own width, so the handle
   * tracks the finger regardless of how the taper compresses that part
   * of the range.
   */
  const applyDrag = useCallback(
    (key: EnvelopeKey, deltaPx: number, segmentPx: number, done: boolean) => {
      const start = dragStart.current[key];
      if (start === undefined || segmentPx <= 0) {
        return;
      }
      const param = PARAM_BY_KEY[key];
      const next = toNormalized(param, start) + deltaPx / segmentPx;
      const clamped = next < 0 ? 0 : next > 1 ? 1 : next;
      const value = quantize(param, fromNormalized(param, clamped));
      onChange(key, value);
      if (done) {
        delete dragStart.current[key];
        onChangeEnd?.(key, value);
      }
    },
    [onChange, onChangeEnd]
  );

  /**
   * One handle's pan gesture.
   *
   * The gesture closes over nothing that changes with the values — only
   * the key, the stage's pixel width and the axis — so a re-render
   * mid-drag cannot feed it a stale starting point.
   */
  const gestureFor = (
    key: EnvelopeKey,
    segmentPx: number,
    axis: 'x' | 'y'
  ) =>
    Gesture.Pan()
      .onBegin(() => {
        'worklet';
        runOnJS(beginDrag)(key);
      })
      .onUpdate((event) => {
        'worklet';
        // Screen y grows downward; a parameter grows upward.
        const delta = axis === 'x' ? event.translationX : -event.translationY;
        runOnJS(applyDrag)(key, delta, segmentPx, false);
      })
      .onEnd((event) => {
        'worklet';
        const delta = axis === 'x' ? event.translationX : -event.translationY;
        runOnJS(applyDrag)(key, delta, segmentPx, true);
      });

  const handles: Array<{
    key: EnvelopeKey;
    x: number;
    y: number;
    segment: number;
    axis: 'x' | 'y';
    filled: boolean;
  }> = [
    { key: 'attack', x: xA, y: top, segment: wAttack, axis: 'x', filled: false },
    {
      key: 'decay',
      x: xD,
      y: ySustain,
      segment: wDecay,
      axis: 'x',
      filled: false,
    },
    {
      key: 'sustain',
      x: (xD + xS) / 2,
      y: ySustain,
      segment: plotHeight,
      axis: 'y',
      filled: true,
    },
    {
      key: 'release',
      x: xR,
      y: baseline,
      segment: wRelease,
      axis: 'x',
      filled: false,
    },
  ];

  return (
    <View>
      <View
        style={[styles.canvas, { height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <>
            <Svg width={width} height={height}>
              <Line
                x1={pad}
                y1={baseline}
                x2={width - pad}
                y2={baseline}
                stroke={theme.track}
                strokeWidth={1}
              />
              <Path
                d={`${curve} L ${x0} ${baseline} Z`}
                fill={theme.accent}
                fillOpacity={0.16}
              />
              <Path
                d={curve}
                stroke={theme.accent}
                strokeWidth={2.5}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </Svg>

            {handles.map((handle) => (
              <GestureDetector
                key={handle.key}
                gesture={gestureFor(handle.key, handle.segment, handle.axis)}
              >
                <View
                  accessibilityRole="adjustable"
                  accessibilityLabel={PARAM_BY_KEY[handle.key].label}
                  accessibilityValue={{
                    text: formatValue(
                      PARAM_BY_KEY[handle.key],
                      valueOf(handle.key)
                    ),
                  }}
                  style={[
                    styles.touch,
                    {
                      left: handle.x - HANDLE_TOUCH / 2,
                      top: handle.y - HANDLE_TOUCH / 2,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.dot,
                      handle.filled ? styles.dotFilled : styles.dotHollow,
                    ]}
                  />
                </View>
              </GestureDetector>
            ))}
          </>
        ) : null}
      </View>

      {showReadout ? (
        <View style={styles.readout}>
          {ENVELOPE_PARAMS.map((param) => (
            <View key={param.key} style={styles.stat}>
              <Text style={styles.statLabel}>{param.label}</Text>
              <Text style={styles.statValue}>
                {formatValue(param, values[param.key] ?? param.default)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(theme: AudioTheme) {
  return StyleSheet.create({
    canvas: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      overflow: 'hidden',
    },
    touch: {
      position: 'absolute',
      width: HANDLE_TOUCH,
      height: HANDLE_TOUCH,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      width: HANDLE_RADIUS * 2,
      height: HANDLE_RADIUS * 2,
      borderRadius: HANDLE_RADIUS,
      borderWidth: 2.5,
      borderColor: theme.accent,
    },
    dotHollow: { backgroundColor: theme.control },
    dotFilled: { backgroundColor: theme.accent, borderColor: theme.surface },
    readout: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: 10,
      paddingHorizontal: 4,
    },
    stat: { alignItems: 'center', gap: 2 },
    statLabel: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 9,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    statValue: {
      color: theme.text,
      fontFamily: theme.fontFamily,
      fontSize: 12,
      fontWeight: '600',
    },
  });
}
