//
//  AudioEffects.swift
//  AudioEffects
//
//  Created by Prateek Chachra on 22/9/24.
//  Copyright © 2024 David Chavez. All rights reserved.
//
//

import Foundation
import React
import SoundpipeAudioKit
import AudioKit
import AVFoundation

@objc(AudioEffects)
public class AudioEffects: RCTEventEmitter {
  
  private var engine = AudioEngine()
  
  private var brownianNoise = BrownianNoise()
  private var pinkNoise = PinkNoise()
  private var whiteNoise = WhiteNoise()
  private var mixer = Mixer()
  private var conductor = DelayConductor()
  private var isPlaying = false;
  
  public override init() {
    super.init()
    EventEmitter.shared.register(eventEmitter: self)
    setupAudioEngine()
  }
  
  private func setupAudioEngine() {
    engine.output = mixer
  }
  @objc(playBrownNoise:)
  public func playBrownNoise(decibels: Float) {

    if(decibels <= 1 && decibels >= 0){
      do {
         try engine.start()
       } catch {
         print("Failed to start the audio engine: \(error)")
       }
      brownianNoise.amplitude = decibels
      mixer.addInput(brownianNoise)
      brownianNoise.start()
    }
  }
  
  @objc(stopBrownNoise)
  public func stopBrownNoise() {
    brownianNoise.stop()  // Stop the noise generator
  }
  
  @objc(playPinkNoise:)
  public func playPinkNoise(decibels: Float) {

    if(decibels <= 1 && decibels >= 0){
      do {
         try engine.start()
       } catch {
         print("Failed to start the audio engine: \(error)")
       }
      pinkNoise.amplitude = decibels
      mixer.addInput(pinkNoise)
      pinkNoise.start()
    }
  }
  
  @objc(stopPinkNoise)
  public func stopPinkNoise() {
    pinkNoise.stop()  // Stop the noise generator
  }
  
  @objc(playWhiteNoise:)
  public func playWhiteNoise(decibels: Float) {

    if(decibels <= 1 && decibels >= 0){
      do {
         try engine.start()
       } catch {
         print("Failed to start the audio engine: \(error)")
       }
      whiteNoise.amplitude = decibels
      mixer.addInput(whiteNoise)
      whiteNoise.start()
    }
  }
  
  @objc(stopWhiteNoise)
  public func stopWhiteNoise() {
    whiteNoise.stop()  // Stop the noise generator
  }
  
  @objc(playSound:fileName:decibels:)
  public func playSound(isLoop: Bool, fileName: String, decibels: Float){
    conductor.player.stop()
    Log(fileName);
    
    guard let url = URL(string: fileName),
          let buffer = try? AVAudioPCMBuffer(url: url)
    else {
        Log("failed to load sample", fileName)
        return
    }
    conductor.player.buffer = buffer
    conductor.player.volume = decibels
    conductor.player.file = try? AVAudioFile(forReading: url)
    conductor.player.isLooping = true
    
    if isPlaying == false {
      
      conductor.player.play()
    }
  }
  
  @objc(stopSound)
  public func stopSound(){
    conductor.player.stop()
  }
  
  @objc(addDelayToSound:delayTime:feedback:lowPassCutoff:)
  public func addDelayToSound(dryWetMix: Float, delayTime: Float, feedback: Float, lowPassCutoff: Float) {

    conductor.delay.feedback = feedback;
    conductor.delay.time = delayTime;
    conductor.delay.lowPassCutoff = lowPassCutoff;
    conductor.dryWetMixer.balance = dryWetMix;
    conductor.player.play()
  }
  
  @objc(stopDelayPlayer)
  public func addDelay() {
    conductor.player.stop()
  }
  
  override public func supportedEvents() -> [String]! {
    return []
  }
}
