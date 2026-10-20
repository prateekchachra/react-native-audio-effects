#import "AudioEffects.h"

// CocoaPods places the generated Swift header differently depending on whether
// the pod is built as a static library or a framework.
#if __has_include("AudioEffects-Swift.h")
#import "AudioEffects-Swift.h"
#else
#import <AudioEffects/AudioEffects-Swift.h>
#endif

/**
 * Error codes travel in `NSError.userInfo[@"code"]` so that JS receives a
 * stable machine-readable string (`EFFECT_UNAVAILABLE`, `SOURCE_NOT_FOUND`,
 * ...) rather than a numeric domain code. See AudioEffectsError.swift.
 */
static NSString *RNAECodeForError(NSError *error)
{
  NSString *code = error.userInfo[@"code"];
  return code.length > 0 ? code : @"AUDIO_EFFECTS_ERROR";
}

@implementation AudioEffects {
  AudioEffectsImpl *_impl;
}

- (instancetype)init
{
  if (self = [super init]) {
    _impl = [AudioEffectsImpl new];

    // The engine reports level, progress and audio-thread errors on its own
    // schedule, not in response to a call, so they are delivered as events.
    __weak __typeof(self) weakSelf = self;
    _impl.onLevels = ^(NSDictionary *payload) { [weakSelf emitOnLevels:payload]; };
    _impl.onProgress = ^(NSDictionary *payload) { [weakSelf emitOnProgress:payload]; };
    _impl.onError = ^(NSDictionary *payload) { [weakSelf emitOnError:payload]; };
  }
  return self;
}

/**
 * Release the audio engine when the bridge goes away.
 *
 * Without this a reload would leave the previous engine running and holding
 * the audio session, so the app would stack up engines and keep playing.
 */
- (void)invalidate
{
  [_impl teardownWithCompletion:^(NSError *_Nullable error) {
  }];
}

/** Audio setup touches AVAudioSession; it does not need the main queue. */
+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

#pragma mark - Promise helpers

/** Adapt a Swift `(NSError?) -> Void` completion to a React promise pair. */
static void (^RNAEVoidCompletion(RCTPromiseResolveBlock resolve,
                                 RCTPromiseRejectBlock reject))(NSError *)
{
  return ^(NSError *error) {
    if (error != nil) {
      reject(RNAECodeForError(error), error.localizedDescription, error);
    } else {
      resolve(nil);
    }
  };
}

/** Adapt a Swift `(id?, NSError?) -> Void` completion to a React promise pair. */
static void (^RNAEValueCompletion(RCTPromiseResolveBlock resolve,
                                  RCTPromiseRejectBlock reject))(id, NSError *)
{
  return ^(id value, NSError *error) {
    if (error != nil) {
      reject(RNAECodeForError(error), error.localizedDescription, error);
    } else {
      resolve(value);
    }
  };
}

#pragma mark - Engine

- (void)configure:(JS::NativeAudioEffects::EngineOptions &)options
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  std::optional<double> sampleRate = options.sampleRate();
  std::optional<double> bufferFrames = options.bufferFrames();

  [_impl configureWithSampleRate:sampleRate.has_value() ? @(*sampleRate) : nil
                    bufferFrames:bufferFrames.has_value() ? @(*bufferFrames) : nil
                        category:options.category()
                      completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)start:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl startWithCompletion:RNAEVoidCompletion(resolve, reject)];
}

- (void)stop:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl stopWithCompletion:RNAEVoidCompletion(resolve, reject)];
}

- (void)teardown:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_impl teardownWithCompletion:RNAEVoidCompletion(resolve, reject)];
}

#pragma mark - Sources

- (void)loadFile:(NSString *)uri
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  [_impl loadFile:uri completion:RNAEValueCompletion(resolve, reject)];
}

- (void)createOscillator:(NSString *)waveform
                 options:(JS::NativeAudioEffects::OscillatorOptions &)options
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  std::optional<double> frequency = options.frequency();
  std::optional<double> amplitude = options.amplitude();
  std::optional<bool> antialias = options.antialias();

  [_impl createOscillator:waveform
                frequency:frequency.has_value() ? @(*frequency) : nil
                amplitude:amplitude.has_value() ? @(*amplitude) : nil
                antialias:antialias.has_value() ? @(*antialias) : nil
               completion:RNAEValueCompletion(resolve, reject)];
}

- (void)releaseSource:(double)sourceId
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [_impl releaseSource:sourceId completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)playSource:(double)sourceId
              loop:(BOOL)loop
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [_impl playSource:sourceId loop:loop completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)pauseSource:(double)sourceId
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [_impl pauseSource:sourceId completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)stopSource:(double)sourceId
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [_impl stopSource:sourceId completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)seekSource:(double)sourceId
       positionSec:(double)positionSec
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [_impl seekSource:sourceId
        positionSec:positionSec
         completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)setSourceVolume:(double)sourceId volume:(double)volume
{
  [_impl setSourceVolume:sourceId volume:volume];
}

- (void)setSourcePan:(double)sourceId pan:(double)pan
{
  [_impl setSourcePan:sourceId pan:pan];
}

- (void)setOscillatorParameter:(double)sourceId
                           key:(NSString *)key
                         value:(double)value
{
  [_impl setOscillatorParameter:sourceId key:key value:value];
}

- (void)setEnvelopeParameter:(double)sourceId
                         key:(NSString *)key
                       value:(double)value
{
  [_impl setEnvelopeParameter:sourceId key:key value:value];
}

- (void)gateSource:(double)sourceId on:(BOOL)on
{
  [_impl gateSource:sourceId on:on];
}

#pragma mark - Effects

- (void)createEffect:(double)sourceId
                type:(NSString *)type
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [_impl createEffect:sourceId
                 type:type
           completion:RNAEValueCompletion(resolve, reject)];
}

- (void)removeEffect:(double)effectId
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [_impl removeEffect:effectId completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)reorderChain:(double)sourceId
           effectIds:(NSArray *)effectIds
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [_impl reorderChain:sourceId
            effectIds:effectIds
           completion:RNAEVoidCompletion(resolve, reject)];
}

- (void)setEffectEnabled:(double)effectId enabled:(BOOL)enabled
{
  [_impl setEffectEnabled:effectId enabled:enabled];
}

#pragma mark - Parameters

- (void)setParameter:(double)effectId key:(NSString *)key value:(double)value
{
  [_impl setParameter:effectId key:key value:value];
}

- (void)setParameters:(NSArray *)changes
{
  [_impl setParameters:changes];
}

- (NSNumber *)getParameter:(double)effectId key:(NSString *)key
{
  return [_impl getParameter:effectId key:key];
}

#pragma mark - Capabilities and metering

- (NSString *)getCapabilitiesJSON
{
  return [_impl capabilitiesJSON];
}

- (void)setMeteringEnabled:(BOOL)enabled intervalMs:(double)intervalMs
{
  [_impl setMeteringEnabled:enabled intervalMs:intervalMs];
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeAudioEffectsSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"AudioEffects";
}

@end
