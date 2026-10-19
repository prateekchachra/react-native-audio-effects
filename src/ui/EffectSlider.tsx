/**
 * Horizontal slider that honours a parameter's taper.
 *
 * The handle position is the *normalised* value, so a log-tapered frequency
 * control gives equal travel per octave instead of cramming everything
 * musically useful into the first two percent.
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
import {
  labelStyle,
  neuroInset,
  readoutStyle,
  useAudioTheme,
  type AudioTheme,
} from './theme';

const TRACK_HEIGHT = 4;
const HANDLE_SIZE = 18;

export interface EffectSliderProps {
  param: ParamDescriptor;
  value: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  disabled?: boolean;
  label?: string;
  showLabel?: boolean;
  showValue?: boolean;
  theme?: Partial<AudioTheme>;
}

function clampWorklet(value: number, min: number, max: number) {
  'worklet';
  return value < min ? min : value > max ? max : value;
}

export function EffectSlider({
  param,
  value,
  onChange,
  onChangeEnd,
  disabled = false,
  label,
  showLabel = true,
  showValue = true,
  theme: themeOverride,
}: EffectSliderProps) {
  const theme = useAudioTheme(themeOverride);
  const [width, setWidth] = useState(0);

  const normalized = toNormalized(param, value);
  const position = useSharedValue(normalized);
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
        .enabled(!disabled && width > 0)
        .onBegin((event) => {
          // Tap-to-seek: jump to wherever the finger landed, then drag from
          // there, which is what a mixer fader does.
          const next = clampWorklet(event.x / width, 0, 1);
          position.value = next;
          gestureStart.value = next;
          runOnJS(emit)(next, false);
        })
        .onUpdate((event) => {
          const next = clampWorklet(
            gestureStart.value + event.translationX / width,
            0,
            1
          );
          position.value = next;
          runOnJS(emit)(next, false);
        })
        .onFinalize(() => {
          runOnJS(emit)(position.value, true);
        }),
    [disabled, emit, gestureStart, position, width]
  );

  const fillStyle = useAnimatedStyle(() => ({
    width: `${position.value * 100}%`,
  }));

  const handleStyle = useAnimatedStyle(() => ({
    left: position.value * Math.max(width - HANDLE_SIZE, 0),
  }));

  const accent = disabled ? theme.disabled : theme.accent;

  return (
    <View style={styles.container}>
      {(showLabel || showValue) && (
        <View style={styles.header}>
          {showLabel ? (
            <Text style={labelStyle(theme)}>{label ?? param.label}</Text>
          ) : null}
          {showValue ? (
            <Text
              style={[
                readoutStyle(theme),
                styles.value,
                disabled && { color: theme.disabled },
              ]}
            >
              {formatValue(param, value)}
            </Text>
          ) : null}
        </View>
      )}

      <GestureDetector gesture={gesture}>
        <View
          style={styles.hitArea}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label ?? param.label}
          accessibilityValue={{ text: formatValue(param, value) }}
          accessibilityState={{ disabled }}
        >
          <View style={[styles.track, neuroInset(theme, TRACK_HEIGHT / 2)]}>
            <Animated.View
              style={[styles.fill, { backgroundColor: accent }, fillStyle]}
            />
          </View>
          <Animated.View
            style={[
              styles.handle,
              {
                backgroundColor: disabled ? theme.disabled : theme.pointer,
                borderColor: theme.surface,
              },
              handleStyle,
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  // Taller than the track so the control is comfortably touchable.
  hitArea: {
    height: 32,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2,
  },
});
