/**
 * MIDI input devices, and getting them to play something.
 *
 * The native side reports raw bytes; {@link MidiStream} turns them into
 * messages; this joins the two and offers {@link routeTo}, which wires a
 * controller to a {@link PolySynth} so that plugging in a keyboard and
 * playing it is three lines rather than a switch statement.
 */

import NativeAudioEffects, { type MidiDeviceInfo } from '../NativeAudioEffects';
import type { PolySynth } from '../api/PolySynth';
import {
  MidiStream,
  normalizeBend,
  normalizeVelocity,
  type MidiMessage,
} from './messages';

export type { MidiDeviceInfo };

/** Called for every decoded message, with the device it came from. */
export type MidiListener = (message: MidiMessage, deviceId: string) => void;

/** Undo a subscription. */
export type Unsubscribe = () => void;

/**
 * One decoder per device.
 *
 * Running status is per-stream state: two controllers sending at once
 * through a single decoder would each inherit the other's status byte and
 * produce notes neither of them played.
 */
const streams = new Map<string, MidiStream>();
const listeners = new Set<MidiListener>();
let dataSubscription: { remove: () => void } | undefined;

function streamFor(deviceId: string): MidiStream {
  let stream = streams.get(deviceId);
  if (!stream) {
    stream = new MidiStream();
    streams.set(deviceId, stream);
  }
  return stream;
}

function ensureSubscribed(): void {
  if (dataSubscription) {
    return;
  }
  dataSubscription = NativeAudioEffects.onMidiData((event) => {
    const messages = streamFor(event.deviceId).push(event.data);
    for (const message of messages) {
      for (const listener of listeners) {
        listener(message, event.deviceId);
      }
    }
  });
}

export const MidiInput = {
  /**
   * Open or close the MIDI client.
   *
   * Nothing is enumerated or delivered until this is on. On iOS it is
   * also what can provoke the Bluetooth permission prompt, so an app
   * that never calls it never asks the user for anything.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await NativeAudioEffects.setMidiEnabled(enabled);
    if (enabled) {
      ensureSubscribed();
    } else {
      dataSubscription?.remove();
      dataSubscription = undefined;
      streams.clear();
    }
  },

  /** Every MIDI input the system can currently see. */
  list(): Promise<MidiDeviceInfo[]> {
    return NativeAudioEffects.listMidiDevices();
  },

  async connect(deviceId: string): Promise<void> {
    await NativeAudioEffects.connectMidiDevice(deviceId);
    ensureSubscribed();
  },

  async disconnect(deviceId: string): Promise<void> {
    await NativeAudioEffects.disconnectMidiDevice(deviceId);
    // A reconnecting device should not inherit a half-read message from
    // whenever it was last unplugged.
    streams.get(deviceId)?.reset();
    streams.delete(deviceId);
  },

  /**
   * Show the system Bluetooth MIDI pairing sheet. iOS only.
   *
   * There is no Settings pane for BLE MIDI peripherals, so this system
   * view is the only way to pair one — every app that supports wireless
   * controllers presents this same sheet.
   */
  presentBluetoothPairing(): Promise<void> {
    return NativeAudioEffects.presentBluetoothMidiPairing();
  },

  /** Listen to every decoded message from every connected device. */
  addListener(listener: MidiListener): Unsubscribe {
    listeners.add(listener);
    ensureSubscribed();
    return () => {
      listeners.delete(listener);
    };
  },

  /** Fires when a device is attached, removed or renamed. */
  onDevicesChanged(listener: () => void): Unsubscribe {
    const subscription = NativeAudioEffects.onMidiDevicesChanged(() =>
      listener()
    );
    return () => subscription.remove();
  },

  /**
   * Play a synth from a MIDI controller.
   *
   * Returns the unsubscribe function, which also releases anything still
   * held — a controller unplugged mid-chord otherwise leaves the notes
   * sounding forever, with no key left to lift.
   */
  routeTo(synth: PolySynth, options: RouteOptions = {}): Unsubscribe {
    const {
      channel,
      velocityCurve = (value) => value,
      bendSemitones = 2,
      onControlChange,
    } = options;

    const stop = this.addListener((message) => {
      // Channel filtering happens here rather than natively so that a
      // single connection can feed several synths on different channels.
      if (
        channel !== undefined &&
        'channel' in message &&
        message.channel !== channel
      ) {
        return;
      }

      switch (message.type) {
        case 'noteOn':
          synth.noteOn(message.note, {
            velocity: velocityCurve(normalizeVelocity(message.velocity)),
            // Hardware sends its own note off, so a repeated note is a
            // retrigger rather than the touchscreen's tap-to-release.
            retrigger: true,
          });
          break;

        case 'noteOff':
          synth.noteOff(message.note);
          break;

        case 'pitchBend':
          synth.setPitchBend(normalizeBend(message.value) * bendSemitones);
          break;

        case 'controlChange':
          // 123 is All Notes Off and 120 is All Sound Off. Honouring them
          // is what makes a controller's panic button work.
          if (message.controller === 123 || message.controller === 120) {
            synth.allNotesOff();
          }
          onControlChange?.(message.controller, message.value / 127);
          break;

        case 'reset':
          synth.allNotesOff();
          break;

        default:
          break;
      }
    });

    return () => {
      stop();
      synth.allNotesOff();
    };
  },
};

export interface RouteOptions {
  /** Only listen to this channel, 0–15. Omit to accept all of them. */
  channel?: number;
  /**
   * Reshape velocity before it reaches the synth.
   *
   * A linear map is rarely what a player wants: most controllers make it
   * hard to reach the extremes, so a gentle curve here is the difference
   * between a keyboard that feels responsive and one that does not.
   */
  velocityCurve?: (velocity: number) => number;
  /** How far the wheel bends at full travel. Two semitones is the norm. */
  bendSemitones?: number;
  /** Any other controller: number, and value normalised to 0–1. */
  onControlChange?: (controller: number, value: number) => void;
}
