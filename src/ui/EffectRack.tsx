/**
 * A plugin panel generated from the schema.
 *
 * Every control's range, curve, unit and formatting comes from the same
 * descriptor the native adapters read, so a panel cannot drift out of step
 * with the DSP behind it. Adding a parameter to `src/schema/effects.ts` makes
 * a control appear here with no UI changes at all.
 *
 * Parameters the running platform does not implement are rendered disabled
 * rather than hidden — a missing control is confusing, a greyed one explains
 * itself.
 */

import { useCallback, useEffect, useReducer } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import type { Effect } from '../api/Effect';
import { isParamAvailable } from '../api/capabilities';
import type { ParamDescriptor } from '../schema';
import { EffectSlider } from './EffectSlider';
import { Knob } from './Knob';
import { useAudioTheme, type AudioTheme } from './theme';

export interface EffectPanelProps {
  effect: Effect;
  /** `knobs` suits a dense rack; `sliders` reads better on narrow screens. */
  layout?: 'knobs' | 'sliders';
  /** Hide the bypass switch and header, e.g. when embedding in your own card. */
  showHeader?: boolean;
  onRemove?: () => void;
  theme?: Partial<AudioTheme>;
}

/**
 * One effect's controls.
 *
 * The effect's values live in native, not in React state, so edits are pushed
 * straight through and a counter forces the re-render. Mirroring parameters
 * into state would mean two sources of truth for the same number.
 */
export function EffectPanel({
  effect,
  layout = 'knobs',
  showHeader = true,
  onRemove,
  theme: themeOverride,
}: EffectPanelProps) {
  const theme = useAudioTheme(themeOverride);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    forceRender();
  }, [effect]);

  const setParam = useCallback(
    (param: ParamDescriptor, value: number) => {
      effect.set(param.key, value);
      forceRender();
    },
    [effect]
  );

  const toggleBypass = useCallback(
    (enabled: boolean) => {
      effect.enabled = enabled;
      forceRender();
    },
    [effect]
  );

  const available = (param: ParamDescriptor) =>
    isParamAvailable(effect.type, param.key);

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.surface, borderRadius: theme.radius },
      ]}
    >
      {showHeader ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.text }]}>
              {effect.descriptor.label}
            </Text>
            <Text style={[styles.category, { color: theme.textMuted }]}>
              {effect.descriptor.category}
            </Text>
          </View>

          <View style={styles.headerActions}>
            {onRemove ? (
              <Pressable
                onPress={onRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${effect.descriptor.label}`}
                hitSlop={8}
              >
                <Text style={[styles.remove, { color: theme.textMuted }]}>
                  Remove
                </Text>
              </Pressable>
            ) : null}
            <Switch
              value={effect.enabled}
              onValueChange={toggleBypass}
              accessibilityLabel={`Bypass ${effect.descriptor.label}`}
            />
          </View>
        </View>
      ) : null}

      <View style={layout === 'knobs' ? styles.knobGrid : styles.sliderStack}>
        {effect.params.map((param) =>
          layout === 'knobs' ? (
            <Knob
              key={param.key}
              param={param}
              value={effect.get(param.key)}
              onChange={(value) => setParam(param, value)}
              disabled={!available(param) || !effect.enabled}
              theme={themeOverride}
            />
          ) : (
            <EffectSlider
              key={param.key}
              param={param}
              value={effect.get(param.key)}
              onChange={(value) => setParam(param, value)}
              disabled={!available(param) || !effect.enabled}
              theme={themeOverride}
            />
          )
        )}
      </View>
    </View>
  );
}

export interface EffectRackProps {
  effects: readonly Effect[];
  layout?: 'knobs' | 'sliders';
  onRemove?: (effect: Effect) => void;
  /** Lay the panels out horizontally, like a hardware rack. */
  horizontal?: boolean;
  theme?: Partial<AudioTheme>;
}

/** A whole chain, one panel per effect, in signal order. */
export function EffectRack({
  effects,
  layout = 'knobs',
  onRemove,
  horizontal = false,
  theme: themeOverride,
}: EffectRackProps) {
  const theme = useAudioTheme(themeOverride);

  if (effects.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: theme.textMuted }]}>
          No effects yet. Add one to get started.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal={horizontal}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={horizontal ? styles.rackRow : styles.rackColumn}
    >
      {effects.map((effect) => (
        <EffectPanel
          key={effect.id}
          effect={effect}
          layout={layout}
          onRemove={onRemove ? () => onRemove(effect) : undefined}
          theme={themeOverride}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 12,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    flexShrink: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  category: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  remove: {
    fontSize: 12,
  },
  knobGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  sliderStack: {
    gap: 10,
  },
  rackColumn: {
    gap: 12,
    paddingBottom: 24,
  },
  rackRow: {
    flexDirection: 'row',
    gap: 12,
    paddingRight: 12,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
  },
});
