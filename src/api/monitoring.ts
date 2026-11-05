/**
 * Is it safe to listen to the microphone out loud?
 *
 * Live input is the one feature in this library that can make a device
 * misbehave physically. Microphone into speaker is a feedback loop: the
 * speaker's output reaches the microphone, goes round again a few
 * milliseconds later, and within a second or so it is a howl at whatever
 * volume the phone can manage. Adding gain, a long reverb tail or a
 * resonant filter makes it faster and louder.
 *
 * There is no way to make that safe from inside the audio graph, so the
 * library does the next best thing: live sources start muted, and this
 * tells you whether unmuting is a reasonable idea.
 */

import NativeAudioEffects from '../NativeAudioEffects';

/** Outputs where monitoring will not feed back. */
const SAFE_OUTPUTS = [
  'Headphones',
  'HeadsetInOut',
  'BluetoothA2DPOutput',
  'BluetoothHFP',
  'BluetoothLE',
  'USBAudio',
  'LineOut',
  'CarAudio',
];

/**
 * Whether the current output route is private.
 *
 * True for wired and Bluetooth headphones, line out and USB audio. False
 * for the built-in speaker and receiver, which are the routes that feed
 * back.
 *
 * Note that Bluetooth headphones are *safe* but add 150–250 ms of
 * latency, which is far too much to sing against. Safe and usable are
 * different questions; this answers the first.
 */
export function isUsingHeadphones(): boolean {
  return SAFE_OUTPUTS.includes(currentOutputRoute());
}

/**
 * The current output port type, as iOS names it.
 *
 * Read through the audio session rather than cached, because the route
 * changes under you — unplugging headphones mid-session is exactly when
 * this matters, and it is also exactly when a cached answer is wrong.
 */
export function currentOutputRoute(): string {
  return NativeAudioEffects.getOutputRoute();
}
