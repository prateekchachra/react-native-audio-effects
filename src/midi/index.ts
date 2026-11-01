/**
 * MIDI input.
 *
 * Decoding lives here rather than in the native backends so that there is
 * one implementation of the awkward parts — running status, zero-velocity
 * note offs, real-time bytes arriving mid-message — tested once and shared
 * by both platforms.
 */

export {
  MidiStream,
  channelLabel,
  normalizeBend,
  normalizeVelocity,
  MAX_VELOCITY,
  PITCH_BEND_CENTRE,
  PITCH_BEND_MAX,
  type MidiMessage,
} from './messages';

export {
  MidiInput,
  type MidiDeviceInfo,
  type MidiListener,
  type RouteOptions,
  type Unsubscribe,
} from './MidiInput';
