/**
 * Ask for a sample in plain English, audition it, keep it.
 *
 * Runs against Openverse, which needs no API key, so this works on a
 * fresh install with nothing configured.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SampleAgent,
  attributionFor,
  type SampleQuery,
  type SampleResult,
  type Source,
} from 'react-native-audio-effects';
import { darkTheme } from 'react-native-audio-effects/ui';

const EXAMPLES = [
  'a gritty 90bpm lofi drum loop',
  'warm analog pad in F#m',
  'snare one shot under 2 seconds',
  'vinyl crackle',
];

export function SampleAgentScreen() {
  const agent = useMemo(() => new SampleAgent({ pageSize: 20 }), []);
  const [prompt, setPrompt] = useState('');
  const [query, setQuery] = useState<SampleQuery>();
  const [results, setResults] = useState<SampleResult[]>([]);
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [playingId, setPlayingId] = useState<string>();

  // One source at a time: auditioning a second sample should replace the
  // first, not layer on top of it.
  const auditionRef = useRef<Source | undefined>(undefined);

  const stopAudition = useCallback(async () => {
    const current = auditionRef.current;
    auditionRef.current = undefined;
    setPlayingId(undefined);
    if (current) {
      await current.release().catch(() => undefined);
    }
  }, []);

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) {
        return;
      }
      setBusy(true);
      setStatus('Searching…');
      setResults([]);
      try {
        const found = await agent.find(trimmed);
        setQuery(found.query);
        setResults([...found.results]);
        setStatus(
          found.results.length === 0
            ? 'Nothing found. Try different words.'
            : `${found.results.length} results`
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [agent, busy]
  );

  const audition = useCallback(
    async (result: SampleResult) => {
      if (playingId === result.id) {
        await stopAudition();
        return;
      }
      await stopAudition();
      setStatus(`Loading "${result.title}"…`);
      try {
        // The remote URL goes straight to the engine; the native importer
        // downloads and decodes it into its own cache.
        const loaded = await agent.load(result);
        auditionRef.current = loaded.source;
        await loaded.source.play({ loop: false });
        setPlayingId(result.id);
        setStatus(loaded.attribution);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [agent, playingId, stopAudition]
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Sample Agent</Text>
      <Text style={styles.description}>
        Describe the sound you want. Searches Openverse — openly licensed audio
        from Freesound and others, no account needed.
      </Text>

      <View style={styles.searchRow}>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder="a gritty 90bpm lofi drum loop"
          placeholderTextColor={darkTheme.textMuted}
          style={styles.input}
          returnKeyType="search"
          onSubmitEditing={() => {
            runSearch(prompt).catch(() => undefined);
          }}
        />
        <Pressable
          onPress={() => {
            runSearch(prompt).catch(() => undefined);
          }}
          disabled={busy || prompt.trim().length === 0}
          style={[
            styles.searchButton,
            (busy || prompt.trim().length === 0) && styles.disabled,
          ]}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={darkTheme.surface} size="small" />
          ) : (
            <Text style={styles.searchLabel}>Find</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.chips}>
        {EXAMPLES.map((example) => (
          <Pressable
            key={example}
            onPress={() => {
              setPrompt(example);
              runSearch(example).catch(() => undefined);
            }}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{example}</Text>
          </Pressable>
        ))}
      </View>

      {query ? (
        <View style={styles.understood}>
          <Text style={styles.understoodTitle}>Understood</Text>
          <Text style={styles.understoodBody}>
            {Object.entries(query.understood)
              .map(([key, value]) => `${key}: ${value}`)
              .join('  ·  ') || 'nothing specific'}
          </Text>
        </View>
      ) : null}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      {results.map((result) => {
        const active = result.id === playingId;
        return (
          <Pressable
            key={result.id}
            onPress={() => {
              audition(result).catch(() => undefined);
            }}
            style={[styles.result, active && styles.resultActive]}
            accessibilityRole="button"
            accessibilityLabel={`Play ${result.title}`}
          >
            <Text style={styles.resultTitle} numberOfLines={1}>
              {active ? '◼ ' : '▶ '}
              {result.title}
            </Text>
            <Text style={styles.resultMeta}>{attributionFor(result)}</Text>
            {result.durationSec !== undefined ? (
              <Text style={styles.resultMeta}>
                {Math.round(result.durationSec)}s
              </Text>
            ) : null}
          </Pressable>
        );
      })}

      {results.length > 0 ? (
        <Text style={styles.licenceNote}>
          Most of these are CC-BY: crediting the creator is a licence condition,
          not a courtesy. The credit line above each result is the one to use.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: darkTheme.surface },
  content: { padding: 18, gap: 12, paddingBottom: 48 },
  heading: {
    color: darkTheme.text,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.4,
  },
  description: {
    color: darkTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: darkTheme.fontFamily,
  },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 14,
    backgroundColor: darkTheme.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchButton: {
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: darkTheme.accent,
    minWidth: 72,
    alignItems: 'center',
  },
  disabled: { opacity: 0.35 },
  searchLabel: {
    color: darkTheme.surface,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: darkTheme.surface,
  },
  chipText: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
  },
  understood: {
    backgroundColor: darkTheme.surface,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  understoodTitle: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  understoodBody: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
  },
  status: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
    fontStyle: 'italic',
  },
  result: {
    backgroundColor: darkTheme.surface,
    borderRadius: 14,
    padding: 12,
    gap: 3,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  resultActive: { borderColor: darkTheme.accent },
  resultTitle: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  resultMeta: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
  },
  licenceNote: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
