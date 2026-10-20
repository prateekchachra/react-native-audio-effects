import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAudioEngine } from 'react-native-audio-effects';
import { ThemeProvider, darkTheme } from 'react-native-audio-effects/ui';

import { GeneratorsScreen } from './screens/GeneratorsScreen';
import { SampleAgentScreen } from './screens/SampleAgentScreen';
import { StudioScreen } from './screens/StudioScreen';

const TABS = [
  { key: 'studio', label: 'Studio' },
  { key: 'generators', label: 'Generators' },
  { key: 'agent', label: 'Samples' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const [tab, setTab] = useState<TabKey>('studio');
  // Mounted once at the root: the engine owns the audio device, so starting
  // it per screen would fight over the session.
  const { isReady, error } = useAudioEngine();

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={darkTheme}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.root}>
          {error ? (
            <View style={styles.center}>
              <Text style={styles.error}>Audio engine failed to start</Text>
              <Text style={styles.errorDetail}>{error.message}</Text>
            </View>
          ) : !isReady ? (
            <View style={styles.center}>
              <ActivityIndicator color={darkTheme.accent} />
              <Text style={styles.loading}>Starting audio engine…</Text>
            </View>
          ) : (
            <>
              <View style={styles.body}>
                {tab === 'studio' ? (
                  <StudioScreen />
                ) : tab === 'generators' ? (
                  <GeneratorsScreen />
                ) : (
                  <SampleAgentScreen />
                )}
              </View>
              <View style={styles.tabBar}>
                {TABS.map(({ key, label }) => (
                  <Pressable
                    key={key}
                    onPress={() => setTab(key)}
                    style={styles.tab}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === key }}
                  >
                    <Text
                      style={[
                        styles.tabLabel,
                        tab === key && styles.tabLabelActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </SafeAreaView>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: darkTheme.surface,
  },
  body: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  loading: {
    color: darkTheme.textMuted,
    fontSize: 13,
  },
  error: {
    color: darkTheme.meterHigh,
    fontSize: 15,
    fontWeight: '600',
  },
  errorDetail: {
    color: darkTheme.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: darkTheme.track,
    backgroundColor: darkTheme.control,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabLabel: {
    color: darkTheme.textMuted,
    fontSize: 13,
    fontFamily: darkTheme.fontFamily,
    letterSpacing: 0.4,
  },
  tabLabelActive: {
    color: darkTheme.accent,
    fontWeight: '700',
  },
});
