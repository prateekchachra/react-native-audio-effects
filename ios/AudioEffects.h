#import <AudioEffectsSpec/AudioEffectsSpec.h>
#import <React/RCTInvalidating.h>

/**
 * TurboModule entry point.
 *
 * This class exists only to satisfy the codegen-generated protocol and to
 * marshal between React's promise blocks and the Swift implementation. All
 * audio logic lives in `AudioEffectsImpl` (Swift), which knows nothing about
 * React — see Backend/AudioBackend.swift.
 *
 * It derives from `NativeAudioEffectsSpecBase` rather than `NSObject` so that
 * the generated `emitOnLevels:` / `emitOnProgress:` / `emitOnError:` event
 * helpers are available.
 */
@interface AudioEffects : NativeAudioEffectsSpecBase <NativeAudioEffectsSpec, RCTInvalidating>

@end
