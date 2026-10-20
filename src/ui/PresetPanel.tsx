/**
 * Save, recall and delete user presets for a whole effect chain.
 *
 * {@link PresetBar} covers the other half of the workflow — factory presets
 * and A/B comparison, both of which live only for the session. This is the
 * part that survives a relaunch, as far as the {@link PresetStore}'s
 * storage does.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { EffectLike } from '../api/EffectLike';
import type { ChainPreset, PresetStore } from '../api/PresetStore';
import {
  neuroInner,
  neuroInset,
  neuroRaised,
  useAudioTheme,
  type AudioTheme,
} from './theme';

export interface PresetPanelProps {
  store: PresetStore;
  /** The chain that gets captured on save and written on recall. */
  chain: readonly EffectLike[];
  /** Called after a recall, so the surrounding UI can re-read knob values. */
  onRecall?: (preset: ChainPreset) => void;
  title?: string;
  theme?: Partial<AudioTheme>;
}

export function PresetPanel({
  store,
  chain,
  onRecall,
  title = 'Presets',
  theme: themeOverride,
}: PresetPanelProps) {
  const theme = useAudioTheme(themeOverride);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [presets, setPresets] = useState<ChainPreset[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeName, setActiveName] = useState<string | undefined>();

  /**
   * Run a storage operation, surfacing a failure rather than dropping it.
   *
   * Every call here is fire-and-forget from a press handler, and storage
   * can genuinely fail — a full disk, a revoked keychain entry. Silently
   * swallowing that would leave the user believing a preset was saved.
   */
  const run = useCallback((work: Promise<unknown>) => {
    work.catch((error: unknown) => {
      Alert.alert(
        'Preset storage failed',
        error instanceof Error ? error.message : String(error)
      );
    });
  }, []);

  const refresh = useCallback(async () => {
    setPresets([...(await store.list())]);
    setLoading(false);
  }, [store]);

  useEffect(() => {
    let alive = true;
    store.list().then((list) => {
      // The store is async and the panel can unmount mid-read.
      if (alive) {
        setPresets([...list]);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [store]);

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || chain.length === 0) {
      return;
    }
    const existing = presets.some((preset) => preset.name === trimmed);
    const commit = async () => {
      await store.save(trimmed, chain);
      setName('');
      setActiveName(trimmed);
      await refresh();
    };
    // Overwriting silently is the one destructive thing this panel can do.
    if (existing) {
      Alert.alert(
        'Replace preset?',
        `"${trimmed}" already exists. Saving will overwrite it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => run(commit()),
          },
        ]
      );
      return;
    }
    await commit();
  }, [chain, name, presets, refresh, run, store]);

  const recall = useCallback(
    async (preset: ChainPreset) => {
      const skipped = await store.apply(preset.name, chain);
      setActiveName(preset.name);
      onRecall?.(preset);
      if (skipped.length > 0) {
        Alert.alert(
          'Partly applied',
          `"${preset.name}" was saved with a different chain, so ` +
            `${skipped.length} of its ${preset.effects.length} effects had ` +
            'nowhere to go. The rest were applied.'
        );
      }
    },
    [chain, onRecall, store]
  );

  const remove = useCallback(
    (preset: ChainPreset) => {
      Alert.alert('Delete preset?', `"${preset.name}" cannot be recovered.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            run(
              store.delete(preset.name).then(() => {
                setActiveName((current) =>
                  current === preset.name ? undefined : current
                );
                return refresh();
              })
            ),
        },
      ]);
    },
    [refresh, run, store]
  );

  const canSave = name.trim().length > 0 && chain.length > 0;

  return (
    <View style={neuroRaised(theme, 20)}>
      <View style={[neuroInner(theme, 20), styles.card]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>
          Stores every effect in the chain — their order, their settings and
          whether each one is bypassed.
        </Text>

        <View style={styles.saveRow}>
          <View style={[neuroInset(theme, 12), styles.inputWrap]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name this preset"
              placeholderTextColor={theme.textMuted}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => run(save())}
              accessibilityLabel="Preset name"
            />
          </View>
          <Pressable
            onPress={() => run(save())}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            style={[styles.saveButton, !canSave && styles.disabled]}
          >
            <Text style={styles.saveLabel}>Save</Text>
          </Pressable>
        </View>

        {chain.length === 0 ? (
          <Text style={styles.hint}>
            Add an effect first — there is nothing to save yet.
          </Text>
        ) : null}

        {loading ? (
          <ActivityIndicator color={theme.accent} />
        ) : presets.length === 0 ? (
          <Text style={styles.hint}>No saved presets yet.</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.list}
          >
            {presets.map((preset) => {
              const active = preset.name === activeName;
              return (
                <View
                  key={preset.name}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Pressable
                    onPress={() => run(recall(preset))}
                    accessibilityRole="button"
                    accessibilityLabel={`Recall ${preset.name}`}
                    style={styles.chipBody}
                  >
                    <Text
                      style={[styles.chipName, active && styles.chipNameActive]}
                      numberOfLines={1}
                    >
                      {preset.name}
                    </Text>
                    <Text style={styles.chipMeta}>
                      {preset.effects.length}{' '}
                      {preset.effects.length === 1 ? 'effect' : 'effects'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => remove(preset)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${preset.name}`}
                    hitSlop={8}
                    style={styles.delete}
                  >
                    <Text style={styles.deleteGlyph}>×</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function makeStyles(theme: AudioTheme) {
  return StyleSheet.create({
    card: { padding: 18, gap: 12 },
    title: {
      color: theme.text,
      fontFamily: theme.fontFamily,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    description: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 12,
      lineHeight: 17,
    },
    saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    inputWrap: { flex: 1 },
    input: {
      color: theme.text,
      fontFamily: theme.fontFamily,
      fontSize: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    saveButton: {
      paddingHorizontal: 18,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: theme.accent,
    },
    disabled: { opacity: 0.35 },
    saveLabel: {
      color: theme.surface,
      fontFamily: theme.fontFamily,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    hint: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 11,
      fontStyle: 'italic',
    },
    list: { gap: 8, paddingVertical: 2, paddingRight: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 14,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingRight: 6,
    },
    chipActive: { borderColor: theme.accent },
    chipBody: {
      paddingHorizontal: 12,
      paddingVertical: 9,
      gap: 2,
      maxWidth: 150,
    },
    chipName: {
      color: theme.text,
      fontFamily: theme.fontFamily,
      fontSize: 13,
      fontWeight: '600',
    },
    chipNameActive: { color: theme.accent },
    chipMeta: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 10,
    },
    delete: { paddingHorizontal: 6, paddingVertical: 4 },
    deleteGlyph: {
      color: theme.textMuted,
      fontFamily: theme.fontFamily,
      fontSize: 18,
      lineHeight: 20,
    },
  });
}
