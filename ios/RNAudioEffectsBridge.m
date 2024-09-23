//
//  RNAudioEffectsBridge.m
//  AudioEffects
//
//  Created by Prateek Chachra on 22/9/24.
//

#import "RNAudioEffectsBridge.h"
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_REMAP_MODULE(AudioEffectsModule, AudioEffects, NSObject)

RCT_EXTERN_METHOD(playBrownNoise:(float)decibels);
RCT_EXTERN_METHOD(stopBrownNoise);

RCT_EXTERN_METHOD(playPinkNoise:(float)decibels);
RCT_EXTERN_METHOD(stopPinkNoise);

RCT_EXTERN_METHOD(playWhiteNoise:(float)decibels);
RCT_EXTERN_METHOD(stopWhiteNoise);

@end
