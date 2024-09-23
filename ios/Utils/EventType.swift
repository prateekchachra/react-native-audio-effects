//
//  EventType.swift
//  AudioEffects
//
//  Created by Prateek Chachra on 23/9/24.
//

import Foundation

enum EventType: String, CaseIterable {
    case AudioChange = "audio-change"
    case EffectChange = "effect-change"
 
    
    static func allRawValues() -> [String] {
        return allCases.map { $0.rawValue }
    }
}
