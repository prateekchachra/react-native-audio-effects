/**
 * Live view of the shape an oscillator is making.
 *
 * A saw looks like a saw, a square like a square, and the trace scrolls
 * so it reads as something running rather than a diagram.
 *
 * The x axis is time, and the window follows the note: it always holds
 * a few cycles of the lowest one sounding. Pitch is then carried by
 * speed — the higher the note, the faster the trace runs.
 *
 * Pitch shows up two ways at once: a higher note packs more cycles in
 * *and* runs faster. That pairing is not a flourish — cycles per second
 * past a fixed point is the frequency, so the two are one quantity and
 * their product has to double every octave. What is free is how the
 * range is divided between them, which {@link DENSITY_SPLIT} sets.
 *
 * Putting it all on speed fails: every pitch then draws the identical
 * picture, and the eye cannot judge a two percent speed difference with
 * nothing on screen to compare it against, so neighbouring notes look
 * the same. Putting it all on density is the fixed time window, where
 * the top of the keyboard smears into hash. Half each gives both cues
 * about a twelvefold range — the square root of the piano's 152 — which
 * is enough to see and little enough to stay legible.
 *
 * All of it is reckoned in octaves rather than hertz, which is why this
 * goes through the schema's note helpers: equal temperament makes a
 * semitone a factor of 2^(1/12), so a MIDI number is already the log of
 * its own pitch. That is also the right unit, since pitch is heard
 * logarithmically — the reason we number notes rather than measure them.
 *
 * ## Why the window is not a fixed slice of time
 *
 * That is the obvious design and it fails twice over.
 *
 * It does not show pitch. Solve `t = (x/width + scrolled) * cycles` for
 * a point of constant phase and the cycle count cancels: every note
 * slides at the same pixels per second, however dense it looks. What
 * does scale with frequency is the rate cycles cross a fixed point, but
 * that is not what the eye tracks — it tracks the pattern moving, and
 * the pattern moves at one speed for the whole keyboard.
 *
 * It also destroys the shapes. A window wide enough to show a low C
 * packs seventy-odd cycles of a high C into a few hundred pixels, where
 * a square's vertical edge has to be drawn as a diagonal across a whole
 * sample step. The square stops being a square, and the triangle stops
 * being a triangle.
 *
 * Scaling the window to the note fixes both at once, which is what a
 * scope's time-per-division knob is for.
 *
 * ## What it is and is not
 *
 * This draws the oscillator's **own** waveform, computed from the
 * waveform type and frequency. For a generator that is the truth — the
 * DSP synthesises exactly this shape, so nothing is being invented.
 *
 * It is not a scope on the engine's output. Adding distortion or a
 * filter will not change this picture, because the samples never leave
 * the audio thread. A real scope needs a tap streaming frames up to JS,
 * which this library does not expose and which has a bad history here:
 * taps installed on a live AVAudioEngine graph have silenced playback
 * more than once.
 *
 * ## Why Skia rather than SVG
 *
 * The rest of the UI kit draws with `react-native-svg`, which is right
 * for controls that redraw only when a value changes. This redraws every
 * frame, several hundred points at a time. That is the case SVG handles
 * badly and a canvas handles easily, so it is the one place a second
 * renderer earns its keep.
 *
 * Skia is therefore an optional peer dependency, reached through its own
 * `react-native-audio-effects/scope` entry point. Apps that do not want
 * a scope never import it and never have to install it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Group,
  Path,
  Skia,
} from '@shopify/react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  frequencyToMidi,
  PIANO_HIGHEST,
  PIANO_LOWEST,
  SEMITONES_PER_OCTAVE,
  type Waveform,
} from '../schema';
import { useAudioTheme, type AudioTheme } from '../ui/theme';

/**
 * Waveform as a number.
 *
 * The path is built inside a worklet, and comparing small integers there
 * avoids any string handling on the UI thread each frame.
 */
const SHAPE_CODE: Record<Waveform, number> = {
  sine: 0,
  square: 1,
  sawtooth: 2,
  triangle: 3,
  whiteNoise: 4,
  pinkNoise: 5,
  brownNoise: 6,
};

/** One horizontal sample per this many points. Finer than the eye needs. */
const POINT_SPACING = 2;

/**
 * Floor on how finely a single cycle is drawn.
 *
 * View width alone is the wrong budget once a note is dense: at six
 * points per cycle a sawtooth samples into noise rather than teeth. The
 * point count therefore rises with the densest voice on screen, so the
 * top of the keyboard stays a shape instead of becoming hash.
 */
