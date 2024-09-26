//
//  AudioUtils.swift
//  AudioEffects
//
//  Created by Prateek Chachra on 25/9/24.
//

import AVFoundation

class AudioUtils {
  static var sourceBuffer: AVAudioPCMBuffer {
    let url =  Bundle.module.resourceURL?.appendingPathComponent("Samples/beat.aiff")
    let file = try! AVAudioFile(forReading: url!)
    return try! AVAudioPCMBuffer(file: file)!
  }
}
