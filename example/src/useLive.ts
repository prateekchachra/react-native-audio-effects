/**
 * Level and progress subscriptions for the example screens.
 *
 * The library ships `useLevels` / `useProgress`, but those manage metering
 * per component. Here several screens share one source, so metering is
 * enabled once and the events are filtered by source id.
 */

import { useEffect, useState } from 'react';
import {
  AudioEngine,
  type LevelsEvent,
  type ProgressEvent,
  type Source,
} from 'react-native-audio-effects';

const SILENT: LevelsEvent = {
  sourceId: 0,
  peakLeft: 0,
  peakRight: 0,
  rmsLeft: 0,
  rmsRight: 0,
};

export function useLiveLevels(source: Source | undefined) {
  const [levels, setLevels] = useState<LevelsEvent>(SILENT);

  useEffect(() => {
    if (!source) {
      setLevels(SILENT);
      return;
    }
    AudioEngine.setMetering(true, 33);
    return AudioEngine.onLevels((event) => {
      if (event.sourceId === source.id) {
        setLevels(event);
      }
    });
  }, [source]);

  return levels;
}

export function useLiveProgress(source: Source | undefined) {
  const [progress, setProgress] = useState<ProgressEvent>({
    sourceId: 0,
    positionSec: 0,
    durationSec: 0,
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
