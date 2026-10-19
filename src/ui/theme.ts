/**
 * Visual tokens for the control kit.
 *
 * Audio plugins are conventionally dark — a bright panel behind a meter makes
 * level hard to read — so the default theme is dark, with a light variant for
 * apps that need it. Override per-component via the `theme` prop or wrap a
 * subtree in {@link ThemeProvider}.
 */

import { createContext, useContext } from 'react';

export interface AudioTheme {
  /** Panel background. */
  surface: string;
  /** Raised control background (knob body, slider track well). */
  control: string;
  /** Unfilled portion of an arc or track. */
  track: string;
  /** Filled portion: the value indicator. */
  accent: string;
  /** Secondary accent, used for the pointer line and handles. */
  pointer: string;
  /** Primary text. */
  text: string;
  /** Labels and units. */
  textMuted: string;
  /** Applied to everything when a control is disabled. */
  disabled: string;
  /** Meter gradient stops, quiet to loud. */
  meterLow: string;
  meterMid: string;
  meterHigh: string;
  /** Waveform body. */
  waveform: string;
  /** Played portion of a waveform. */
  waveformPlayed: string;
  radius: number;
  fontFamily?: string;
}

export const darkTheme: AudioTheme = {
  surface: '#15171c',
  control: '#22252d',
  track: '#32363f',
  accent: '#4ea1ff',
  pointer: '#e8eaf0',
  text: '#e8eaf0',
  textMuted: '#878c99',
  disabled: '#4a4e58',
  meterLow: '#3ddc84',
  meterMid: '#f5c451',
  meterHigh: '#ff5c5c',
  waveform: '#4a5160',
  waveformPlayed: '#4ea1ff',
  radius: 8,
};

export const lightTheme: AudioTheme = {
  surface: '#f3f4f7',
  control: '#ffffff',
  track: '#d9dce3',
  accent: '#1f7ae0',
  pointer: '#2b2f38',
  text: '#1b1e25',
  textMuted: '#6b7180',
  disabled: '#b9bdc7',
  meterLow: '#1faa5f',
  meterMid: '#d79b1b',
  meterHigh: '#d93b3b',
  waveform: '#aeb4c0',
  waveformPlayed: '#1f7ae0',
  radius: 8,
};

const ThemeContext = createContext<AudioTheme>(darkTheme);

export const ThemeProvider = ThemeContext.Provider;

/** Resolve the active theme, with optional per-component overrides. */
export function useAudioTheme(overrides?: Partial<AudioTheme>): AudioTheme {
  const base = useContext(ThemeContext);
  if (!overrides) {
    return base;
  }
  return { ...base, ...overrides };
}
