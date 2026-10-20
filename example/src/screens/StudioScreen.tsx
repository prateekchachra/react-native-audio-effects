/**
 * Import a sound, build an effect chain, and tweak it while it plays.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
  type EffectLike,
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
import { BUNDLED_SAMPLES, type BundledSample } from '../samples';
import { useLiveLevels, useLiveProgress } from '../useLive';

export function StudioScreen() {
  const [source, setSource] = useState<Source>();
  const [effects, setEffects] = useState<Effect[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<string>();
  const [sample, setSample] = useState<BundledSample>();
  const [pickerOpen, setPickerOpen] = useState(false);

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
    (effect: EffectLike) => {
      if (!source) {
        return;
      }
      // The rack hands back the interface, not the concrete effect; the
      // chain is the authority on which instance that is.
      const target = source.effects.find(
        (candidate) => candidate.id === effect.id
      );
      if (!target) {
        return;
      }
      source.removeEffect(target).then(() => {
        setEffects((previous) => previous.filter((e) => e.id !== effect.id));
      });
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
        <Button
          label={sample ? sample.label : 'Use a sample'}
          onPress={() => setPickerOpen(true)}
        />
      </View>

      {sample ? <Text style={styles.hintLine}>{sample.hint}</Text> : null}

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          {/* Stop presses inside the sheet from closing it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Choose a sample</Text>
            <ScrollView style={styles.sheetList}>
              {BUNDLED_SAMPLES.map((entry) => {
                const selected = entry.path === sample?.path;
                return (
                  <Pressable
                    key={entry.path}
                    onPress={() => {
                      setPickerOpen(false);
                      setSample(entry);
                      load(entry.path);
                    }}
                    style={({ pressed }) => [
                      styles.sheetRow,
                      selected && styles.sheetRowSelected,
                      pressed && styles.sheetRowPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sheetLabel,
                        selected && styles.sheetLabelSelected,
                      ]}
                    >
                      {entry.label}
                    </Text>
                    <Text style={styles.sheetHint}>{entry.hint}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

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
          Import an audio file or pick one of the bundled samples to start.
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
    fontSize: 26,
    fontWeight: '700',
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.3,
  },
  subheading: {
    color: darkTheme.textMuted,
    fontSize: 10,
    fontFamily: darkTheme.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  status: {
    color: darkTheme.textMuted,
    fontSize: 12,
    fontFamily: darkTheme.monoFontFamily,
    marginBottom: 4,
  },
  hint: {
    color: darkTheme.textMuted,
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
    fontFamily: darkTheme.fontFamily,
  },
  hintLine: {
    color: darkTheme.textMuted,
    fontSize: 11.5,
    fontFamily: darkTheme.fontFamily,
    fontStyle: 'italic',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7,5,12,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: darkTheme.control,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 18,
    paddingBottom: 34,
    paddingHorizontal: 16,
    maxHeight: '72%',
    shadowColor: darkTheme.shadowDark,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.9,
    shadowRadius: 16,
    elevation: 16,
  },
  sheetTitle: {
    color: darkTheme.text,
    fontSize: 17,
    fontWeight: '700',
    fontFamily: darkTheme.fontFamily,
    marginBottom: 12,
  },
  sheetList: {
    flexGrow: 0,
  },
  sheetRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: darkTheme.surface,
    borderWidth: 1,
    borderColor: darkTheme.track,
  },
  sheetRowSelected: {
    borderColor: darkTheme.accent,
  },
  sheetRowPressed: {
    opacity: 0.7,
  },
  sheetLabel: {
    color: darkTheme.text,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: darkTheme.fontFamily,
  },
  sheetLabelSelected: {
    color: darkTheme.accent,
  },
  sheetHint: {
    color: darkTheme.textMuted,
    fontSize: 11.5,
    fontFamily: darkTheme.fontFamily,
    marginTop: 3,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  time: {
    color: darkTheme.textMuted,
    fontSize: 12,
    fontFamily: darkTheme.monoFontFamily,
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
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: darkTheme.control,
    shadowColor: darkTheme.shadowDark,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.85,
    shadowRadius: 5,
    elevation: 4,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipText: {
    color: darkTheme.text,
    fontSize: 12.5,
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.2,
  },
  chipTextDisabled: {
    color: darkTheme.disabled,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: darkTheme.radius,
    backgroundColor: darkTheme.control,
    shadowColor: darkTheme.shadowDark,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
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
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.3,
  },
  buttonTextPrimary: {
    color: darkTheme.surface,
  },
});
