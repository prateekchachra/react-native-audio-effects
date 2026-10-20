/**
 * react-native-audio-effects
 *
 * Real-time audio effects, generators and a plugin-style control kit for
 * React Native's New Architecture.
 *
 * ```ts
 * import { AudioEngine } from 'react-native-audio-effects';
 *
 * await AudioEngine.configure();
 * await AudioEngine.start();
 *
 * const source = await AudioEngine.loadFile(uri);
 * const delay = await source.addEffect('delay');
 * delay.set('time', 300);
 * delay.set('feedback', 0.4);
 * await source.play({ loop: true });
 * ```
 *
 * The UI components live in `react-native-audio-effects/ui` so that apps
 * which only need audio do not pull in Reanimated, Gesture Handler and SVG.
 */

export * from './api';
export * from './hooks';
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

export {
  SampleAgent,
  attributionFor,
  buildSearchParams,
  parseSampleRequest,
  search,
} from './samples';
export type {
  LoadedSample,
  SampleAgentOptions,
  SampleQuery,
  SampleResult,
  SampleSearch,
  SearchOptions,
} from './samples';
