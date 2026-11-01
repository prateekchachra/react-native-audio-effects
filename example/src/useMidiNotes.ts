/**
 * The most recent note from any connected controller.
 *
 * Only for showing that bytes are arriving — the drawer's "last note"
 * readout. The notes that actually sound are routed straight to the synth
 * by `MidiInput.routeTo`, which does not go through React state, because
 * putting a key press through a re-render would add latency to the one
 * thing that must not have any.
 */

import { useEffect, useState } from 'react';
import { MidiInput, noteName } from 'react-native-audio-effects';

export function useMidiNotes(): string | undefined {
  const [last, setLast] = useState<string>();

  useEffect(
    () =>
      MidiInput.addListener((message) => {
        if (message.type === 'noteOn') {
          setLast(`${noteName(message.note)} · ${message.velocity}`);
        }
      }),
    []
  );

  return last;
}
