/**
 * Slide-out panel for MIDI devices.
 *
 * Hand-rolled rather than `@react-navigation/drawer`, because this app has
 * no navigator at all — the tab bar is a `useState` — and pulling in
 * `@react-navigation/{native,drawer}`, `react-native-screens` and
 * `safe-area-context` to show one panel would mean four dependencies and
 * another pod install. Reanimated and Gesture Handler are already here for
 * the knobs, and a drawer is a translation and a backdrop.
 *
 * It opens from the header button or an edge swipe, and closes by
 * swiping, tapping the backdrop, or the close button.
 */

import { useCallback, useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { darkTheme } from 'react-native-audio-effects/ui';

const SCREEN_WIDTH = Dimensions.get('window').width;
/** Wide enough for a device name and its transport, never the whole screen. */
export const DRAWER_WIDTH = Math.min(320, SCREEN_WIDTH * 0.84);

/** Past this fraction of the width, releasing completes the open. */
const COMMIT_FRACTION = 0.4;
/** A flick counts even when short, so the drawer feels light. */
const FLICK_VELOCITY = 500;
const DURATION = 220;

export interface MidiDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function MidiDrawer({ open, onOpenChange, children }: MidiDrawerProps) {
  // 0 closed, 1 open. Drives both the panel and the backdrop, so they can
  // never disagree about how far through the gesture we are.
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: DURATION });
  }, [open, progress]);

  const settle = useCallback(
    (next: boolean) => {
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const pan = useDrawerPan(progress, settle);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-DRAWER_WIDTH, 0]) },
    ],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.6,
    // Taken out of the tree when shut, or it would swallow every touch
    // meant for the screen behind it.
    pointerEvents: progress.value > 0.01 ? 'auto' : 'none',
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.host}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => onOpenChange(false)}
            accessibilityLabel="Close MIDI devices"
          />
        </Animated.View>

        <Animated.View style={[styles.panel, panelStyle]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/**
 * The drag that opens and closes it.
 *
 * Built outside the component body so the worklets close over nothing but
 * the shared value and one `runOnJS` callback. A worklet that reaches for
 * a prop captured at render goes stale the moment anything re-renders.
 */
function useDrawerPan(
  progress: SharedValue<number>,
  settle: (open: boolean) => void
) {
  const start = useSharedValue(0);

  return Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onBegin(() => {
      'worklet';
      start.value = progress.value;
    })
    .onUpdate((event) => {
      'worklet';
      const next = start.value + event.translationX / DRAWER_WIDTH;
      progress.value = Math.min(1, Math.max(0, next));
    })
    .onEnd((event) => {
      'worklet';
      const flick = event.velocityX > FLICK_VELOCITY;
      const flickBack = event.velocityX < -FLICK_VELOCITY;
      const open = flick
        ? true
        : flickBack
          ? false
          : progress.value > COMMIT_FRACTION;

      progress.value = withTiming(open ? 1 : 0, { duration: DURATION });
      runOnJS(settle)(open);
    });
}

/** Header row with the button that opens the drawer. */
export function MidiDrawerButton({
  onPress,
  connectedCount,
}: {
  onPress: () => void;
  connectedCount: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.trigger}
      accessibilityRole="button"
      accessibilityLabel={
        connectedCount > 0
          ? `MIDI devices, ${connectedCount} connected`
          : 'MIDI devices'
      }
    >
      <View style={styles.triggerLines}>
        <View style={styles.triggerLine} />
        <View style={styles.triggerLine} />
        <View style={styles.triggerLine} />
      </View>
      <Text style={styles.triggerLabel}>MIDI</Text>
      {connectedCount > 0 ? <View style={styles.triggerDot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Sits above the screen but is invisible and untouchable while shut,
    // except for the edge where the swipe starts.
    zIndex: 10,
    pointerEvents: 'box-none',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#000',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: darkTheme.control,
    borderRightWidth: 1,
    borderRightColor: darkTheme.track,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  triggerLines: {
    gap: 3,
  },
  triggerLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: darkTheme.textMuted,
  },
  triggerLabel: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
    letterSpacing: 1,
  },
  triggerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: darkTheme.accent,
  },
});
