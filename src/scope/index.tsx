/**
 * Canvas-rendered visualisers.
 *
 * Separate from `react-native-audio-effects/ui` because these need
 * `@shopify/react-native-skia`, which is an optional peer dependency.
 * Importing the UI kit must not drag a second graphics native module
 * into apps that only want knobs.
 */

export { OscillatorScope } from './OscillatorScope';
export type { OscillatorScopeProps } from './OscillatorScope';
