/**
 * What lives inside the MIDI drawer.
 *
 * Lists every input the system can see, says how each one is attached,
 * and connects or disconnects on tap. Bluetooth gets its own button,
 * because a BLE controller does not appear in this list at all until it
 * has been paired through the system sheet — there is no Settings pane
 * for them, so an app that does not offer the sheet gives the user no
 * way in.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MidiInput, type MidiDeviceInfo } from 'react-native-audio-effects';
import { darkTheme } from 'react-native-audio-effects/ui';

/** How each transport reads in the list. */
const TRANSPORT_LABEL: Record<string, string> = {
  usb: 'USB',
  bluetooth: 'Bluetooth',
  network: 'Network',
  virtual: 'Virtual',
  unknown: 'MIDI',
};

export interface MidiDevicePanelProps {
  onClose: () => void;
  /** Last note seen, so the panel can show that bytes are arriving. */
  lastNote?: string;
  onConnectedCountChange?: (count: number) => void;
}

export function MidiDevicePanel({
  onClose,
  lastNote,
  onConnectedCountChange,
}: MidiDevicePanelProps) {
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [enabling, setEnabling] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const found = await MidiInput.list();
      setDevices(found);
      onConnectedCountChange?.(found.filter((d) => d.isConnected).length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onConnectedCountChange]);

  // The client is opened here rather than at app start so that an app that
  // never opens this drawer never touches CoreMIDI, and never provokes the
  // Bluetooth permission prompt that creating a client can.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await MidiInput.setEnabled(true);
        if (!cancelled) {
          await refresh();
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) {
          setEnabling(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Hot-plug: a cable going in or a Bluetooth pairing completing changes
  // the list without anything in the app asking.
  useEffect(() => MidiInput.onDevicesChanged(refresh), [refresh]);

  const toggle = useCallback(
    async (device: MidiDeviceInfo) => {
      setBusy(device.id);
      setError(undefined);
      try {
        if (device.isConnected) {
          await MidiInput.disconnect(device.id);
        } else {
          await MidiInput.connect(device.id);
        }
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(undefined);
      }
    },
    [refresh]
  );

  const pair = useCallback(async () => {
    setError(undefined);
    try {
      await MidiInput.presentBluetoothPairing();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>MIDI</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close">
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {enabling ? (
          <View style={styles.center}>
            <ActivityIndicator color={darkTheme.accent} />
          </View>
        ) : devices.length === 0 ? (
          <Text style={styles.empty}>
            No MIDI inputs found. Plug a controller into USB-C, or pair one over
            Bluetooth below.
          </Text>
        ) : (
          devices.map((device) => (
            <Pressable
              key={device.id}
              onPress={() => toggle(device)}
              disabled={busy === device.id}
              style={[styles.device, device.isConnected && styles.deviceOn]}
              accessibilityRole="switch"
              accessibilityState={{ checked: device.isConnected }}
            >
              <View style={styles.deviceText}>
                <Text style={styles.deviceName} numberOfLines={1}>
                  {device.name}
                </Text>
                <Text style={styles.deviceMeta} numberOfLines={1}>
                  {[
                    TRANSPORT_LABEL[device.transport] ?? device.transport,
                    device.manufacturer,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {busy === device.id ? (
                <ActivityIndicator color={darkTheme.accent} size="small" />
              ) : (
                <View
                  style={[styles.dot, device.isConnected && styles.dotOn]}
                />
              )}
            </Pressable>
          ))
        )}

        {Platform.OS === 'ios' ? (
          <Pressable onPress={pair} style={styles.pair}>
            <Text style={styles.pairLabel}>Pair a Bluetooth device</Text>
          </Pressable>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.activity}>
          <Text style={styles.activityLabel}>LAST NOTE</Text>
          <Text style={styles.activityValue}>{lastNote ?? '—'}</Text>
        </View>

        <Text style={styles.note}>
          A simulator cannot see USB or Bluetooth controllers — neither is
          passed through to it. Run on a device to play one.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 54 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: darkTheme.track,
  },
  title: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 20,
    fontWeight: '700',
  },
  close: {
    color: darkTheme.accent,
    fontFamily: darkTheme.fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  list: { padding: 14, gap: 10 },
  center: { paddingVertical: 30, alignItems: 'center' },
  empty: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 8,
  },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: darkTheme.surface,
    borderWidth: 1,
    borderColor: darkTheme.track,
  },
  deviceOn: { borderColor: darkTheme.accent },
  deviceText: { flex: 1, gap: 3 },
  deviceName: {
    color: darkTheme.text,
    fontFamily: darkTheme.fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  deviceMeta: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: darkTheme.track,
  },
  dotOn: { backgroundColor: darkTheme.accent },
  pair: {
    marginTop: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: darkTheme.track,
    alignItems: 'center',
  },
  pairLabel: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 13,
  },
  error: {
    color: darkTheme.meterHigh,
    fontFamily: darkTheme.fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  activity: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: darkTheme.surface,
    gap: 4,
  },
  activityLabel: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 9,
    letterSpacing: 1,
  },
  activityValue: {
    color: darkTheme.accent,
    fontFamily: darkTheme.fontFamily,
    fontSize: 18,
    fontWeight: '700',
  },
  note: {
    color: darkTheme.textMuted,
    fontFamily: darkTheme.fontFamily,
    fontSize: 10,
    lineHeight: 15,
    paddingTop: 6,
  },
});
