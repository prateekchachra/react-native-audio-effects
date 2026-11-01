/* eslint-disable no-bitwise -- MIDI is a bit-packed wire format: status and
   channel share a byte, and pitch bend is two seven-bit halves. Masking and
   shifting is what reading it *is*, and the arithmetic alternatives are
   slower and far less obvious about intent. */

/**
 * MIDI 1.0 wire format, decoded.
 *
 * ## Why this is TypeScript and not Swift and Kotlin
 *
 * Native could decode its own bytes, and then there would be two decoders
 * to keep in step — each with its own copy of running status, its own
 * idea of what a zero-velocity note on means, and its own bugs. MIDI is
 * small but it is not simple, and the awkward parts are exactly the ones
 * that only show up with a particular controller plugged in.
 *
 * So the native side stays deliberately stupid: it hands over the bytes
 * it was given and a timestamp. Everything below runs once, on every
 * platform, and can be tested exhaustively without a device — which
 * matters here, because the hardware this parses cannot be attached to a
 * simulator at all.
 *
 * ## Values are kept as they arrive
 *
 * Velocity is 0–127 and pitch bend is 0–16383, not 0–1 and -1–1. The
 * conversions people actually want depend on things this layer does not
 * know: whether a synth wants velocity as amplitude or as filter
 * tracking, and what bend range the patch is set to. Normalising early
 * would throw away the raw value and force everything through one
 * opinion about it, so the helpers at the bottom are explicit and the
 * messages stay faithful to the wire.
 *
 * Channels are 0–15, as transmitted. Hardware displays 1–16; that is a
 * presentation choice and {@link channelLabel} makes it.
 */

/** Status nibbles, high four bits of a channel-voice status byte. */
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const POLY_PRESSURE = 0xa0;
const CONTROL_CHANGE = 0xb0;
const PROGRAM_CHANGE = 0xc0;
const CHANNEL_PRESSURE = 0xd0;
const PITCH_BEND = 0xe0;

/** 0xF0–0xF7 are system common; 0xF8–0xFF are system real time. */
const SYSTEM_COMMON = 0xf0;
const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const SYSTEM_REALTIME = 0xf8;

/** Bend sits at the middle of its 14-bit range when the wheel is centred. */
export const PITCH_BEND_CENTRE = 8192;
export const PITCH_BEND_MAX = 16383;
export const MAX_VELOCITY = 127;

export type MidiMessage =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | {
      type: 'controlChange';
      channel: number;
      controller: number;
      value: number;
    }
  /** 0–16383, centred at {@link PITCH_BEND_CENTRE}. */
  | { type: 'pitchBend'; channel: number; value: number }
  | { type: 'programChange'; channel: number; program: number }
  | { type: 'channelPressure'; channel: number; pressure: number }
  | { type: 'polyPressure'; channel: number; note: number; pressure: number }
  | { type: 'clock' }
  | { type: 'start' }
  | { type: 'continue' }
  | { type: 'stop' }
  | { type: 'activeSensing' }
  | { type: 'reset' }
  /** A complete system-exclusive message, framed bytes included. */
  | { type: 'sysex'; bytes: number[] };

/** How many data bytes follow each channel-voice status. */
function dataLengthFor(status: number): number {
  switch (status & 0xf0) {
    case PROGRAM_CHANGE:
    case CHANNEL_PRESSURE:
      return 1;
    default:
      return 2;
  }
}

/**
 * Decoder for a stream of MIDI bytes.
 *
 * Stateful because MIDI is: bytes arrive in whatever chunks the transport
 * felt like, a message can be split across two of them, and running
 * status means a message may not carry its own status byte at all. One
 * instance per device, fed every chunk in order.
 */
export class MidiStream {
  /** Last channel-voice status, for running status. 0 when there is none. */
  private status = 0;
  private data: number[] = [];
  /** Non-null while inside a system-exclusive message. */
  private sysex: number[] | null = null;

