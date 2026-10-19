/**
 * Audio bundled with the example app.
 *
 * The paths are relative and resolve the same way on both platforms: against
 * the `Samples` folder reference on the iOS app target, and against
 * `android/app/src/main/assets/Samples` on Android.
 *
 * The selection is deliberately varied — effects behave very differently on
 * a transient-heavy drum loop than on a sustained pad, and hearing that
 * difference is the point of the screen.
 */

export interface BundledSample {
  readonly label: string;
  readonly path: string;
  /** What this one is useful for demonstrating. */
  readonly hint: string;
}

export const BUNDLED_SAMPLES: readonly BundledSample[] = [
  {
    label: 'Drum loop',
    path: 'Samples/beat.aiff',
    hint: 'Transients — try delay, compression and bit crusher',
  },
  {
    label: 'Snare hit',
    path: 'Samples/snare_D1.wav',
    hint: 'One shot — the clearest way to hear a reverb tail',
  },
  {
    label: 'Piano',
    path: 'Samples/Piano.mp3',
    hint: 'Wide range — good for EQ and chorus',
  },
  {
    label: 'Guitar',
    path: 'Samples/Guitar.mp3',
    hint: 'Mid-heavy — try distortion, phaser and tremolo',
  },
  {
    label: 'Strings',
    path: 'Samples/Strings.mp3',
    hint: 'Sustained pad — reverb and flanger shine here',
  },
  {
    label: 'Synth',
    path: 'Samples/Synth.mp3',
    hint: 'Bright and steady — good for filters',
  },
  {
    label: 'Bass synth',
    path: 'Samples/Bass Synth.mp3',
    hint: 'Low end — try the high-pass filter and compressor',
  },
  {
    label: 'Vocal',
    path: 'Samples/Counting.mp3',
    hint: 'Speech — try the noise gate, delay and pitch-sensitive effects',
  },
];