const POINTS_PER_CYCLE = 24;
const MAX_POINTS = 900;

/**
 * How the pitch range is divided between the two things that can show it.
 *
 * A scope has exactly two ways to say "higher note": pack more cycles
 * into the view, or run faster. Physics says their product is fixed —
 * cycles per second past a point *is* the frequency — so this is a
 * split of one budget, not two free choices.
 *
 * At 0 all of it goes to speed, which is what made nearby notes
 * indistinguishable: every pitch drew the identical picture and only a
 * two percent speed difference told them apart, with nothing on screen
 * to judge that against. At 1 all of it goes to density, which is the
 * fixed time window that smeared the top of the keyboard into hash.
 *
 * A half splits it evenly, and evenly in the right space: each side
 * then spans the *square root* of the piano's 152, about 12, so both
 * cues move visibly and neither runs away.
 */
const DENSITY_SPLIT = 0.5;

/**
 * What the lowest key on the piano gets, before the split is applied.
 *
 * Raise the first to show more of the wave at every pitch, the second
 * for a livelier scope overall. Both scale the whole keyboard together,
 * so neither changes how strongly pitch reads.
 */
const CYCLES_AT_LOWEST_KEY = 1;
const SPEED_AT_LOWEST_KEY = 0.3;

/**
 * How densely and how fast a note should be drawn.
 *
 * Both work in **octaves above the bottom key**, which is why this goes
 * through `frequencyToMidi` rather than taking a logarithm by hand:
 * equal temperament makes a semitone a factor of 2^(1/12), so a MIDI
 * number already *is* the log of its own pitch, twelve to the octave.
 *
 * The two exponents sum to one, which is the whole design. Their
 * product is `2^octavesUp` however {@link DENSITY_SPLIT} is set — so
 * cycles crossing a fixed point still double every octave, exactly as
 * the real signal does, while neither cue alone has to carry the full
 * 152 and blow out at one end.
 *
 * Clamped to the piano, so a note off either end keeps that end's
 * treatment rather than stopping dead or running away.
 *
 * Deliberately a plain function called only from an effect on the JS
 * thread, never from the trace worklet. A worklet that calls another
 * worklet is unresolvable when the same function is also reachable from
 * JS, which is the failure that once crashed `Knob`.
 */
function scopeMotion(hz: number): { cycles: number; speed: number } {
  const midi = Math.min(
    PIANO_HIGHEST,
    Math.max(PIANO_LOWEST, frequencyToMidi(hz))
  );
  const octavesUp = (midi - PIANO_LOWEST) / SEMITONES_PER_OCTAVE;
  return {
    cycles: CYCLES_AT_LOWEST_KEY * Math.pow(2, DENSITY_SPLIT * octavesUp),
    speed: SPEED_AT_LOWEST_KEY * Math.pow(2, (1 - DENSITY_SPLIT) * octavesUp),
  };
}

/**
 * Ceiling on cycles for a single voice.
 *
 * Only a chord can reach it. The lowest note sets the window, so a voice
 * four octaves above it wants 48 cycles — well past where more detail
 * reads as anything but hatching.
 */
const MAX_CYCLES = 40;

/**
 * Tube colours.
 *
 * Fixed rather than themed: a neon tube is its own light source, so it
 * should not drift with the surrounding palette. The violet matches the
 * app's accent closely enough to belong, while the green reads as the
 * thing actually emitting.
 */
const SHADOW = '#8b5cf6';
const NEON = '#22e584';
const CORE = '#ccffe4';

export interface OscillatorScopeProps {
  waveform: Waveform;
  /**
   * Every sounding frequency, in hertz.
   *
   * A chord is drawn by summing its notes, the way the air does, so
   * three held keys give the lumpy composite waveform rather than three
   * separate traces or only the last one. Empty means nothing is
   * playing.
   */
  frequencies?: readonly number[];
  /**
   * Whether anything is sounding.
   *
   * Silence collapses the trace to a flat line rather than shrinking it,
   * because a small wave still reads as "something is playing quietly".
   */
  active?: boolean;
  /**
   * How tall the trace is drawn, 0 to 1.
   *
   * For a source with no pitch this is the only thing there is to see:
   * noise has no shape that changes and no speed, so its gain has to
   * show up as height or the control looks dead. Pitched sources
   * normally leave it at 1 and let frequency do the talking.
   */
  amplitude?: number;
  height?: number;
  label?: string;
  theme?: Partial<AudioTheme>;
}

