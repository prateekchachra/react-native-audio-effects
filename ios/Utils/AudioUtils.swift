//
//  AudioUtils.swift
//  AudioEffects
//
//  Created by Prateek Chachra on 6/1/25.
//

import AudioKit
import AudioKitEX
import AVFoundation
import SwiftUI

// Helper functions
class AudioUtils {
    static var sourceBuffer: AVAudioPCMBuffer {
        let url = Bundle.main.resourceURL?.appendingPathComponent("Samples/beat.aiff")
        let file = try! AVAudioFile(forReading: url!)
        return try! AVAudioPCMBuffer(file: file)!
    }
}
