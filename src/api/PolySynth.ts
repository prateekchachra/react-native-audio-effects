/**
 * A playable synth over the generator primitives.
 *
 * ## Why this is JavaScript and not native
 *
 * A generator source is one oscillator with one envelope — monophonic by
 * construction. Polyphony could be a voice pool inside each backend, but the
 * engine already mixes any number of sources, so a pool of generator sources
 * gives real polyphony today without touching Swift or Kotlin. Allocation
 * and stealing are bookkeeping, and bookkeeping belongs where it is easiest
 * to read.
 *
 * The cost is one native source per voice. At the default of eight voices
 * that is eight oscillators, which is cheap; a 64-voice pad would want a
 * native pool instead.
 */

import {
  detune,
  envelopeDefaults,
  midiToFrequency,
  unisonOffsets,
  type Waveform,
} from '../schema';
import { AudioEngine } from './AudioEngine';
import type { Source } from './Source';

/**
 * How new notes relate to notes already sounding.
 *
 * - `poly` — notes stack. Chords.
 * - `mono` — one note at a time; a new note retriggers the envelope.
 * - `legato` — one note at a time; a new note changes pitch but leaves the
 *   envelope where it is, so a phrase played without gaps swells once
 *   instead of re-attacking on every note.
 * - `portamento` — legato, plus the pitch glides rather than jumps.
 */
export type PlayMode = 'poly' | 'mono' | 'legato' | 'portamento';

export interface PolySynthOptions {
  waveform?: Waveform;
  mode?: PlayMode;
  /** Maximum simultaneous notes in `poly`. Ignored by the mono modes. */
  maxVoices?: number;
  /** Oscillators stacked per note. 1 disables unison. */
  unison?: number;
  /** Total detune spread across the unison stack, in cents. */
  unisonSpread?: number;
  /** Glide time for `portamento`, in milliseconds. */
  glideMs?: number;
  amplitude?: number;
}

/** One sounding note: the MIDI number and the sources realising it. */
interface Voice {
  midi: number;
  sources: Source[];
  /** Monotonic counter, so the oldest voice can be stolen. */
  startedAt: number;
}

/** Glide steps per second. Fast enough to sound continuous. */
const GLIDE_HZ = 60;

export class PolySynth {
  private voices: Voice[] = [];
  private pool: Source[] = [];
  private counter = 0;
  private glideTimer: ReturnType<typeof setInterval> | undefined;
  private currentHz = 0;
  private envelope = envelopeDefaults();
  private disposed = false;

  readonly options: Required<PolySynthOptions>;

  private constructor(options: Required<PolySynthOptions>) {
    this.options = options;
  }

  /**
   * Allocate the voice pool up front.
   *
   * Creating a source costs a native allocation and a graph edit, so doing
   * it per key press would add latency exactly when it is most audible.
   */
  static async create(options: PolySynthOptions = {}): Promise<PolySynth> {
    const resolved: Required<PolySynthOptions> = {
      waveform: options.waveform ?? 'sawtooth',
      mode: options.mode ?? 'poly',
      maxVoices: Math.max(1, options.maxVoices ?? 8),
      unison: Math.max(1, options.unison ?? 1),
      unisonSpread: options.unisonSpread ?? 14,
      glideMs: options.glideMs ?? 120,
      amplitude: options.amplitude ?? 0.25,
    };

    const synth = new PolySynth(resolved);
    const needed =
      (resolved.mode === 'poly' ? resolved.maxVoices : 1) * resolved.unison;

    for (let i = 0; i < needed; i++) {
      const source = await AudioEngine.createOscillator(resolved.waveform, {
        frequency: 440,
        amplitude: resolved.amplitude,
      });
      synth.applyEnvelope(source);
      await source.play({ loop: true });
      // Held closed until a note arrives; the stream runs continuously so a
      // key press is a gate change rather than a stream start.
      source.gate(false);
      synth.pool.push(source);
    }
    return synth;
  }

  // ------------------------------------------------------------------ notes

  /** Sound a note. */
  noteOn(midi: number): void {
    if (this.disposed) {
      return;
    }
    const hz = midiToFrequency(midi);

    if (this.options.mode === 'poly') {
      this.playPoly(midi, hz);
      return;
    }
    this.playMono(midi, hz);
  }

  /** Release a note. Ignored in the mono modes unless it is the held note. */
  noteOff(midi: number): void {
    if (this.disposed) {
      return;
    }
    const index = this.voices.findIndex((voice) => voice.midi === midi);
    if (index === -1) {
      return;
    }
    const [voice] = this.voices.splice(index, 1);
    voice!.sources.forEach((source) => source.gate(false));
    this.pool.push(...voice!.sources);
    if (this.voices.length === 0) {
      this.stopGlide();
    }
  }