export function OscillatorScope({
  waveform,
  frequencies = [],
  active = false,
  amplitude = 1,
  height = 120,
  label,
  theme: themeOverride,
}: OscillatorScopeProps) {
  const theme = useAudioTheme(themeOverride);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [width, setWidth] = useState(0);

  /**
   * View widths the trace has travelled.
   *
   * Accumulated, never wrapped. Each voice's phase is this times its own
   * cycle count, so a clock that reset would jump every voice by a
   * different fraction of a cycle — a visible tear on each one. A double
   * holds this past a day at far better precision than a cycle needs.
   */
  const scrolled = useSharedValue(0);

  /**
   * View widths per second, which is where pitch actually lives.
   *
   * Set from the lowest sounding note, since that is the one the window
   * is sized to. See {@link scrollSpeed} for the mapping.
   */
  const scrollRate = useSharedValue(0);
  const level = useSharedValue(0);

  /**
   * Driven frame by frame rather than by an animation.
   *
   * A timing animation would have to be restarted every time the rate
   * changed, which is every note. It also means the clock can stop: a
   * silent scope is a flat line, and rebuilding that same line sixty
   * times a second is waste on a screen where the engine wants the
   * headroom.
   *
   * Memoised because useFrameCallback re-registers whenever the
   * callback's identity changes, and this re-renders on every key press.
   */
  const tick = useCallback(
    ({ timeSincePreviousFrame }: { timeSincePreviousFrame: number | null }) => {
      'worklet';
      scrolled.value +=
        ((timeSincePreviousFrame ?? 16) / 1000) * scrollRate.value;
    },
    [scrolled, scrollRate]
  );

  const clock = useFrameCallback(tick, false);

  useEffect(() => {
    clock.setActive(active);
  }, [active, clock]);

  useEffect(() => {
    const target = active ? Math.max(0, Math.min(1, amplitude)) : 0;
    level.value = withTiming(target, { duration: 180 });
  }, [active, amplitude, level]);

  const shape = SHAPE_CODE[waveform] ?? 0;

  /**
   * Cycles across the view for each sounding note.
   *
   * A shared value, not a plain array. The trace is built on the UI
   * thread, and a plain array captured in that worklet is not reliably
   * refreshed when it changes — which showed up as a chord looking like
   * one note at a different amplitude, because `level` is a shared value
   * and updated while the voice list did not.
   *
   * Fractional on purpose. Rounding to whole cycles snapped every note
   * onto a handful of integers: E major became [3, 4, 4], two voices
   * identical. Worse, whole cycles are exact harmonics of the view
   * width, so every voice lines up at the edges and the sum stays
   * periodic — it looks like one wave however many notes are held. Real
   * ratios are what make a chord draw as a chord.
   *
   * The lowest note sizes the window, so it gets whatever
   * {@link scopeMotion} says, and every other voice gets the honest
   * frequency ratio above it. That keeps a chord's shape true while
   * still letting pitch move the whole picture.
   */
  const voiceCycles = useSharedValue<number[]>([CYCLES_AT_LOWEST_KEY]);

  useEffect(() => {
    const sounding = frequencies.filter((hz) => hz > 0);
    if (sounding.length === 0) {
      voiceCycles.value = [CYCLES_AT_LOWEST_KEY];
      scrollRate.value = 0;
      return;
    }

    const lowest = Math.min(...sounding);
    const motion = scopeMotion(lowest);
    voiceCycles.value = sounding.map((hz) =>
      Math.min(MAX_CYCLES, (motion.cycles * hz) / lowest)
    );
    scrollRate.value = motion.speed;
    // Joined rather than passed by identity: the screen rebuilds this
    // array every render, and the same notes should not rebuild it.
  }, [frequencies.join(','), voiceCycles, scrollRate]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Build the trace.
   *
   * Self-contained on purpose: `Math` and `Skia` only, no calls out to
   * other helpers. A worklet that calls another worklet is not
   * resolvable when the same function is also reachable from the JS
   * thread, which is the failure that once crashed `Knob`.
   */
  const path = useDerivedValue(() => {
    'worklet';
    // Skia 2 split the path API: SkPath is immutable and points are
    // added through a builder, which `detach` then hands over.
    const builder = Skia.PathBuilder.Make();
    if (width <= 0) {
      return builder.detach();
    }

    const mid = height / 2;
    const amp = (height / 2 - 6) * level.value;
    const isNoise = shape >= 4;
    const cycles = voiceCycles.value;
    const voices = cycles.length;

    // Already in view widths, advanced at a rate proportional to pitch.
    const travelled = scrolled.value;

    // Enough points for the tightest voice on screen, not just for the
    // width. Noise is left on the width alone: it has no cycles to
    // resolve, and more samples would only make it finer hash.
    let densest = 0;
    for (let n = 0; n < voices; n++) {
      if (cycles[n]! > densest) {
        densest = cycles[n]!;
      }
    }
    const byWidth = Math.floor(width / POINT_SPACING);
    const count = isNoise
      ? Math.max(2, byWidth)
      : Math.max(
          2,
          Math.min(
            MAX_POINTS,
            Math.max(byWidth, Math.ceil(densest * POINTS_PER_CYCLE))
          )
        );

    // Summing voices would run past the frame, so the stack is scaled
    // back down. By the square root rather than by the count: notes are
    // not in phase with one another, so a three-note chord is nowhere
    // near three times as tall, and dividing by three would flatten it
    // into a thin wobble.
    const voiceScale = 1 / Math.sqrt(voices);

    // Brown noise wanders, so it needs to remember where it was.
    let brown = 0;

    for (let i = 0; i <= count; i++) {
      const x = (i / count) * width;
      let v: number;

      if (isNoise) {
        const r = Math.random() * 2 - 1;
        if (shape === 4) {
          v = r;
        } else if (shape === 5) {
          // Pink reads as smoother than white without being brown.
          v = r * 0.72;
        } else {
          brown = brown * 0.86 + r * 0.14;
          v = Math.max(-1, Math.min(1, brown * 3.2));
        }
      } else {
        let sum = 0;
        for (let n = 0; n < voices; n++) {
          // Position within this note's own cycle. Both terms are scaled
          // by the same cycle count, because screen position and elapsed
          // time are the same axis: one is where in the window, the
          // other is how far the window has moved.
          const t = ((i / count + travelled) * cycles[n]!) % 1;
          if (shape === 0) {
            sum += Math.sin(2 * Math.PI * t);
          } else if (shape === 1) {
            sum += t < 0.5 ? 1 : -1;
          } else if (shape === 2) {
            sum += 2 * t - 1;
          } else {
            sum += 4 * Math.abs(t - 0.5) - 1;
          }
        }
        // Clamped so a chord that does line up in phase cannot spike
        // outside the frame.
        v = Math.max(-1, Math.min(1, sum * voiceScale));
      }

      const y = mid - v * amp;
      if (i === 0) {
        builder.moveTo(x, y);
      } else {
        builder.lineTo(x, y);
      }
    }
    return builder.detach();
  });

  return (
    <View>
      <View
        style={[styles.frame, { height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <Canvas style={{ width, height }}>
            {/*
              Four passes, not one clever one. The two widest are violet
              and sit behind: that is the shadow the trace casts. The two
              narrowest are green and sit on top: that is the tube
              itself. Reading cool-dark underneath and bright-warm on top
              is what makes a flat stroke look like it is glowing rather
              than just being a coloured line.
            */}
            <Group>
              <Path
                path={path}
                style="stroke"
                strokeWidth={12}
                strokeJoin="round"
                strokeCap="round"
                color={SHADOW}
                opacity={0.3}
              >
                <BlurMask blur={16} style="normal" />
              </Path>
              <Path
                path={path}
                style="stroke"
                strokeWidth={6}
                strokeJoin="round"
                strokeCap="round"
                color={SHADOW}
                opacity={0.55}
              >
                <BlurMask blur={7} style="normal" />
              </Path>
              <Path
                path={path}
                style="stroke"
                strokeWidth={3}
                strokeJoin="round"
                strokeCap="round"
                color={NEON}
                opacity={0.9}
              >
                <BlurMask blur={4} style="solid" />
              </Path>
              <Path
                path={path}
                style="stroke"
                strokeWidth={1.3}
                strokeJoin="round"
                strokeCap="round"
                color={CORE}
              />
            </Group>
          </Canvas>
        ) : null}
      </View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

function makeStyles(theme: AudioTheme) {
  return StyleSheet.create({
    frame: {
      // Darker than the usual surface: a glow needs something to glow
      // against, and the panel colour is too light to sell it.
      backgroundColor: '#0b0813',
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.track,
    },
    label: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 10,
      letterSpacing: 1,
      textTransform: 'uppercase',
      paddingTop: 8,
      textAlign: 'center',
    },
  });
}