  /**
   * Decode a chunk, returning every message it completed.
   *
   * A chunk that ends mid-message returns nothing for it; the remainder
   * is held and finished by the next call.
   */
  push(bytes: readonly number[]): MidiMessage[] {
    const out: MidiMessage[] = [];

    for (const byte of bytes) {
      // Real time is allowed to appear *anywhere*, including between the
      // status and data bytes of another message. It carries no data and
      // must not disturb what is in progress — not the running status,
      // not a half-collected message, not an open sysex.
      if (byte >= SYSTEM_REALTIME) {
        const realtime = decodeRealtime(byte);
        if (realtime) {
          out.push(realtime);
        }
        continue;
      }

      if (this.sysex !== null) {
        this.sysex.push(byte);
        if (byte === SYSEX_END) {
          out.push({ type: 'sysex', bytes: this.sysex });
          this.sysex = null;
        } else if (byte >= 0x80) {
          // A status byte inside sysex means the sender gave up on it.
          // Abandon what we have and reprocess this byte as a new status.
          this.sysex = null;
          this.beginStatus(byte);
        }
        continue;
      }

      if (byte >= 0x80) {
        this.beginStatus(byte);
        continue;
      }

      // A data byte with no status before it — the stream was joined
      // mid-message, which happens when a device is already sending as we
      // connect. Nothing to do but wait for a status byte.
      if (this.status === 0) {
        continue;
      }

      this.data.push(byte);
      if (this.data.length === dataLengthFor(this.status)) {
        const message = decodeChannelVoice(this.status, this.data);
        if (message) {
          out.push(message);
        }
        // Running status: the status stays live, so a stream of notes can
        // omit it. Only the collected data resets.
        this.data = [];
      }
    }

    return out;
  }

  /** Forget any partial message. Call when a device disconnects. */
  reset(): void {
    this.status = 0;
    this.data = [];
    this.sysex = null;
  }

  private beginStatus(byte: number): void {
    this.data = [];

    if (byte === SYSEX_START) {
      this.sysex = [byte];
      // Sysex cancels running status, as does any system common message.
      this.status = 0;
      return;
    }

    if (byte >= SYSTEM_COMMON) {
      // Other system common messages (song position, tune request). Not
      // decoded, but they still clear running status per the spec.
      this.status = 0;
      return;
    }

    this.status = byte;
  }
}

function decodeRealtime(byte: number): MidiMessage | undefined {
  switch (byte) {
    case 0xf8:
      return { type: 'clock' };
    case 0xfa:
      return { type: 'start' };
    case 0xfb:
      return { type: 'continue' };
    case 0xfc:
      return { type: 'stop' };
    case 0xfe:
      return { type: 'activeSensing' };
    case 0xff:
      return { type: 'reset' };
    default:
      return undefined;
  }
}

function decodeChannelVoice(
  status: number,
  data: readonly number[]
): MidiMessage | undefined {
  const channel = status & 0x0f;
  const kind = status & 0xf0;
  const first = data[0] ?? 0;
  const second = data[1] ?? 0;

  switch (kind) {
    case NOTE_ON:
      // A note on with zero velocity is a note off. This is not an
      // obscure corner: it is how running status lets a controller send
      // a whole performance under one status byte, and most keyboards
      // do it. Treating it as a note on leaves every key stuck down.
      return second === 0
        ? { type: 'noteOff', channel, note: first, velocity: 0 }
        : { type: 'noteOn', channel, note: first, velocity: second };

    case NOTE_OFF:
      return { type: 'noteOff', channel, note: first, velocity: second };

    case POLY_PRESSURE:
      return {
        type: 'polyPressure',
        channel,
        note: first,
        pressure: second,
      };

    case CONTROL_CHANGE:
      return {
        type: 'controlChange',
        channel,
        controller: first,
        value: second,
      };

    case PROGRAM_CHANGE:
      return { type: 'programChange', channel, program: first };

    case CHANNEL_PRESSURE:
      return { type: 'channelPressure', channel, pressure: first };

    case PITCH_BEND:
      // Fourteen bits, least significant first.
      return { type: 'pitchBend', channel, value: first | (second << 7) };

    default:
      return undefined;
  }
}

/** Velocity as a 0–1 amplitude. */
export function normalizeVelocity(velocity: number): number {
  return Math.min(1, Math.max(0, velocity / MAX_VELOCITY));
}

/**
 * Pitch bend as -1 to 1.
 *
 * The range is deliberately lopsided in the raw value — centre is 8192
 * of 16383, so there are 8192 steps down and 8191 up — and dividing by
 * the wrong half puts the centre slightly off zero, which a synth hears
 * as being permanently a few cents sharp.
 */
export function normalizeBend(value: number): number {
  const offset = value - PITCH_BEND_CENTRE;
  const span =
    offset < 0 ? PITCH_BEND_CENTRE : PITCH_BEND_MAX - PITCH_BEND_CENTRE;
  return Math.min(1, Math.max(-1, offset / span));
}

/** `0` → `"1"`. Hardware counts channels from one; the wire counts from zero. */
export function channelLabel(channel: number): string {
  return String(channel + 1);
}
