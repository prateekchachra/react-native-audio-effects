/* eslint-disable no-bitwise -- building MIDI status bytes by hand is the
   clearest way to say which channel a test means. */

import { describe, expect, it } from '@jest/globals';

import {
  channelLabel,
  MidiStream,
  normalizeBend,
  normalizeVelocity,
  PITCH_BEND_CENTRE,
  PITCH_BEND_MAX,
  type MidiMessage,
} from '../messages';

/** Decode one chunk through a fresh stream. */
function decode(...bytes: number[]): MidiMessage[] {
  return new MidiStream().push(bytes);
}

describe('channel voice messages', () => {
  it('decodes a note on', () => {
    expect(decode(0x90, 60, 100)).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    ]);
  });

  it('decodes a note off', () => {
    expect(decode(0x80, 60, 64)).toEqual([
      { type: 'noteOff', channel: 0, note: 60, velocity: 64 },
    ]);
  });

  it('reads the channel from the low nibble', () => {
    for (let channel = 0; channel < 16; channel++) {
      const [message] = decode(0x90 | channel, 60, 100);
      expect(message).toMatchObject({ channel });
    }
  });

  it('decodes control change, program change and pressure', () => {
    expect(decode(0xb0, 74, 90)).toEqual([
      { type: 'controlChange', channel: 0, controller: 74, value: 90 },
    ]);
    expect(decode(0xc3, 7)).toEqual([
      { type: 'programChange', channel: 3, program: 7 },
    ]);
    expect(decode(0xd2, 55)).toEqual([
      { type: 'channelPressure', channel: 2, pressure: 55 },
    ]);
    expect(decode(0xa0, 60, 80)).toEqual([
      { type: 'polyPressure', channel: 0, note: 60, pressure: 80 },
    ]);
  });
});

describe('note on with zero velocity', () => {
  // The trap that leaves every key stuck down. Most controllers send this
  // rather than a real note off, because it lets a whole performance run
  // under one running-status byte.
  it('is a note off', () => {
    expect(decode(0x90, 60, 0)).toEqual([
      { type: 'noteOff', channel: 0, note: 60, velocity: 0 },
    ]);
  });

  it('still ends the note when it arrives under running status', () => {
    const messages = decode(0x90, 60, 100, 60, 0);
    expect(messages).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
      { type: 'noteOff', channel: 0, note: 60, velocity: 0 },
    ]);
  });
});

describe('running status', () => {
  it('carries the status across several messages', () => {
    expect(decode(0x90, 60, 100, 64, 100, 67, 100)).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
      { type: 'noteOn', channel: 0, note: 64, velocity: 100 },
      { type: 'noteOn', channel: 0, note: 67, velocity: 100 },
    ]);
  });

  it('honours the one-data-byte messages', () => {
    expect(decode(0xc0, 1, 2, 3)).toEqual([
      { type: 'programChange', channel: 0, program: 1 },
      { type: 'programChange', channel: 0, program: 2 },
      { type: 'programChange', channel: 0, program: 3 },
    ]);
  });

  it('is cancelled by a system common message', () => {
    // 0xF6 is tune request: no data, and it clears running status, so the
    // bytes after it are orphaned rather than read as another note.
    expect(decode(0x90, 60, 100, 0xf6, 64, 100)).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    ]);
  });

  it('is not cancelled by real time', () => {
    expect(decode(0x90, 60, 100, 0xf8, 64, 100)).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
      { type: 'clock' },
      { type: 'noteOn', channel: 0, note: 64, velocity: 100 },
    ]);
  });
});

describe('real time interleaving', () => {
  // Real time may appear between any two bytes, including inside another
  // message. A decoder that treats the clock byte as data corrupts the
  // note around it.
  it('survives a clock between status and data', () => {
    expect(decode(0x90, 0xf8, 60, 100)).toEqual([
      { type: 'clock' },
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    ]);
  });

  it('survives a clock between the two data bytes', () => {
    expect(decode(0x90, 60, 0xf8, 100)).toEqual([
      { type: 'clock' },
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    ]);
  });

  it('decodes the transport messages', () => {
    expect(decode(0xfa, 0xfb, 0xfc, 0xfe, 0xff)).toEqual([
      { type: 'start' },
      { type: 'continue' },
      { type: 'stop' },
      { type: 'activeSensing' },
      { type: 'reset' },
    ]);
  });
});

