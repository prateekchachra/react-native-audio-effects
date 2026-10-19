/**
 * React bindings.
 *
 * Thin wrappers over the imperative API in `src/api` — the engine, sources and
 * effects are long-lived native objects, so these hooks manage lifecycle and
 * subscriptions rather than holding audio state in React.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AudioEngine, type OscillatorConfig } from '../api/AudioEngine';
import type { Effect } from '../api/Effect';
import type { Source } from '../api/Source';
import type {
  AudioErrorEvent,
  EngineOptions,
  LevelsEvent,
  ProgressEvent,
} from '../NativeAudioEffects';
import { getParam, type EffectType, type Waveform } from '../schema';

/**
 * Swallow a failure during unmount cleanup.
 *
 * These run while a component is going away, so there is nobody left to
 * surface the error to and rethrowing would become an unhandled rejection.
 * Logging in dev is the most that can usefully be done.
 */
function reportCleanupFailure(error: unknown): void {
  if (__DEV__) {
    console.warn('[audio-effects] cleanup failed:', error);
  }
}

/**
 * Configure and start the engine for the lifetime of a component.
 *
 * Tears the engine down on unmount, so mount this once near the root rather
 * than in every screen.
 */
export function useAudioEngine(options: EngineOptions = {}) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error>();

  // Captured once: re-running setup because an inline options object changed
  // identity would restart the audio device mid-playback.
  const optionsRef = useRef(options);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await AudioEngine.configure(optionsRef.current);
        await AudioEngine.start();
        if (!cancelled) {
          setIsReady(true);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught as Error);
        }
      }
    })();

    return () => {
      cancelled = true;
      setIsReady(false);
      AudioEngine.teardown().catch(reportCleanupFailure);
    };
  }, []);

  return { isReady, error, engine: AudioEngine };
}

/**
 * Load a file into a source, releasing it when the URI changes or the
 * component unmounts.
 */
export function useSource(uri: string | undefined) {
  const [source, setSource] = useState<Source>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!uri) {
      setSource(undefined);
      return;
    }

    let cancelled = false;
    let loaded: Source | undefined;
    setIsLoading(true);
    setError(undefined);

    (async () => {
      try {
        loaded = await AudioEngine.loadFile(uri);
        if (cancelled) {
          // The URI changed while we were decoding; this source is orphaned.
          await loaded.release().catch(reportCleanupFailure);
          return;
        }
        setSource(loaded);
      } catch (caught) {
        if (!cancelled) {
          setError(caught as Error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      loaded?.release().catch(reportCleanupFailure);
      setSource(undefined);
    };
  }, [uri]);

  return { source, isLoading, error };
}

/** Create a generator source, released on unmount. */
export function useOscillator(
  waveform: Waveform | undefined,
  config: OscillatorConfig = {}
) {
  const [source, setSource] = useState<Source>();
  const configRef = useRef(config);

  useEffect(() => {
    if (!waveform) {
      setSource(undefined);
      return;
    }

    let cancelled = false;
    let created: Source | undefined;

    (async () => {
      created = await AudioEngine.createOscillator(waveform, configRef.current);
      if (cancelled) {
        await created.release();
        return;
      }
      setSource(created);
    })();

    return () => {
      cancelled = true;
      created?.release().catch(reportCleanupFailure);
      setSource(undefined);
    };
  }, [waveform]);

  return source;
}

const SILENT: LevelsEvent = {
  sourceId: 0,
  peakLeft: 0,
  peakRight: 0,
  rmsLeft: 0,
  rmsRight: 0,
};

/**
 * Subscribe to output levels for one source.
 *
 * Enables metering natively while mounted. Re-renders at the engine's
 * reporting rate, so keep the subscribing component small — ideally just the
 * meter itself.
 */
export function useLevels(source: Source | undefined, intervalMs = 33) {
  const [levels, setLevels] = useState<LevelsEvent>(SILENT);

  useEffect(() => {
    if (!source) {
      setLevels(SILENT);
      return;
    }

    AudioEngine.setMetering(true, intervalMs);
    const unsubscribe = AudioEngine.onLevels((event) => {
      if (event.sourceId === source.id) {
        setLevels(event);
      }
    });

    return () => {
      unsubscribe();
      AudioEngine.setMetering(false, intervalMs);
      setLevels(SILENT);
    };
  }, [source, intervalMs]);

  return levels;
}

/**
 * Playback position for one source.
 *
 * Updates at the engine's reporting rate, which is deliberately coarse.
 * Interpolate between ticks if you want a smooth playhead.
 */
export function useProgress(source: Source | undefined) {
  const [progress, setProgress] = useState<ProgressEvent>({
    sourceId: 0,
    positionSec: 0,
    durationSec: source?.info.durationSec ?? 0,
    isPlaying: false,
  });

  useEffect(() => {
    if (!source) {
      return;
    }
    return AudioEngine.onProgress((event) => {
      if (event.sourceId === source.id) {
        setProgress(event);
      }
    });
  }, [source]);

  return progress;
}

/** Subscribe to audio-thread errors. */
export function useAudioErrors(listener: (event: AudioErrorEvent) => void) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(
    () => AudioEngine.onError((event) => listenerRef.current(event)),
    []
  );
}

/**
 * Bind one effect parameter to component state.
 *
 * Returns the current value, a setter, and the parameter's schema descriptor
 * so a control can size itself without the caller looking it up.
 */
export function useEffectParam(
  effect: Effect | undefined,
  key: string
): {
  value: number;
  setValue: (value: number) => void;
  param: ReturnType<typeof getParam>;
} {
  const param = useMemo(
    () => (effect ? getParam(effect.type, key) : undefined),
    [effect, key]
  );
  const [value, setLocal] = useState(
    () => effect?.get(key) ?? param?.default ?? 0
  );

  useEffect(() => {
    setLocal(effect?.get(key) ?? param?.default ?? 0);
  }, [effect, key, param]);

  const setValue = useCallback(
    (next: number) => {
      setLocal(next);
      effect?.set(key, next);
    },
    [effect, key]
  );

  return { value, setValue, param };
}

/**
 * Build an effect chain on a source and keep it for the component's lifetime.
 *
 * Effects are added in the order given; audio flows through index 0 first.
 */
export function useEffectChain(
  source: Source | undefined,
  types: readonly EffectType[]
) {
  const [effects, setEffects] = useState<Effect[]>([]);
  // Joined so a new array literal with the same contents does not rebuild the
  // chain, which would audibly interrupt playback.
  const key = types.join(',');

  useEffect(() => {
    if (!source) {
      setEffects([]);
      return;
    }

    let cancelled = false;

    (async () => {
      const built: Effect[] = [];
      for (const type of types) {
        try {
          built.push(await source.addEffect(type));
        } catch {
          // Unavailable on this platform; the UI disables it via capabilities.
        }
      }
      if (cancelled) {
        return;
      }
      setEffects(built);
    })();

    return () => {
      cancelled = true;
      if (!source.isReleased) {
        source.clearEffects().catch(reportCleanupFailure);
      }
      setEffects([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);

  return effects;
}