  /** Release everything. */
  allNotesOff(): void {
    this.stopGlide();
    for (const voice of this.voices) {
      voice.sources.forEach((source) => source.gate(false));
      this.pool.push(...voice.sources);
    }
    this.voices = [];
  }

  /** Notes currently sounding, for driving a keyboard's highlight. */
  get activeNotes(): number[] {
    return this.voices.map((voice) => voice.midi);
  }

  // ------------------------------------------------------------------ modes

  private playPoly(midi: number, hz: number): void {
    // Re-pressing a sounding note releases it, which is what makes a
    // touchscreen chord builder work: tap to add, tap again to remove.
    if (this.voices.some((voice) => voice.midi === midi)) {
      this.noteOff(midi);
      return;
    }

    const needed = this.options.unison;
    if (this.pool.length < needed) {
      // Steal the oldest note rather than refusing to play.
      const oldest = this.voices.reduce((a, b) =>
        a.startedAt <= b.startedAt ? a : b
      );
      this.noteOff(oldest.midi);
    }

    const sources = this.pool.splice(0, needed);
    if (sources.length === 0) {
      return;
    }
    this.tuneStack(sources, hz);
    sources.forEach((source) => source.gate(true));
    this.voices.push({ midi, sources, startedAt: this.counter++ });
  }

  private playMono(midi: number, hz: number): void {
    const held = this.voices[0];

    if (!held) {
      const sources = this.pool.splice(0, this.options.unison);
      if (sources.length === 0) {
        return;
      }
      this.tuneStack(sources, hz);
      sources.forEach((source) => source.gate(true));
      this.voices = [{ midi, sources, startedAt: this.counter++ }];
      this.currentHz = hz;
      return;
    }

    held.midi = midi;

    if (this.options.mode === 'portamento') {
      this.glideTo(held.sources, hz);
    } else {
      this.tuneStack(held.sources, hz);
      this.currentHz = hz;
    }

    // `mono` re-attacks on every note; `legato` and `portamento` leave the
    // envelope running, which is the whole point of them.
    if (this.options.mode === 'mono') {
      held.sources.forEach((source) => source.gate(true));
    }
  }

  // ----------------------------------------------------------------- tuning

  /** Spread a unison stack around a centre frequency. */
  private tuneStack(sources: Source[], hz: number): void {
    const offsets = unisonOffsets(sources.length, this.options.unisonSpread);
    sources.forEach((source, index) => {
      source.setOscillatorParam('frequency', detune(hz, offsets[index] ?? 0));
    });
  }

  /**
   * Glide to a new pitch.
   *
   * Stepped from JavaScript because neither backend exposes a native glide.
   * At 60 steps a second the staircase is well below the threshold where a
   * pitch change stops sounding smooth, and the writes are synchronous
   * so they cost no round-trip.
   */
  private glideTo(sources: Source[], targetHz: number): void {
    this.stopGlide();
    const startHz = this.currentHz || targetHz;
    const steps = Math.max(
      1,
      Math.round((this.options.glideMs / 1000) * GLIDE_HZ)
    );
    let step = 0;

    this.glideTimer = setInterval(() => {
      step += 1;
      const t = Math.min(1, step / steps);
      // Interpolate in log space: a glide that is linear in hertz sounds
      // like it rushes the top of the interval.
      const hz = startHz * Math.pow(targetHz / startHz, t);
      this.tuneStack(sources, hz);
      this.currentHz = hz;
      if (t >= 1) {
        this.stopGlide();
      }
    }, 1000 / GLIDE_HZ);
  }

  private stopGlide(): void {
    if (this.glideTimer !== undefined) {
      clearInterval(this.glideTimer);
      this.glideTimer = undefined;
    }
  }

  // -------------------------------------------------------------- envelope

  /** Set an ADSR parameter on every voice. */
  setEnvelopeParam(
    key: 'attack' | 'decay' | 'sustain' | 'release',
    value: number
  ): void {
    this.envelope[key] = value;
    for (const source of this.allSources()) {
      source.setEnvelopeParam(key, value);
    }
  }

  private applyEnvelope(source: Source): void {
    for (const [key, value] of Object.entries(this.envelope)) {
      source.setEnvelopeParam(
        key as 'attack' | 'decay' | 'sustain' | 'release',
        value
      );
    }
  }

  /** Output level for every voice, 0..1. */
  setAmplitude(amplitude: number): void {
    for (const source of this.allSources()) {
      source.setOscillatorParam('amplitude', amplitude);
    }
  }

  private allSources(): Source[] {
    return [...this.pool, ...this.voices.flatMap((voice) => voice.sources)];
  }

  // --------------------------------------------------------------- cleanup

  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopGlide();
    const sources = this.allSources();
    this.voices = [];
    this.pool = [];
    await Promise.all(sources.map((source) => source.release()));
  }
}
