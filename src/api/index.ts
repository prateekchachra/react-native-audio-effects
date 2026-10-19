export { AudioEngine, type OscillatorConfig } from './AudioEngine';
export { Effect } from './Effect';
export { LFO } from './LFO';
export type { LFOOptions, LFOShape, LFOTarget } from './LFO';
export { PolySynth } from './PolySynth';
export type { PlayMode, PolySynthOptions } from './PolySynth';
export { Source, type SourceInfo } from './Source';
export {
  getCapabilities,
  isEffectAvailable,
  isGeneratorAvailable,
  isParamAvailable,
  resetCapabilitiesCache,
  type Capabilities,
} from './capabilities';
export {
  AudioEffectsError,
  AudioFileError,
  EffectUnavailableError,
  type AudioErrorCode,
} from './errors';
