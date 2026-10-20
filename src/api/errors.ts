/**
 * Typed errors.
 *
 * Native rejects promises with a stable string code (see
 * `ios/Support/AudioEffectsError.swift`). These wrappers turn that back into
 * something catchable by class, so callers can branch on the failure instead
 * of matching on a message.
 */

export type AudioErrorCode =
  | 'NOT_CONFIGURED'
  | 'SOURCE_NOT_FOUND'
  | 'EFFECT_NOT_FOUND'
  | 'EFFECT_UNAVAILABLE'
  | 'UNKNOWN_EFFECT'
  | 'UNKNOWN_WAVEFORM'
  | 'FILE_NOT_FOUND'
  | 'DOWNLOAD_FAILED'
  | 'DECODE_FAILED'
  | 'INVALID_CHAIN_ORDER'
  | 'ENGINE_FAILED'
  | 'AUDIO_EFFECTS_ERROR';

export class AudioEffectsError extends Error {
  readonly code: AudioErrorCode;

  constructor(code: AudioErrorCode, message: string) {
    super(message);
    this.name = 'AudioEffectsError';
    this.code = code;
  }
}

/**
 * Thrown when an effect has no implementation on the running platform.
 *
 * Creating an unsupported effect fails loudly rather than returning a handle
 * that quietly does nothing — a silent no-op in an audio chain is close to
 * impossible to diagnose by ear. Check {@link Capabilities} first, or let the
 * UI kit disable the control for you.
 */
export class EffectUnavailableError extends AudioEffectsError {
  readonly effectType: string;

  constructor(effectType: string, message: string) {
    super('EFFECT_UNAVAILABLE', message);
    this.name = 'EffectUnavailableError';
    this.effectType = effectType;
  }
}

/** Thrown when a file cannot be found or decoded. */
export class AudioFileError extends AudioEffectsError {
  readonly uri: string;

  constructor(
    code: 'FILE_NOT_FOUND' | 'DECODE_FAILED' | 'DOWNLOAD_FAILED',
    uri: string,
    message: string
  ) {
    super(code, message);
    this.name = 'AudioFileError';
    this.uri = uri;
  }
}

/** Shape of a rejection coming back across the bridge. */
interface NativeRejection {
  code?: string;
  message?: string;
}

/**
 * Re-throw a native rejection as the most specific error class available.
 *
 * @param context extra detail the native side does not know, such as the URI
 *   or effect type that was being acted on.
 */
export function rethrowNativeError(
  error: unknown,
  context: { uri?: string; effectType?: string } = {}
): never {
  const rejection = error as NativeRejection;
  const code = (rejection?.code ?? 'AUDIO_EFFECTS_ERROR') as AudioErrorCode;
  const message = rejection?.message ?? String(error);

  if (code === 'EFFECT_UNAVAILABLE') {
    throw new EffectUnavailableError(context.effectType ?? 'unknown', message);
  }
  if (
    code === 'FILE_NOT_FOUND' ||
    code === 'DECODE_FAILED' ||
    code === 'DOWNLOAD_FAILED'
  ) {
    throw new AudioFileError(code, context.uri ?? 'unknown', message);
  }
  throw new AudioEffectsError(code, message);
}
