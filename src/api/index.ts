export { AudioEngine, type OscillatorConfig } from './AudioEngine';
export { Effect } from './Effect';
export type { EffectLike } from './EffectLike';
export { LFO } from './LFO';
export type { LFOOptions, LFOShape, LFOTarget } from './LFO';
export { PolySynth, VoiceStackEffect } from './PolySynth';
export type { PlayMode, PolySynthOptions } from './PolySynth';
export {
  applyChain,
  captureChain,
  PresetStore,
  type ChainPreset,
  type PresetEffect,
  type PresetStorage,
  type PresetStoreOptions,
} from './PresetStore';
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
