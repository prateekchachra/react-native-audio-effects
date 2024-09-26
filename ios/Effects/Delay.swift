//
//  Delay.swift
//  AudioEffects
//
//  Created by Prateek Chachra on 24/9/24.
//
import AudioKit
import AudioKitEX
import AVFoundation

class DelayConductor: ObservableObject, ProcessesPlayerInput {
    let engine = AudioEngine()
    let player = AudioPlayer()
    let delay: Delay
    let dryWetMixer: DryWetMixer
    let buffer: AVAudioPCMBuffer

    init() {
        buffer = AudioUtils.sourceBuffer
        player.buffer = buffer
        player.isLooping = true

        delay = Delay(player)
        delay.feedback = 0.9
        delay.time = 0.01

        // We're not using delay's built in dry wet mix because
        // we are tapping the wet result so it can be plotted.
        delay.dryWetMix = 100
        dryWetMixer = DryWetMixer(player, delay)
        engine.output = dryWetMixer
    }
}
