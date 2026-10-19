/**
 * Visual tokens for the control kit.
 *
 * Audio plugins are conventionally dark — a bright panel behind a meter makes
 * level hard to read — so the default theme is dark, with a light variant for
 * apps that need it. Override per-component via the `theme` prop or wrap a
 * subtree in {@link ThemeProvider}.
 */

import { createContext, useContext } from 'react';
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

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

  /**
   * Neumorphic shading.
   *
   * The look depends on a surface sitting between two light sources: a
   * highlight above-left and a shadow below-right, both low contrast against
   * the background. React Native allows one shadow per view, so a raised
   * element is two stacked views — see {@link neuroRaised}.
   */
  shadowDark: string;
  shadowLight: string;
  /** Depth multiplier. 0 disables the effect entirely. */
  depth: number;

  /** Display face, for headings and readouts. */
  fontFamily?: string;
  /** Monospaced face for numeric readouts, so digits do not jitter. */
  monoFontFamily?: string;
}

/**
 * Type faces.
 *
 * Avenir Next and Roboto are present on their platforms without bundling a
 * font, and both have the slightly condensed, even-width feel that suits
 * small control labels. Numeric readouts use a monospaced face so a value
 * does not shift sideways as its digits change under a drag.
 */
const FONTS = {
  fontFamily: Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-medium',
    default: undefined,
  }),
  monoFontFamily: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: undefined,
  }),
};

/**
 * Violet on near-black.
 *
 * The greys carry a violet cast rather than being neutral, which is what
 * stops a dark panel reading as flat grey, and the signal colours are
 * desaturated to sit with it — a pure red clip indicator against pastel
 * violet looks like it belongs to a different app. The meter colours stay
 * distinguishable from each other because that distinction is the whole
 * point of a meter.
 */
export const darkTheme: AudioTheme = {
  surface: '#13101b',
  control: '#1d1829',
  track: '#2b2440',
  accent: '#b49bff',
  pointer: '#ece7f7',
  text: '#ece7f7',
  textMuted: '#8d84a8',
  disabled: '#473f5e',
  meterLow: '#8fe3c4',
  meterMid: '#efd3a0',
  meterHigh: '#f0a0b6',
  waveform: '#473f66',
  waveformPlayed: '#b49bff',
  radius: 14,
  shadowDark: '#07050c',
  shadowLight: '#2a2340',
  depth: 1,
  ...FONTS,
};

/** The same violet family on a warm off-white. */
export const lightTheme: AudioTheme = {
  surface: '#f2effa',
  control: '#faf8ff',
  track: '#ddd6f0',
  accent: '#7c5cff',
  pointer: '#2a2340',
  text: '#201a33',
  textMuted: '#6f6790',
  disabled: '#b7afcc',
  meterLow: '#3fae87',
  meterMid: '#c99a3e',
  meterHigh: '#d1657f',
  waveform: '#b9b0d4',
  waveformPlayed: '#7c5cff',
  radius: 14,
  shadowDark: '#cdc5e2',
  shadowLight: '#ffffff',
  depth: 1,
  ...FONTS,
};

/**
 * Outer half of a raised surface: the dark shadow, below-right.
 *
 * Wrap content in a view with this, then a view with {@link neuroInner}, then
 * the content. Two views because React Native supports only one shadow each.
 */
export function neuroRaised(theme: AudioTheme, radius?: number): ViewStyle {
  if (theme.depth <= 0) {
    return {};
  }
  return {
    borderRadius: radius ?? theme.radius,
    backgroundColor: theme.control,
    shadowColor: theme.shadowDark,
    shadowOffset: { width: 4 * theme.depth, height: 4 * theme.depth },
    shadowOpacity: 0.9,
    shadowRadius: 8 * theme.depth,
    // Android has no offset shadow, so elevation is the closest equivalent.
    elevation: 6 * theme.depth,
  };
}

/** Inner half of a raised surface: the light highlight, above-left. */
export function neuroInner(theme: AudioTheme, radius?: number): ViewStyle {
  if (theme.depth <= 0) {
    return { borderRadius: radius ?? theme.radius };
  }
  return {
    borderRadius: radius ?? theme.radius,
    backgroundColor: theme.control,
    shadowColor: theme.shadowLight,
    shadowOffset: { width: -3 * theme.depth, height: -3 * theme.depth },
    shadowOpacity: 0.55,
    shadowRadius: 6 * theme.depth,
  };
}

/**
 * A pressed or recessed surface.
 *
 * True inner shadows do not exist in React Native, so this fakes the read
 * with a hairline border: light along the bottom-right, dark along the
 * top-left — the inverse of a raised element.
 */
export function neuroInset(theme: AudioTheme, radius?: number): ViewStyle {
  return {
    borderRadius: radius ?? theme.radius,
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderTopColor: theme.shadowDark,
    borderLeftColor: theme.shadowDark,
    borderBottomColor: theme.shadowLight,
    borderRightColor: theme.shadowLight,
  };
}

/** Label styling shared by every control: small, spaced, uppercase. */
export function labelStyle(theme: AudioTheme): TextStyle {
  return {
    fontFamily: theme.fontFamily,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: theme.textMuted,
  };
}

/** Numeric readout styling: monospaced so digits do not jitter. */
export function readoutStyle(theme: AudioTheme): TextStyle {
  return {
    fontFamily: theme.monoFontFamily,
    fontSize: 11,
    letterSpacing: 0.2,
    color: theme.text,
  };
}

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
