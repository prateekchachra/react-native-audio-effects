/**
 * Rotary knob.
 *
 * ## Why vertical drag rather than rotation
 *
 * Tracking a finger's angle around a small circle is imprecise and breaks
 * down entirely near the centre. Every serious plugin host uses vertical
 * drag instead, and so does this.
 *
 * ## Why the gesture runs on the UI thread
 *
 * The drag is a Gesture Handler worklet writing a Reanimated shared value, so
 * the knob keeps tracking the finger at display rate even when the JS thread
 * is busy decoding a file or re-rendering a rack. Only the resulting parameter
 * write crosses to JS, and it is coalesced to one call per frame.
 *
 * The shared value holds the *normalised* position, so the arc can be drawn
 * without running taper maths in a worklet; the taper is applied once on the
 * JS side when converting to a real value.
 */

import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import {
  clamp,
  formatValue,
  fromNormalized,
  quantize,
  toNormalized,
  type ParamDescriptor,
} from '../schema';
import {
  labelStyle,
  neuroInner,
  neuroRaised,
  readoutStyle,
  useAudioTheme,
  type AudioTheme,
} from './theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);

/** Travel, in points, for a full sweep of the range. */
const FULL_SWEEP_PX = 180;
/** Horizontal distance after which the drag becomes fine. */
const FINE_MODE_PX = 60;
/** Fine mode multiplier: a quarter speed for setting precise values. */
const FINE_SCALE = 0.25;
/** Arc sweep, degrees. 270 is the plugin convention: a gap at the bottom. */
const ARC_DEGREES = 270;

export interface KnobProps {
  /** Schema descriptor; supplies range, taper, unit and label. */
  param: ParamDescriptor;
  value: number;
  onChange: (value: number) => void;
  /** Called once when the gesture ends, for undo or preset bookkeeping. */
  onChangeEnd?: (value: number) => void;
  size?: number;
  disabled?: boolean;
  label?: string;
  showLabel?: boolean;
  showValue?: boolean;
  theme?: Partial<AudioTheme>;
}

/**
 * Geometry helpers.
 *
 * These are deliberately self-contained — no calls out to other helpers, only
 * `Math`. `arcPath` runs in two places: on the UI thread inside
 * `useAnimatedProps`, and on the JS thread during render to draw the static
 * track. A worklet that calls another worklet is not resolvable in the second
 * case, which crashes with "undefined is not a function" the moment a knob
 * first renders. Inlining the arithmetic keeps both call sites valid.
 */

/** SVG arc path from the knob's zero position to `normalized`. */
function arcPath(
  cx: number,
  cy: number,
  radius: number,
  normalized: number
): string {
  'worklet';
  const t = normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
  const startAngle = 180 - ARC_DEGREES / 2;
  const sweep = ARC_DEGREES * t;
  // A zero-length arc renders nothing; nudge so the cap still shows.
  const endAngle = startAngle + Math.max(sweep, 0.001);

  const startRad = ((startAngle - 90) * Math.PI) / 180;
  const endRad = ((endAngle - 90) * Math.PI) / 180;
  const x1 = cx + radius * Math.cos(startRad);
  const y1 = cy + radius * Math.sin(startRad);
  const x2 = cx + radius * Math.cos(endRad);
  const y2 = cy + radius * Math.sin(endRad);
  const largeArc = sweep > 180 ? 1 : 0;

  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
}

