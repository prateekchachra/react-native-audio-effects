/**
 * End-to-end diagnostics.
 *
 * Exercises the whole path — engine, file decode, effect chain, parameter
 * writes, generators, metering — and reports what actually happened rather
 * than what should have. Useful when bringing the library up on a new
 * platform or checking a device, and it is how the iOS implementation was
 * verified: unit tests cannot tell you whether audio is really flowing.
 *
 * Every line is logged with a `[selfcheck]` prefix so it can be read out of
 * the device log.
 */

import {
  AudioEngine,
  EFFECTS,
  GENERATORS,
  getCapabilities,
  getEffect,
  isEffectAvailable,
  isParamAvailable,
  type EffectType,
  type Waveform,
} from 'react-native-audio-effects';

const SAMPLE = 'Samples/beat.aiff';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function log(result: CheckResult) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  console.log(`[selfcheck] ${mark} ${result.name} :: ${result.detail}`);
  return result;
}

/** Wait for a level report above `threshold`, or give up after `timeoutMs`. */
function awaitSignal(sourceId: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    let best = 0;
    const unsubscribe = AudioEngine.onLevels((event) => {
      if (event.sourceId !== sourceId) {
        return;
      }
      best = Math.max(best, event.rmsLeft, event.rmsRight);
    });
    setTimeout(() => {
      unsubscribe();
      resolve(best);
    }, timeoutMs);
  });
}

