package com.audioeffects

import com.facebook.react.bridge.ReactApplicationContext

class AudioEffectsModule(reactContext: ReactApplicationContext) :
  NativeAudioEffectsSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeAudioEffectsSpec.NAME
  }
}
