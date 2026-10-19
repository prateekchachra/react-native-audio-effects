/**
 * Preset selector with A/B comparison.
 *
 * A/B is the workflow that makes tweaking useful: park a setting in A, keep
 * editing into B, and flip between them to hear whether the change is
 * actually an improvement. Without it you are comparing against memory.
 */

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { EffectType } from '../schema';
import { useAudioTheme, type AudioTheme } from './theme';

/** Parameter values for one or more effects, keyed by effect type. */
export type PresetValues = Partial<Record<EffectType, Record<string, number>>>;

export interface Preset {
  readonly name: string;
  readonly values: PresetValues;
}

export interface PresetBarProps {
  presets: readonly Preset[];
  /** Applied when a preset is chosen or a slot is recalled. */
  onApply: (values: PresetValues) => void;
  /** Current values, captured when the user stores a slot. */
  getCurrentValues: () => PresetValues;
  showAB?: boolean;
  theme?: Partial<AudioTheme>;
}

type Slot = 'A' | 'B';

export function PresetBar({
  presets,
  onApply,
  getCurrentValues,
  showAB = true,
  theme: themeOverride,
}: PresetBarProps) {
  const theme = useAudioTheme(themeOverride);
  const [activeSlot, setActiveSlot] = useState<Slot>('A');
  const [slots, setSlots] = useState<Record<Slot, PresetValues | undefined>>({
    A: undefined,
    B: undefined,
  });

  const switchTo = useCallback(
    (slot: Slot) => {
      if (slot === activeSlot) {
        return;
      }
      // Stash the live settings into the slot being left, so flipping back
      // and forth never loses an edit.
      const current = getCurrentValues();
      setSlots((previous) => {
        const next = { ...previous, [activeSlot]: current };
        const target = next[slot];
        if (target) {
          onApply(target);
        } else {
          // An empty slot starts as a copy, so the first flip is a no-op
          // rather than a jump to silence.
          next[slot] = current;
        }
        return next;
      });
      setActiveSlot(slot);
    },
    [activeSlot, getCurrentValues, onApply]
  );

  const copyToOther = useCallback(() => {
    const other: Slot = activeSlot === 'A' ? 'B' : 'A';
    setSlots((previous) => ({ ...previous, [other]: getCurrentValues() }));
  }, [activeSlot, getCurrentValues]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presets}
      >
        {presets.map((preset) => (
          <Pressable
            key={preset.name}
            onPress={() => onApply(preset.values)}
            accessibilityRole="button"
            accessibilityLabel={`Apply ${preset.name} preset`}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: pressed ? theme.accent : theme.control,
                borderColor: theme.track,
                borderRadius: theme.radius,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: theme.text }]}>
              {preset.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {showAB ? (
        <View style={styles.abGroup}>
          {(['A', 'B'] as const).map((slot) => (
            <Pressable
              key={slot}
              onPress={() => switchTo(slot)}
              accessibilityRole="radio"
              accessibilityState={{ selected: activeSlot === slot }}
              accessibilityLabel={`Preset slot ${slot}`}
              style={[
                styles.abButton,
                {
                  backgroundColor:
                    activeSlot === slot ? theme.accent : theme.control,
                  borderColor: theme.track,
                },
              ]}
            >
              <Text
                style={[
                  styles.abText,
                  {
                    color:
                      activeSlot === slot ? theme.surface : theme.textMuted,
                  },
                ]}
              >
                {slot}
              </Text>
              {/* A dot marks a slot that already holds a stored setting, so
                  it is obvious which side has something to compare against. */}
              {slots[slot] && activeSlot !== slot ? (
                <View
                  style={[styles.storedDot, { backgroundColor: theme.accent }]}
                />
              ) : null}
            </Pressable>
          ))}
          <Pressable
            onPress={copyToOther}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${activeSlot} to the other slot`}
            style={[
              styles.abButton,
              styles.copyButton,
              { backgroundColor: theme.control, borderColor: theme.track },
            ]}
          >
            <Text style={[styles.abText, { color: theme.textMuted }]}>
              {activeSlot === 'A' ? 'A→B' : 'B→A'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  presets: {
    gap: 6,
    paddingRight: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
  },
  abGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  abButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyButton: {
    width: 44,
  },
  storedDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  abText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
