/**
 * Peak/RMS level meter.
 *
 * ## Why the scale is not linear
 *
 * Amplitude is linear but hearing is not: half amplitude is -6 dB, which is
 * nowhere near half as loud. A linear meter spends most of its length on the
 * top few decibels and shows nothing useful for quiet material, so this maps
 * to decibels over a fixed floor.
 *
 * The peak indicator holds its maximum briefly before falling, which is what
 * makes transients readable — an instantaneous peak is on screen for one
 * frame and invisible in practice.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAudioTheme, type AudioTheme } from './theme';

/** Bottom of the meter, in dBFS. */
const FLOOR_DB = -60;
/** How long a peak marker holds before it starts falling, in ms. */
const PEAK_HOLD_MS = 900;
/** Peak fall rate, in dB per second, once the hold expires. */
const PEAK_FALL_DB_PER_SEC = 24;

export interface LevelMeterProps {
  /** Linear peak amplitude, 0..1. */
  peak: number;
  /** Linear RMS amplitude, 0..1. */
  rms: number;
  orientation?: 'vertical' | 'horizontal';
  /** Thickness across the bar; length is driven by the parent. */
  thickness?: number;
  length?: number;
  showPeakHold?: boolean;
  theme?: Partial<AudioTheme>;
}

/** Linear amplitude to a 0..1 position on the dB scale. */
function amplitudeToPosition(amplitude: number): number {
  if (amplitude <= 0) {
    return 0;
  }
  const db = 20 * Math.log10(amplitude);
  if (db <= FLOOR_DB) {
    return 0;
  }
  return Math.min(1, (db - FLOOR_DB) / -FLOOR_DB);
}

function colorFor(position: number, theme: AudioTheme): string {
  // Thresholds correspond to roughly -12 dB and -3 dB.
  if (position > 0.95) {
    return theme.meterHigh;
  }
  if (position > 0.8) {
    return theme.meterMid;
  }
  return theme.meterLow;
}

export function LevelMeter({
  peak,
  rms,
  orientation = 'vertical',
  thickness = 10,
  length = 120,
  showPeakHold = true,
  theme: themeOverride,
}: LevelMeterProps) {
  const theme = useAudioTheme(themeOverride);

  const rmsPosition = amplitudeToPosition(rms);
  const peakPosition = amplitudeToPosition(peak);

  const [heldPeak, setHeldPeak] = useState(0);
  const heldRef = useRef(0);
  const heldAtRef = useRef(0);

  useEffect(() => {
    if (!showPeakHold) {
      return;
    }
    const now = Date.now();
    if (peakPosition >= heldRef.current) {
      heldRef.current = peakPosition;
      heldAtRef.current = now;
      setHeldPeak(peakPosition);
      return;
    }
    // Decay the marker on the same tick the level arrives, so no extra timer
    // is needed and the meter stops updating when the audio does.
    const elapsed = (now - heldAtRef.current) / 1000;
    if (elapsed * 1000 > PEAK_HOLD_MS) {
      const fallen = Math.max(
        peakPosition,
        heldRef.current - (PEAK_FALL_DB_PER_SEC * elapsed) / -FLOOR_DB
      );
      heldRef.current = fallen;
      setHeldPeak(fallen);
    }
  }, [peakPosition, showPeakHold]);

  const isVertical = orientation === 'vertical';
  const fillPercent = `${rmsPosition * 100}%` as const;
  const markerPercent = `${heldPeak * 100}%` as const;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Output level"
      style={[
        styles.container,
        {
          backgroundColor: theme.track,
          borderRadius: thickness / 2,
          width: isVertical ? thickness : length,
          height: isVertical ? length : thickness,
        },
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            backgroundColor: colorFor(rmsPosition, theme),
            width: isVertical ? '100%' : fillPercent,
            height: isVertical ? fillPercent : '100%',
          },
          isVertical ? styles.fillVertical : styles.fillHorizontal,
        ]}
      />
      {showPeakHold && heldPeak > 0 ? (
        <View
          style={[
            styles.peakMarker,
            {
              backgroundColor: colorFor(heldPeak, theme),
              width: isVertical ? '100%' : 2,
              height: isVertical ? 2 : '100%',
              ...(isVertical
                ? { bottom: markerPercent }
                : { left: markerPercent }),
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
  },
  fillVertical: {
    bottom: 0,
    left: 0,
  },
  fillHorizontal: {
    left: 0,
    top: 0,
  },
  peakMarker: {
    position: 'absolute',
  },
});