export async function runSelfCheck(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  console.log('[selfcheck] ---- begin ----');

  // 1. Capabilities -------------------------------------------------------
  try {
    const capabilities = getCapabilities();
    const effectCount = Object.keys(capabilities.effects).length;
    results.push(
      log({
        name: 'capabilities',
        ok: effectCount > 0 && capabilities.generators.length > 0,
        detail: `${effectCount} effects, ${capabilities.generators.length} generators`,
      })
    );

    // The schema and the native registry must agree, or a control will move
    // and do nothing.
    const mismatches = EFFECTS.filter(
      (e) => e.platforms.includes('ios') !== isEffectAvailable(e.type)
    ).map((e) => e.type);
    results.push(
      log({
        name: 'schema/native parity',
        ok: mismatches.length === 0,
        detail:
          mismatches.length === 0
            ? 'schema platforms match getCapabilities()'
            : `mismatched: ${mismatches.join(', ')}`,
      })
    );
  } catch (error) {
    results.push(
      log({ name: 'capabilities', ok: false, detail: String(error) })
    );
  }

  // Metering on from the start, so every source created below is tapped at
  // creation rather than only those that already existed.
  AudioEngine.setMetering(true, 33);

  // 2. File decode --------------------------------------------------------
  let source;
  try {
    source = await AudioEngine.loadFile(SAMPLE);
    const { durationSec, sampleRate, channelCount, peaks } = source.info;
    const nonZeroPeaks = peaks.filter((p) => p !== 0).length;
    results.push(
      log({
        name: 'loadFile',
        ok: durationSec > 0 && sampleRate > 0 && nonZeroPeaks > 0,
        detail:
          `${durationSec.toFixed(2)}s, ${sampleRate}Hz, ${channelCount}ch, ` +
          `${nonZeroPeaks}/${peaks.length} non-zero peaks`,
      })
    );
  } catch (error) {
    results.push(log({ name: 'loadFile', ok: false, detail: String(error) }));
    console.log('[selfcheck] ---- aborted: no source ----');
    return results;
  }

  // 3. Effect chain -------------------------------------------------------
  try {
    const chain: EffectType[] = ['delay', 'reverb', 'chorus', 'compressor'];
    for (const type of chain) {
      await source.addEffect(type);
    }
    results.push(
      log({
        name: 'addEffect',
        ok: source.effects.length === chain.length,
        detail: `chain = ${source.effects.map((e) => e.type).join(' -> ')}`,
      })
    );

    // 4. Parameter round-trip --------------------------------------------
    const delay = source.effects[0]!;
    delay.set('time', 300);
    delay.set('feedback', 0.55);
    const readBack = `time=${delay.get('time')} feedback=${delay.get('feedback')}`;
    results.push(
      log({
        name: 'setParameter',
        ok:
          delay.get('time') === 300 &&
          Math.abs(delay.get('feedback') - 0.55) < 1e-6,
        detail: readBack,
      })
    );

    // Values outside the schema range must clamp, not pass through.
    delay.set('feedback', 99);
    const clamped = delay.get('feedback');
    const max = getEffect('delay')!.params.find(
      (p) => p.key === 'feedback'
    )!.max;
    results.push(
      log({
        name: 'parameter clamping',
        ok: clamped === max,
        detail: `set 99 -> ${clamped} (schema max ${max})`,
      })
    );
    delay.set('feedback', 0.3);

    // Batched writes are what a preset recall and an XY pad use.
    delay.setMany({ time: 125, mix: 0.4 });
    results.push(
      log({
        name: 'setParameters (batch)',
        ok:
          delay.get('time') === 125 && Math.abs(delay.get('mix') - 0.4) < 1e-6,
        detail: `time=${delay.get('time')} mix=${delay.get('mix')}`,
      })
    );
  } catch (error) {
    results.push(
      log({ name: 'effect chain', ok: false, detail: String(error) })
    );
  }

  // 5. Unavailable effects reject, not no-op ------------------------------
  try {
    const androidOnly = EFFECTS.filter((e) => !e.platforms.includes('ios'));
    if (androidOnly.length === 0) {
      results.push(
        log({
          name: 'unavailable effect rejects',
          ok: true,
          detail: 'no iOS-unavailable effects to test',
        })
      );
    } else {
      let threw = false;
      try {
        await source.addEffect(androidOnly[0]!.type);
      } catch {
        threw = true;
      }
      results.push(
        log({
          name: 'unavailable effect rejects',
          ok: threw,
          detail: `${androidOnly[0]!.type} ${threw ? 'threw' : 'silently succeeded'}`,
        })
      );
    }
  } catch (error) {
    results.push(
      log({
        name: 'unavailable effect rejects',
        ok: false,
        detail: String(error),
      })
    );
  }

  // 6. Audio actually flows ----------------------------------------------
  try {
    await source.play({ loop: true });
    const peak = await awaitSignal(source.id, 1500);
    await source.pause();
    results.push(
      log({
        name: 'file playback produces signal',
        ok: peak > 0.0001,
        detail: `peak RMS over 1.5s = ${peak.toFixed(5)}`,
      })
    );
  } catch (error) {
    results.push(
      log({
        name: 'file playback produces signal',
        ok: false,
        detail: String(error),
      })
    );
  }

  // 6b. Replaying after pause and after stop ------------------------------
  // "Press play, press pause, press play again" is the single most common
  // interaction and the easiest one to get wrong, because pause and stop
  // leave the player in different states.
  try {
    await source.play({ loop: true });
    const first = await awaitSignal(source.id, 700);
    await source.pause();
    await source.play({ loop: true });
    const afterPause = await awaitSignal(source.id, 700);
    await source.pause();
    results.push(
      log({
        name: 'replay after pause',
        ok: afterPause > 0.0001,
        detail: `first=${first.toFixed(5)} afterPause=${afterPause.toFixed(5)}`,
      })
    );
  } catch (error) {
    results.push(
      log({ name: 'replay after pause', ok: false, detail: String(error) })
    );
  }

  try {
    await source.stop();
    await source.play({ loop: true });
    const afterStop = await awaitSignal(source.id, 700);
    await source.stop();
    results.push(
      log({
        name: 'replay after stop',
        ok: afterStop > 0.0001,
        detail: `afterStop=${afterStop.toFixed(5)}`,
      })
    );
  } catch (error) {
    results.push(
      log({ name: 'replay after stop', ok: false, detail: String(error) })
    );
  }

  // 6c. The calls the screens make when you tap an effect chip ------------
  try {
    const probes = EFFECTS.map((descriptor) => ({
      type: descriptor.type,
      available: isEffectAvailable(descriptor.type),
      params: descriptor.params.map((param) => ({
        key: param.key,
        available: isParamAvailable(descriptor.type, param.key),
      })),
    }));
    results.push(
      log({
        name: 'capability lookups for every effect',
        ok: probes.length === EFFECTS.length,
        detail: `${probes.filter((p) => p.available).length}/${probes.length} available here`,
      })
    );
  } catch (error) {
    results.push(
      log({
        name: 'capability lookups for every effect',
        ok: false,
        detail: String(error),
      })
    );
  }

  // 6d. Adding then removing every available effect ------------------------
  await source.clearEffects();
  for (const descriptor of EFFECTS) {
    if (!isEffectAvailable(descriptor.type)) {
      continue;
    }
    try {
      const effect = await source.addEffect(descriptor.type);
      // Touch every parameter the way EffectPanel does on first render.
      for (const param of effect.params) {
        effect.get(param.key);
        if (isParamAvailable(descriptor.type, param.key)) {
          effect.set(param.key, param.default);
        }
      }
      await source.removeEffect(effect);
    } catch (error) {
      results.push(
        log({
          name: `add/remove ${descriptor.type}`,
          ok: false,
          detail: String(error),
        })
      );
    }
  }
  results.push(
    log({
      name: 'add/remove every available effect',
      ok: source.effects.length === 0,
      detail: `chain back to ${source.effects.length} effects`,
    })
  );

  await source.release();

  // 7. Generators ---------------------------------------------------------
  for (const generator of GENERATORS) {
    const waveform = generator.waveform as Waveform;
    try {
      const osc = await AudioEngine.createOscillator(waveform, {
        frequency: 440,
        amplitude: 0.5,
      });
      await osc.play({ loop: true });
      const peak = await awaitSignal(osc.id, 700);
      await osc.stop();
      await osc.release();
      results.push(
        log({
          name: `generator ${waveform}`,
          ok: peak > 0.0001,
          detail: `peak RMS = ${peak.toFixed(5)}`,
        })
      );
    } catch (error) {
      results.push(
        log({ name: `generator ${waveform}`, ok: false, detail: String(error) })
      );
    }
  }

  // 8. Envelope ----------------------------------------------------------
  // An ADSR is only correct if gating actually changes the level, so this
  // measures silence before the note, signal during it, and silence after
  // the release has had time to finish.
  try {
    const osc = await AudioEngine.createOscillator('sine', {
      frequency: 440,
      amplitude: 0.5,
    });
    osc.setEnvelopeParam('attack', 5);
    osc.setEnvelopeParam('decay', 50);
    osc.setEnvelopeParam('sustain', 0.8);
    osc.setEnvelopeParam('release', 60);

    await osc.play({ loop: true });
    // A generator started with the transport and never gated is deliberately
    // held open, so silence has to be established with an explicit note off
    // rather than assumed.
    osc.gate(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const beforeGate = await awaitSignal(osc.id, 400);

    osc.gate(true);
    const duringNote = await awaitSignal(osc.id, 600);

    osc.gate(false);
    // Wait out the release before measuring the tail.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterRelease = await awaitSignal(osc.id, 400);

    await osc.stop();
    await osc.release();

    results.push(
      log({
        name: 'envelope gates the generator',
        ok: beforeGate < 0.01 && duringNote > 0.05 && afterRelease < 0.01,
        detail:
          `idle=${beforeGate.toFixed(4)} ` +
          `held=${duringNote.toFixed(4)} ` +
          `released=${afterRelease.toFixed(4)}`,
      })
    );
  } catch (error) {
    results.push(
      log({
        name: 'envelope gates the generator',
        ok: false,
        detail: String(error),
      })
    );
  }

  AudioEngine.setMetering(false);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `[selfcheck] ---- ${results.length - failed.length}/${results.length} passed ----`
  );
  if (failed.length > 0) {
    console.log(
      `[selfcheck] failures: ${failed.map((r) => r.name).join(', ')}`
    );
  }
  return results;
}
