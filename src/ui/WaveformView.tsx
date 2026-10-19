/**
 * Waveform display with a playhead and scrub-to-seek.
 *
 * Draws the min/max peak array that `loadFile` returns — computed once at
 * decode time rather than streamed, because a waveform never changes and
 * sending it repeatedly would be pure bridge traffic.
 */

import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path, Rect } from 'react-native-svg';

import { useAudioTheme, type AudioTheme } from './theme';

export interface WaveformViewProps {
  /** Interleaved min/max pairs in -1..1, from `Source.info.peaks`. */
  peaks: readonly number[];
  /** Playback position as a fraction, 0..1. */
  progress?: number;
  /** Called with a 0..1 fraction when the user scrubs. */
  onSeek?: (progress: number) => void;
  height?: number;
  theme?: Partial<AudioTheme>;
}

/**
 * Build a filled outline from min/max pairs.
 *
 * Traces the maxima left to right and the minima back right to left, so the
 * result is one closed shape rather than a few thousand separate bars.
 */
function buildPath(
  peaks: readonly number[],
  width: number,
  height: number
): string {
  const pairCount = Math.floor(peaks.length / 2);
  if (pairCount === 0 || width <= 0) {
    return '';
  }

  const midline = height / 2;
  const scale = height / 2;
  const step = width / pairCount;

  let top = '';
  let bottom = '';
  for (let i = 0; i < pairCount; i++) {
    const x = i * step;
    const minimum = peaks[i * 2] ?? 0;
    const maximum = peaks[i * 2 + 1] ?? 0;
    top += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${(midline - maximum * scale).toFixed(2)} `;
    // Prepended so the return leg runs right to left.
    bottom =
      `L ${x.toFixed(2)} ${(midline - minimum * scale).toFixed(2)} ` + bottom;
  }
  return `${top}${bottom}Z`;
}

export function WaveformView({
  peaks,
  progress = 0,
  onSeek,
  height = 72,
  theme: themeOverride,
}: WaveformViewProps) {
  const theme = useAudioTheme(themeOverride);
  const [width, setWidth] = useState(0);

  // Rebuilding this on every progress tick would be wasteful; it only depends
  // on the data and the width.
  const path = useMemo(
    () => buildPath(peaks, width, height),
    [peaks, width, height]
  );

  const seekTo = useCallback(
    (x: number) => {
      if (width > 0) {
        onSeek?.(Math.min(1, Math.max(0, x / width)));
      }
    },
    [onSeek, width]
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(Boolean(onSeek) && width > 0)
        .onBegin((event) => {
          'worklet';
          runOnJSSeek(seekTo, event.x);
        })
        .onUpdate((event) => {
          'worklet';
          runOnJSSeek(seekTo, event.x);
        }),
    [onSeek, seekTo, width]
  );

  const clampedProgress = Math.min(1, Math.max(0, progress));

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.container, { height, borderRadius: theme.radius }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Waveform"
        accessibilityValue={{
          now: Math.round(clampedProgress * 100),
          min: 0,
          max: 100,
        }}
      >
        <Svg width={width} height={height}>
          <Path d={path} fill={theme.waveform} />
          {/* The played portion is the same shape, clipped to the playhead. */}
          <Path d={path} fill={theme.waveformPlayed} clipPath="url(#played)" />
          <Rect
            x={0}
            y={0}
            width={width * clampedProgress}
            height={height}
            fill={theme.waveformPlayed}
            opacity={0.25}
          />
          <Rect
            x={Math.max(0, width * clampedProgress - 1)}
            y={0}
            width={2}
            height={height}
            fill={theme.accent}
          />
        </Svg>
      </View>
    </GestureDetector>
  );
}

/**
 * Hop to the JS thread from the gesture worklet.
 *
 * Extracted so the `runOnJS` import stays local to the one place that needs
 * it and the gesture callbacks read cleanly.
 */
function runOnJSSeek(seek: (x: number) => void, x: number) {
  'worklet';

  const { runOnJS } = require('react-native-reanimated');
  runOnJS(seek)(x);
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
  },
});
