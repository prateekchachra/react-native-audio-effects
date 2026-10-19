/**
 * Import a sound, build an effect chain, and tweak it while it plays.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AudioEngine,
  EFFECTS,
  isEffectAvailable,
  type Effect,
  type EffectType,
  type Source,
} from 'react-native-audio-effects';
import {
  EffectRack,
  LevelMeter,
  WaveformView,
  darkTheme,
} from 'react-native-audio-effects/ui';

import { pickAudioFile } from '../pickAudioFile';
import { useLiveLevels, useLiveProgress } from '../useLive';

/**
 * A sample bundled into the example app, so the screen works without picking
 * a file. `ios/Samples` is a folder reference on the app target, so the path
 * keeps its directory inside the bundle.
 */
const BUNDLED_SAMPLE = 'Samples/beat.aiff';

export function StudioScreen() {
  const [source, setSource] = useState<Source>();
  const [effects, setEffects] = useState<Effect[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<string>();

  const levels = useLiveLevels(source);
  const progress = useLiveProgress(source);

  const load = useCallback(
    async (uri: string) => {
      setIsLoading(true);
      setStatus(undefined);
      try {
        await source?.release();
        const loaded = await AudioEngine.loadFile(uri);
        setSource(loaded);
        setEffects([]);
        setIsPlaying(false);
        setStatus(
          `${loaded.info.channelCount}ch · ` +
            `${(loaded.info.sampleRate / 1000).toFixed(1)} kHz · ` +
            `${loaded.info.durationSec.toFixed(1)}s`
        );
      } catch (error) {
        setStatus(`Could not load: ${(error as Error).message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [source]
  );

  const importFile = useCallback(async () => {
    const uri = await pickAudioFile();
    if (uri) {
      await load(uri);
    }
  }, [load]);

  const togglePlay = useCallback(async () => {
    if (!source) {
      return;
    }
    if (isPlaying) {
      await source.pause();
      setIsPlaying(false);
    } else {
      await source.play({ loop: true });
      setIsPlaying(true);
    }
  }, [source, isPlaying]);

  const addEffect = useCallback(
    async (type: EffectType) => {
      if (!source) {
        return;
      }
      try {
        const effect = await source.addEffect(type);
        setEffects((previous) => [...previous, effect]);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [source]
  );

  const removeEffect = useCallback(
    async (effect: Effect) => {
      if (!source) {
        return;
      }
      await source.removeEffect(effect);
      setEffects((previous) => previous.filter((e) => e !== effect));
    },
    [source]
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Studio</Text>

      <View style={styles.row}>
        <Button label="Import a sound" onPress={importFile} primary />
        <Button label="Use sample" onPress={() => load(BUNDLED_SAMPLE)} />
      </View>

      {isLoading ? <ActivityIndicator color={darkTheme.accent} /> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      {source ? (
        <>
          <WaveformView
            peaks={source.info.peaks}
            progress={
              source.info.durationSec > 0
                ? progress.positionSec / source.info.durationSec
                : 0
            }
            onSeek={(fraction) =>
              source.seek(fraction * source.info.durationSec)
            }
          />

          <View style={styles.transport}>
            <Button
              label={isPlaying ? 'Pause' : 'Play'}
              onPress={togglePlay}
              primary
            />
            <Text style={styles.time}>
              {progress.positionSec.toFixed(1)} /{' '}
              {source.info.durationSec.toFixed(1)}s
            </Text>
            <View style={styles.meters}>
              <LevelMeter
                peak={levels.peakLeft}
                rms={levels.rmsLeft}
                length={56}
                thickness={8}
              />
              <LevelMeter
                peak={levels.peakRight}
                rms={levels.rmsRight}
                length={56}
                thickness={8}
              />
            </View>
          </View>

          <Text style={styles.subheading}>Add an effect</Text>
          <View style={styles.chips}>
            {EFFECTS.map((descriptor) => {
              const available = isEffectAvailable(descriptor.type);
              return (
                <Pressable
                  key={descriptor.type}
                  disabled={!available}
                  onPress={() => addEffect(descriptor.type)}
                  style={[styles.chip, !available && styles.chipDisabled]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      !available && styles.chipTextDisabled,
                    ]}
                  >
                    {descriptor.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.subheading}>
            Chain {effects.length > 0 ? `(${effects.length})` : ''}
          </Text>
          <EffectRack effects={effects} onRemove={removeEffect} />
        </>
      ) : (
        <Text style={styles.hint}>
          Import an audio file or load the bundled sample to start.
        </Text>
      )}
    </ScrollView>
  );
}

function Button({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: darkTheme.surface,
  },
  content: {
    padding: 16,
    gap: 14,
    paddingBottom: 48,
  },
  heading: {
    color: darkTheme.text,
    fontSize: 24,
    fontWeight: '700',
  },
  subheading: {
    color: darkTheme.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  status: {
    color: darkTheme.textMuted,
    fontSize: 12,
  },
  hint: {
    color: darkTheme.textMuted,
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  time: {
    color: darkTheme.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    flex: 1,
  },
  meters: {
    flexDirection: 'row',
    gap: 4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: darkTheme.control,
    borderWidth: 1,
    borderColor: darkTheme.track,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipText: {
    color: darkTheme.text,
    fontSize: 12,
  },
  chipTextDisabled: {
    color: darkTheme.disabled,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: darkTheme.control,
    borderWidth: 1,
    borderColor: darkTheme.track,
  },
  buttonPrimary: {
    backgroundColor: darkTheme.accent,
    borderColor: darkTheme.accent,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: darkTheme.text,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: darkTheme.surface,
  },
});