export function Knob({
  param,
  value,
  onChange,
  onChangeEnd,
  size = 64,
  disabled = false,
  label,
  showLabel = true,
  showValue = true,
  theme: themeOverride,
}: KnobProps) {
  const theme = useAudioTheme(themeOverride);

  const normalized = toNormalized(param, value);
  // Mirrors `normalized` on the UI thread so the gesture can move the arc
  // without waiting for a React render.
  const position: SharedValue<number> = useSharedValue(normalized);
  const gestureStart = useSharedValue(0);
  position.value = normalized;

  const emit = useCallback(
    (next: number, isFinal: boolean) => {
      const real = quantize(param, fromNormalized(param, next));
      onChange(real);
      if (isFinal) {
        onChangeEnd?.(real);
      }
    },
    [param, onChange, onChangeEnd]
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .onBegin(() => {
          gestureStart.value = position.value;
        })
        .onUpdate((event) => {
          // Up is louder/brighter/more, matching every hardware control.
          const scale =
            Math.abs(event.translationX) > FINE_MODE_PX ? FINE_SCALE : 1;
          const delta = (-event.translationY / FULL_SWEEP_PX) * scale;
          const raw = gestureStart.value + delta;
          const next = raw < 0 ? 0 : raw > 1 ? 1 : raw;
          position.value = next;
          runOnJS(emit)(next, false);
        })
        .onFinalize(() => {
          runOnJS(emit)(position.value, true);
        }),
    [disabled, emit, gestureStart, position]
  );

  // Double tap restores the schema default — the standard plugin gesture for
  // "undo whatever I just did to this control".
  const resetGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .enabled(!disabled)
        .onEnd(() => {
          const next = toNormalized(param, param.default);
          position.value = next;
          runOnJS(emit)(next, true);
        }),
    [disabled, emit, param, position]
  );

  const composed = useMemo(
    () => Gesture.Exclusive(resetGesture, gesture),
    [resetGesture, gesture]
  );

  const center = size / 2;
  const radius = center - 6;

  const animatedArc = useAnimatedProps(() => ({
    d: arcPath(center, center, radius, position.value),
  }));

  const animatedPointer = useAnimatedProps(() => {
    const angle = 180 - ARC_DEGREES / 2 + ARC_DEGREES * position.value;
    const radians = ((angle - 90) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const outerRadius = radius - 4;
    const innerRadius = radius * 0.45;
    return {
      x1: center + innerRadius * cos,
      y1: center + innerRadius * sin,
      x2: center + outerRadius * cos,
      y2: center + outerRadius * sin,
    };
  });

  const strokeColor = disabled ? theme.disabled : theme.accent;
  const pointerColor = disabled ? theme.disabled : theme.pointer;
  const textColor = disabled ? theme.disabled : theme.text;

  return (
    <View style={styles.container}>
      <GestureDetector gesture={composed}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label ?? param.label}
          accessibilityValue={{ text: formatValue(param, value) }}
          accessibilityState={{ disabled }}
          // Two nested views because a React Native view carries one shadow,
          // and the neumorphic read needs a dark one below-right and a light
          // one above-left.
          style={[neuroRaised(theme, size / 2), disabled && styles.flat]}
        >
          <View style={neuroInner(theme, size / 2)}>
            <Svg width={size} height={size}>
              {/* Unfilled travel */}
              <Path
                d={arcPath(center, center, radius, 1)}
                stroke={theme.track}
                strokeWidth={4}
                strokeLinecap="round"
                fill="none"
              />
              <AnimatedPath
                animatedProps={animatedArc}
                stroke={strokeColor}
                strokeWidth={4}
                strokeLinecap="round"
                fill="none"
              />
              <Circle
                cx={center}
                cy={center}
                r={radius * 0.62}
                fill={disabled ? theme.disabled : theme.control}
              />
              <AnimatedLine
                animatedProps={animatedPointer}
                stroke={pointerColor}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
          </View>
        </View>
      </GestureDetector>

      {showValue ? (
        <Text
          style={[readoutStyle(theme), styles.value, { color: textColor }]}
          numberOfLines={1}
        >
          {formatValue(param, value)}
        </Text>
      ) : null}

      {showLabel ? (
        <Text
          style={[
            labelStyle(theme),
            styles.label,
            disabled && { color: theme.disabled },
          ]}
          numberOfLines={1}
        >
          {label ?? param.label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  value: {
    marginTop: 10,
    fontVariant: ['tabular-nums'],
  },
  label: {
    marginTop: 3,
  },
  /** A disabled control should not look raised. */
  flat: {
    shadowOpacity: 0,
    elevation: 0,
  },
});

/** Exported for tests and for anyone building a custom control. */
export const knobInternals = { arcPath, clamp };
