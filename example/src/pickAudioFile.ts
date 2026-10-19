/**
 * Audio file picking.
 *
 * `@react-native-documents/picker` is an optional peer dependency of the
 * library, so this resolves it lazily and degrades to a message when it is
 * not installed rather than crashing the screen.
 */

import { Alert } from 'react-native';

type Picker = typeof import('@react-native-documents/picker');

function loadPicker(): Picker | undefined {
  try {
    return require('@react-native-documents/picker') as Picker;
  } catch {
    return undefined;
  }
}

export async function pickAudioFile(): Promise<string | undefined> {
  const picker = loadPicker();
  if (!picker) {
    Alert.alert(
      'Picker not installed',
      'Install @react-native-documents/picker to import your own files, or ' +
        'use the bundled sample.'
    );
    return undefined;
  }

  try {
    const [file] = await picker.pick({ type: [picker.types.audio] });
    return file?.uri;
  } catch (error) {
    // The picker rejects when the user backs out, which is not a failure.
    if (
      picker.isErrorWithCode(error) &&
      error.code === picker.errorCodes.OPERATION_CANCELED
    ) {
      return undefined;
    }
    Alert.alert('Could not open file', String(error));
    return undefined;
  }
}
