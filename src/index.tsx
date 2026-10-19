/**
 * react-native-audio-effects
 *
 * Real-time audio effects, generators and a plugin-style control kit for
 * React Native's New Architecture.
 *
 * The audio API lives here. The UI components are published separately under
 * `react-native-audio-effects/ui` so that apps which only need audio do not
 * pull in Reanimated, Gesture Handler and SVG.
 */

export * from './schema';

export type {
  AudioErrorEvent,
  EngineOptions,
  LevelsEvent,
  LoadedSource,
  OscillatorOptions,
  ParameterChange,
  ProgressEvent,
} from './NativeAudioEffects';
