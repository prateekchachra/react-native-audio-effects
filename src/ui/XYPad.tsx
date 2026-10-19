/**
 * Two-dimensional control surface.
 *
 * Both axes are written in a single batched call so they land in the same
 * audio cycle. Setting them one at a time lets the DSP observe a half-moved
 * puck, which on a filter reads as a click.
 */

import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import {
  formatValue,
  fromNormalized,
  quantize,
  toNormalized,
  type ParamDescriptor,
} from '../schema';
import { useAudioTheme, type AudioTheme } from './theme';

const PUCK_SIZE = 28;

export interface XYPadProps {
  xParam: ParamDescriptor;
  yParam: ParamDescriptor;
  xValue: number;
  yValue: number;
  /** Called with both axes together; forward to `Effect.setMany`. */
  onChange: (next: { x: number; y: number }) => void;
  onChangeEnd?: (next: { x: number; y: number }) => void;
  height?: number;
  disabled?: boolean;
  theme?: Partial<AudioTheme>;
}

function clampWorklet(value: number, min: number, max: number) {
  'worklet';
  return value < min ? min : value > max ? max : value;
}

export function XYPad({
  xParam,
  yParam,
  xValue,
  yValue,
  onChange,
  onChangeEnd,
  height = 180,
  disabled = false,
  theme: themeOverride,
}: XYPadProps) {
  const theme = useAudioTheme(themeOverride);
  const [size, setSize] = useState({ width: 0, height });

  const nx = toNormalized(xParam, xValue);
  const ny = toNormalized(yParam, yValue);
  const px = useSharedValue(nx);
  const py = useSharedValue(ny);
  px.value = nx;
  py.value = ny;

  const emit = useCallback(
    (normX: number, normY: number, isFinal: boolean) => {
      const next = {
        x: quantize(xParam, fromNormalized(xParam, normX)),
        y: quantize(yParam, fromNormalized(yParam, normY)),
      };
      onChange(next);
      if (isFinal) {
        onChangeEnd?.(next);
      }
    },
    [xParam, yParam, onChange, onChangeEnd]
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && size.width > 0)
        .onBegin((event) => {
          const x = clampWorklet(event.x / size.width, 0, 1);
          // Screen y grows downward; audio controls grow upward.
          const y = clampWorklet(1 - event.y / size.height, 0, 1);
          px.value = x;
          py.value = y;
          runOnJS(emit)(x, y, false);
        })
        .onUpdate((event) => {
          const x = clampWorklet(event.x / size.width, 0, 1);
          const y = clampWorklet(1 - event.y / size.height, 0, 1);
          px.value = x;
          py.value = y;
          runOnJS(emit)(x, y, false);
        })
        .onFinalize(() => {
          runOnJS(emit)(px.value, py.value, true);
        }),
    [disabled, emit, px, py, size.height, size.width]
  );

  const puckStyle = useAnimatedStyle(() => ({
    left: px.value * Math.max(size.width - PUCK_SIZE, 0),
    top: (1 - py.value) * Math.max(size.height - PUCK_SIZE, 0),
  }));

  const crossV = useAnimatedStyle(() => ({
    left: px.value * Math.max(size.width - 1, 0),
  }));

  const crossH = useAnimatedStyle(() => ({
    top: (1 - py.value) * Math.max(size.height - 1, 0),
  }));

  const accent = disabled ? theme.disabled : theme.accent;

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View
          onLayout={(event) =>
            setSize({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })
          }
          style={[
            styles.pad,
            {
              height,
              backgroundColor: theme.control,
              borderColor: theme.track,
              borderRadius: theme.radius,
            },
          ]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${xParam.label} and ${yParam.label}`}
          accessibilityValue={{
            text: `${formatValue(xParam, xValue)}, ${formatValue(yParam, yValue)}`,
          }}
          accessibilityState={{ disabled }}
        >
          <Animated.View
            style={[
              styles.crosshairV,
              { backgroundColor: theme.track },
              crossV,
            ]}
          />
          <Animated.View
            style={[
              styles.crosshairH,
              { backgroundColor: theme.track },
              crossH,
            ]}
          />
          <Animated.View
            style={[
              styles.puck,
              { backgroundColor: accent, borderColor: theme.surface },
              puckStyle,
            ]}
          />
        </View>
      </GestureDetector>

      <View style={styles.readout}>
        <Text style={[styles.axis, { color: theme.textMuted }]}>
          {xParam.label} {formatValue(xParam, xValue)}
        </Text>
        <Text style={[styles.axis, { color: theme.textMuted }]}>
          {yParam.label} {formatValue(yParam, yValue)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    width: '100%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    top: 0,
    bottom: 0,
  },
  crosshairH: {
    position: 'absolute',
    height: 1,
    left: 0,
    right: 0,
  },
  puck: {
    position: 'absolute',
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    borderRadius: PUCK_SIZE / 2,
    borderWidth: 2,
  },
  readout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  axis: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