describe('messages split across chunks', () => {
  // The transport decides where chunks end, not the sender, so every
  // message has to survive being cut at any byte.
  it('completes a note split after the status byte', () => {
    const stream = new MidiStream();
    expect(stream.push([0x90])).toEqual([]);
    expect(stream.push([60, 100])).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    ]);
  });

  it('completes a note split between its data bytes', () => {
    const stream = new MidiStream();
    expect(stream.push([0x90, 60])).toEqual([]);
    expect(stream.push([100])).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    ]);
  });

  it('survives being cut at every possible point', () => {
    const wire = [0x90, 60, 100, 0xb0, 74, 90, 0xe0, 0x00, 0x60];
    const whole = new MidiStream().push(wire);

    for (let cut = 0; cut <= wire.length; cut++) {
      const stream = new MidiStream();
      const split = [
        ...stream.push(wire.slice(0, cut)),
        ...stream.push(wire.slice(cut)),
      ];
      expect(split).toEqual(whole);
    }
  });

  it('keeps running status across a chunk boundary', () => {
    const stream = new MidiStream();
    stream.push([0x90, 60, 100]);
    expect(stream.push([64, 100])).toEqual([
      { type: 'noteOn', channel: 0, note: 64, velocity: 100 },
    ]);
  });

  it('forgets a partial message after reset', () => {
    const stream = new MidiStream();
    stream.push([0x90, 60]);
    stream.reset();
    expect(stream.push([100])).toEqual([]);
  });
});

describe('pitch bend', () => {
  it('assembles fourteen bits, least significant first', () => {
    expect(decode(0xe0, 0x00, 0x40)).toEqual([
      { type: 'pitchBend', channel: 0, value: PITCH_BEND_CENTRE },
    ]);
    expect(decode(0xe0, 0x00, 0x00)).toEqual([
      { type: 'pitchBend', channel: 0, value: 0 },
    ]);
    expect(decode(0xe0, 0x7f, 0x7f)).toEqual([
      { type: 'pitchBend', channel: 0, value: PITCH_BEND_MAX },
    ]);
  });

  it('normalises a centred wheel to exactly zero', () => {
    // The range is lopsided — 8192 steps down, 8191 up — so dividing by
    // one half for both directions puts the centre off zero, which a
    // synth plays as being permanently slightly sharp.
    expect(normalizeBend(PITCH_BEND_CENTRE)).toBe(0);
  });

  it('reaches exactly -1 and 1 at the stops', () => {
    expect(normalizeBend(0)).toBe(-1);
    expect(normalizeBend(PITCH_BEND_MAX)).toBe(1);
  });

  it('is monotonic across the range', () => {
    let previous = -Infinity;
    for (let raw = 0; raw <= PITCH_BEND_MAX; raw += 97) {
      const value = normalizeBend(raw);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('system exclusive', () => {
  it('collects a complete message including its framing', () => {
    expect(decode(0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7)).toEqual([
      { type: 'sysex', bytes: [0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7] },
    ]);
  });

  it('spans chunk boundaries', () => {
    const stream = new MidiStream();
    expect(stream.push([0xf0, 0x7e])).toEqual([]);
    expect(stream.push([0x00, 0xf7])).toEqual([
      { type: 'sysex', bytes: [0xf0, 0x7e, 0x00, 0xf7] },
    ]);
  });

  it('lets real time pass through without ending it', () => {
    expect(decode(0xf0, 0x7e, 0xf8, 0x00, 0xf7)).toEqual([
      { type: 'clock' },
      { type: 'sysex', bytes: [0xf0, 0x7e, 0x00, 0xf7] },
    ]);
  });

  it('abandons an unterminated message when a new status arrives', () => {
    expect(decode(0xf0, 0x7e, 0x90, 60, 100)).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    ]);
  });

  it('cancels running status', () => {
    expect(decode(0x90, 60, 100, 0xf0, 0x7e, 0xf7, 64, 100)).toEqual([
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
      { type: 'sysex', bytes: [0xf0, 0x7e, 0xf7] },
    ]);
  });
});

describe('joining a stream already in progress', () => {
  it('ignores data bytes until a status arrives', () => {
    expect(decode(60, 100, 64, 0x90, 67, 100)).toEqual([
      { type: 'noteOn', channel: 0, note: 67, velocity: 100 },
    ]);
  });
});

describe('normalizeVelocity', () => {
  it('maps the range onto 0..1', () => {
    expect(normalizeVelocity(0)).toBe(0);
    expect(normalizeVelocity(127)).toBe(1);
    expect(normalizeVelocity(64)).toBeCloseTo(0.504, 3);
  });

  it('clamps nonsense rather than passing it through', () => {
    expect(normalizeVelocity(200)).toBe(1);
    expect(normalizeVelocity(-5)).toBe(0);
  });
});

describe('channelLabel', () => {
  it('counts from one, as hardware does', () => {
    expect(channelLabel(0)).toBe('1');
    expect(channelLabel(15)).toBe('16');
  });
});
