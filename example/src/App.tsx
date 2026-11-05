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

import { MidiDevicePanel } from './MidiDevicePanel';
import { MidiDrawer, MidiDrawerButton } from './MidiDrawer';
import { GeneratorsScreen } from './screens/GeneratorsScreen';
import { SampleAgentScreen } from './screens/SampleAgentScreen';
import { StudioScreen } from './screens/StudioScreen';
import { VoiceScreen } from './screens/VoiceScreen';
import { useMidiNotes } from './useMidiNotes';

const TABS = [
  { key: 'studio', label: 'Studio' },
  { key: 'generators', label: 'Generators' },
  { key: 'voice', label: 'Voice' },
  { key: 'agent', label: 'Samples' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const [tab, setTab] = useState<TabKey>('studio');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  // Mounted once at the root: the engine owns the audio device, so starting
  // it per screen would fight over the session.
  const { isReady, error } = useAudioEngine();
  // Watched at the root so the drawer can show incoming notes whichever
  // screen is in front.
  const lastNote = useMidiNotes();

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
              <MidiDrawerButton
                onPress={() => setDrawerOpen(true)}
                connectedCount={connectedCount}
              />
              <View style={styles.body}>
                {tab === 'studio' ? (
                  <StudioScreen />
                ) : tab === 'generators' ? (
                  <GeneratorsScreen />
                ) : tab === 'voice' ? (
                  <VoiceScreen />
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

          {/*
            Outside the loading branch so the drawer is reachable even if
            the engine failed — a MIDI device that is not showing up is
            exactly when you want to look at this list.
          */}
          <MidiDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <MidiDevicePanel
              onClose={() => setDrawerOpen(false)}
              lastNote={lastNote}
              onConnectedCountChange={setConnectedCount}
            />
          </MidiDrawer>
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
