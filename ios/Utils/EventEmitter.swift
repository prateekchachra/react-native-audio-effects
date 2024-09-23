//
//  EventEmitter.swift
//  AudioEffects
//
//  Created by Prateek Chachra on 23/9/24.
//

import Foundation

class EventEmitter {

    public static var shared = EventEmitter()

  private var eventEmitter: AudioEffects!

    func register(eventEmitter: AudioEffects) {
        self.eventEmitter = eventEmitter
    }

    func emit(event: EventType, body: Any?) {
        self.eventEmitter.sendEvent(withName: event.rawValue, body: body)
    }
}
