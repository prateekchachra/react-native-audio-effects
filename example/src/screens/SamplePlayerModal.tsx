/**
 * Transport for auditioning one sample.
 *
 * Tapping a row to toggle playback was not enough: there was no way to
 * see whether anything was loading, where you were in a 5-minute field
 * recording, or why a load had failed. This gives the audition its own
 * surface with a real transport, a scrubbable position, and somewhere
 * for an error to be shown rather than swallowed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  attributionFor,
  type SampleAgent,
  type SampleResult,
  type Source,
} from 'react-native-audio-effects';
import { darkTheme } from 'react-native-audio-effects/ui';

import { useLiveProgress } from '../useLive';

export interface SamplePlayerModalProps {
  agent: SampleAgent;
  result: SampleResult | undefined;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function SamplePlayerModal({
  agent,
  result,
  onClose,
}: SamplePlayerModalProps) {
  const [source, setSource] = useState<Source>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [isPlaying, setIsPlaying] = useState(false);

  const progress = useLiveProgress(source);
  // Held in a ref as well so the unmount cleanup can reach the current
  // source without re-running the load effect every time state changes.
  const sourceRef = useRef<Source | undefined>(undefined);

  // Load whenever a new result is opened, and tear down on close. The
  // download happens natively, so this can take a few seconds on a
  // large file — hence the explicit loading state.
  useEffect(() => {
    if (!result) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setIsPlaying(false);

    agent
      .load(result)
      .then(async (loaded) => {
        if (cancelled) {
          // The user closed the sheet mid-download; do not leak the source.
          await loaded.source.release().catch(() => undefined);
          return;
        }
        sourceRef.current = loaded.source;
        setSource(loaded.source);
        setLoading(false);
        await loaded.source.play({ loop: false });
        setIsPlaying(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
      const current = sourceRef.current;
      sourceRef.current = undefined;
      setSource(undefined);
      current?.release().catch(() => undefined);
    };
  }, [agent, result]);

  const toggle = useCallback(() => {
    const current = sourceRef.current;
    if (!current || current.isReleased) {
      return;
    }
    const wasPlaying = isPlaying;
    setIsPlaying(!wasPlaying);
    const action = wasPlaying ? current.pause() : current.play({ loop: false });
    action.catch((caught: unknown) => {
      setIsPlaying(wasPlaying);
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }, [isPlaying]);

  const restart = useCallback(() => {
    const current = sourceRef.current;
    if (!current || current.isReleased) {
      return;
    }
    current
      .seek(0)
      .then(() => current.play({ loop: false }))
      .then(() => setIsPlaying(true))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  }, []);

  const duration = progress.durationSec || result?.durationSec || 0;
  const fraction =
    duration > 0 ? Math.min(1, progress.positionSec / duration) : 0;

  return (
    <Modal
      visible={result !== undefined}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps on the sheet so they do not dismiss it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />

          <Text style={styles.title} numberOfLines={2}>
            {result?.title ?? ''}
          </Text>
          {result ? (
            <Text style={styles.credit}>{attributionFor(result)}</Text>
          ) : null}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.trackRow}>
            <Text style={styles.time}>{formatTime(progress.positionSec)}</Text>
            <View style={styles.track}>
              <View
                style={[styles.trackFill, { width: `${fraction * 100}%` }]}
              />
            </View>
            <Text style={styles.time}>{formatTime(duration)}</Text>
          </View>

          <View style={styles.transport}>
            <Pressable
              onPress={restart}
              disabled={!source}
              style={[styles.secondary, !source && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel="Restart"
            >
              <Text style={styles.secondaryGlyph}>↺</Text>
            </Pressable>

            <Pressable
              onPress={toggle}
              disabled={!source || loading}
              style={[
                styles.playButton,
                (!source || loading) && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            >
              {loading ? (
                <ActivityIndicator color={darkTheme.surface} />
              ) : (
                <Text style={styles.playGlyph}>{isPlaying ? '❚❚' : '▶'}</Text>
              )}
            </Pressable>

            <Pressable
              onPress={onClose}
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.secondaryGlyph}>✕</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            {loading
              ? 'Downloading and decoding…'
              : error
                ? 'This one could not be loaded. Try another result.'
                : `${result?.provider ?? 'openverse'} · ${result?.license.toUpperCase() ?? ''}`}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 5, 14, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: darkTheme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    paddingBottom: 38,
    gap: 14,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: darkTheme.textMuted,
    opacity: 0.5,
    marginBottom: 4,
  },
  title: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 17,
    fontWeight: '700',
  },
  credit: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 90, 110, 0.12)',
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    color: '#ff8d9c',
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
    minWidth: 36,
    textAlign: 'center',
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: darkTheme.track,
    overflow: 'hidden',
  },
  trackFill: { height: '100%', backgroundColor: darkTheme.accent },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    paddingTop: 2,
  },
  playButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: darkTheme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    color: darkTheme.surface,
    fontSize: 21,
    fontWeight: '700',
  },
  secondary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: darkTheme.control,
  },
  secondaryGlyph: {
    color: darkTheme.text,
    fontSize: 17,
  },
  disabled: { opacity: 0.4 },
  hint: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
    textAlign: 'center',
  },
});
