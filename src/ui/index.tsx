/**
 * Plugin-style controls for react-native-audio-effects.
 *
 * ```tsx
 * import { EffectRack, Knob } from 'react-native-audio-effects/ui';
 * ```
 *
 * Published as a separate entry point because these need
 * `react-native-reanimated`, `react-native-gesture-handler` and
 * `react-native-svg` — optional peer dependencies that apps using only the
 * audio API should not have to install.
 *
 * Every control is driven by a `ParamDescriptor` from the schema, so ranges,
 * curves, units and formatting always match the DSP behind them.
 */

export { EffectPanel, EffectRack } from './EffectRack';
export type { EffectPanelProps, EffectRackProps } from './EffectRack';

export { EffectSlider } from './EffectSlider';
export type { EffectSliderProps } from './EffectSlider';

export { EnvelopeEditor } from './EnvelopeEditor';
export type { EnvelopeEditorProps, EnvelopeKey } from './EnvelopeEditor';

export { Keyboard } from './Keyboard';
export type { KeyboardProps } from './Keyboard';

export { Knob } from './Knob';
export type { KnobProps } from './Knob';

export { LFOPanel } from './LFOPanel';
export type { LFOPanelProps } from './LFOPanel';

export { LevelMeter } from './LevelMeter';
export type { LevelMeterProps } from './LevelMeter';

export { PresetBar } from './PresetBar';
export type { Preset, PresetBarProps, PresetValues } from './PresetBar';

export { PresetPanel } from './PresetPanel';
export type { PresetPanelProps } from './PresetPanel';

export { WaveformView } from './WaveformView';
export type { WaveformViewProps } from './WaveformView';

export { XYPad } from './XYPad';
export type { XYPadProps } from './XYPad';

export { ThemeProvider, darkTheme, lightTheme, useAudioTheme } from './theme';
export type { AudioTheme } from './theme';
