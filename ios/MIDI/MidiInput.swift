import CoreMIDI
import Foundation

/**
 Receives from the system's MIDI inputs.

 ## What this deliberately does not do

 It does not interpret a single message. CoreMIDI hands over universal
 MIDI packets, this unwraps them back into plain MIDI 1.0 bytes, and the
 bytes go to JavaScript exactly as they arrived. Decoding lives in
 `src/midi` so that there is one decoder rather than one per platform —
 running status, zero-velocity note offs and real-time bytes landing in
 the middle of another message are each easy to get subtly wrong, and
 getting them wrong twice in two languages is worse.

 ## Transports

 USB-C and network inputs appear on their own as soon as the client
 exists. Bluetooth inputs appear only once paired, which the system
 pairing sheet does; see `BluetoothMidiPairing`. All three then look
 identical here, because CoreMIDI models them as the same kind of source.
 */
final class MidiInput {
  /// Called with (deviceId, bytes, host time in milliseconds).
  var onData: ((String, [UInt8], Double) -> Void)?
  /// Called when a device is attached, removed or renamed.
  var onDevicesChanged: ((Int) -> Void)?

  private var client = MIDIClientRef()
  private var port = MIDIPortRef()
  private var running = false

  /**
   Open devices, both ways round.

   Only ever touched on `queue`. The read block runs on CoreMIDI's own
   thread and the module's calls arrive on whichever thread React Native
   used, so an unguarded dictionary here would be a data race that shows
   up as a crash under exactly the conditions this feature is for: a
   controller being plugged in while notes are playing.
   */
  private var connected: [String: MIDIEndpointRef] = [:]
  private var idsByEndpoint: [MIDIEndpointRef: String] = [:]

  /// Hops off CoreMIDI's own thread before anything reaches JavaScript.
  private let queue = DispatchQueue(label: "audioeffects.midi", qos: .userInitiated)

  // MARK: - Lifecycle

  func start() throws {
    guard !running else { return }

    var status = MIDIClientCreateWithBlock(
      "react-native-audio-effects" as CFString,
      &client
    ) { [weak self] notification in
      // Any setup change — a cable in or out, a device renamed, a
      // Bluetooth peripheral finishing pairing — invalidates whatever
      // list JavaScript is holding.
      if notification.pointee.messageID == .msgSetupChanged {
        guard let self else { return }
        self.queue.async {
          self.onDevicesChanged?(Int(MIDIGetNumberOfSources()))
        }
      }
    }
    guard status == noErr else {
      throw MidiError.clientFailed(status)
    }

    // ._1_0 asks CoreMIDI to translate anything it receives into MIDI 1.0
    // for us, so a MIDI 2.0 controller still arrives as bytes this
    // library and its JavaScript decoder understand.
    status = MIDIInputPortCreateWithProtocol(
      client,
      "Input" as CFString,
      ._1_0,
      &port
    ) { [weak self] eventList, connectionRefCon in
      self?.receive(eventList, from: connectionRefCon)
    }
    guard status == noErr else {
      MIDIClientDispose(client)
      client = MIDIClientRef()
      throw MidiError.portFailed(status)
    }

    running = true
  }

  func stop() {
    guard running else { return }
    queue.sync {
      for endpoint in connected.values {
        MIDIPortDisconnectSource(port, endpoint)
      }
      connected.removeAll()
      idsByEndpoint.removeAll()
    }
    MIDIPortDispose(port)
    MIDIClientDispose(client)
    port = MIDIPortRef()
    client = MIDIClientRef()
    running = false
  }

  deinit {
    stop()
  }

  // MARK: - Devices

  func devices() -> [[String: Any]] {
    let open = queue.sync { connected }
    return (0..<MIDIGetNumberOfSources()).map { index in
      let endpoint = MIDIGetSource(index)
      let id = Self.identifier(of: endpoint)
      return [
        "id": id,
        "name": Self.string(endpoint, kMIDIPropertyDisplayName) ?? "MIDI input",
        "manufacturer": Self.string(endpoint, kMIDIPropertyManufacturer) ?? "",
        "transport": Self.transport(of: endpoint),
        "isConnected": open[id] != nil,
      ]
    }
  }

  func connect(deviceId: String) throws {
    guard running else { throw MidiError.notEnabled }
    guard queue.sync(execute: { connected[deviceId] }) == nil else { return }
    guard let endpoint = endpoint(for: deviceId) else {
      throw MidiError.deviceNotFound(deviceId)
    }

    // The endpoint goes back to the read block as the connection refCon,
    // so an arriving packet knows which device sent it without any
    // lookup on the MIDI thread. It is an integer handle rather than a
    // pointer to anything owned, so there is nothing here to outlive.
    let refCon = UnsafeMutableRawPointer(bitPattern: UInt(endpoint))
    let status = MIDIPortConnectSource(port, endpoint, refCon)
    guard status == noErr else {
      throw MidiError.connectFailed(status)
    }
    queue.sync {
      connected[deviceId] = endpoint
      idsByEndpoint[endpoint] = deviceId
    }
  }

  func disconnect(deviceId: String) {
    let endpoint: MIDIEndpointRef? = queue.sync {
      guard let endpoint = connected.removeValue(forKey: deviceId) else {
        return nil
      }
      idsByEndpoint.removeValue(forKey: endpoint)
      return endpoint
    }
    guard let endpoint else { return }
    MIDIPortDisconnectSource(port, endpoint)
  }

  private func endpoint(for deviceId: String) -> MIDIEndpointRef? {
    (0..<MIDIGetNumberOfSources())
      .map { MIDIGetSource($0) }
      .first { Self.identifier(of: $0) == deviceId }
  }

  // MARK: - Receiving

  /**
   Unpack a list of universal MIDI packets into bytes.

   Runs on CoreMIDI's own high-priority thread, so it allocates what it
   must and hands off immediately. A packet can hold several messages end
   to end, and each message's length is implied by its type, so the words
   are walked rather than indexed.
   */
  private func receive(
    _ eventList: UnsafePointer<MIDIEventList>,
    from connectionRefCon: UnsafeMutableRawPointer?
  ) {
    // Reversing what `connect` stored. Pure arithmetic, which is all this
    // thread should be doing.
    let endpoint = MIDIEndpointRef(UInt(bitPattern: connectionRefCon))
    var bytes: [UInt8] = []

    withUnsafePointer(to: eventList.pointee.packet) { first in
      var packet = first
      for _ in 0..<eventList.pointee.numPackets {
        let count = Int(packet.pointee.wordCount)
        withUnsafeBytes(of: packet.pointee.words) { raw in
          let words = raw.bindMemory(to: UInt32.self)
          var index = 0
          while index < count {
            let word = words[index]
            let messageType = UInt8((word >> 28) & 0x0f)
            bytes.append(contentsOf: Self.bytes(of: word, type: messageType))
            index += Self.wordCount(for: messageType)
          }
        }
        packet = UnsafePointer(
          MIDIEventPacketNext(UnsafeMutablePointer(mutating: packet))
        )
      }
    }

    guard !bytes.isEmpty else { return }

    let timestamp = Double(mach_absolute_time()) * Self.nanosPerTick / 1_000_000
    // The id lookup happens on the queue, where the map is safe to read,
    // so two controllers plugged in at once stay told apart.
    queue.async { [weak self] in
      guard let self, let id = self.idsByEndpoint[endpoint] else { return }
      self.onData?(id, bytes, timestamp)
    }
  }

  /// UMP message sizes, in 32-bit words, by message type.
  private static func wordCount(for messageType: UInt8) -> Int {
    switch messageType {
    case 0x0, 0x1, 0x2: return 1
    case 0x3, 0x4: return 2
    case 0x5: return 4
    default: return 1
    }
  }

  /**
   The MIDI 1.0 bytes carried by one universal packet word.

   Only the exact number of bytes the status implies is emitted. Padding
   with the zeros that UMP leaves in the unused slots would desynchronise
   the decoder on the other end, because it counts data bytes to know
   when a message is complete.
   */
  private static func bytes(of word: UInt32, type messageType: UInt8) -> [UInt8] {
    let status = UInt8((word >> 16) & 0xff)
    let first = UInt8((word >> 8) & 0xff)
    let second = UInt8(word & 0xff)

    switch messageType {
    case 0x1:
      // System real time and system common.
      switch status {
      case 0xf1, 0xf3: return [status, first]
      case 0xf2: return [status, first, second]
      default: return [status]
      }
    case 0x2:
      // MIDI 1.0 channel voice. Program change and channel pressure
      // carry one data byte; everything else carries two.
      switch status & 0xf0 {
      case 0xc0, 0xd0: return [status, first]
      default: return [status, first, second]
      }
    default:
      // Including system exclusive, which UMP splits into its own packet
      // type and strips the framing from. Not reassembled here: a
      // controller's notes, wheels and pedals are all channel voice, and
      // a half-supported SysEx is worse than none.
      return []
    }
  }

  // MARK: - Properties

  private static let nanosPerTick: Double = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return Double(info.numer) / Double(info.denom)
  }()

  private static func identifier(of endpoint: MIDIEndpointRef) -> String {
    var unique: Int32 = 0
    let status = MIDIObjectGetIntegerProperty(
      endpoint,
      kMIDIPropertyUniqueID,
      &unique
    )
    // Falling back to the opaque ref keeps a device addressable even if
    // it somehow has no unique id; it is stable for this session.
    return status == noErr ? String(unique) : "ref-\(endpoint)"
  }

  private static func string(
    _ endpoint: MIDIEndpointRef,
    _ property: CFString
  ) -> String? {
    var value: Unmanaged<CFString>?
    guard MIDIObjectGetStringProperty(endpoint, property, &value) == noErr,
      let value
    else { return nil }
    let string = value.takeRetainedValue() as String
    return string.isEmpty ? nil : string
  }

  /**
   Which kind of connection a source arrived over.

   CoreMIDI does not report this directly, but each transport is served
   by its own driver, and the driver's bundle identifier is readable. A
   source with no driver at all is a virtual one published by another app
   on the device.
   */
  private static func transport(of endpoint: MIDIEndpointRef) -> String {
    guard let owner = string(endpoint, kMIDIPropertyDriverOwner) else {
      return "virtual"
    }
    if owner.contains("Bluetooth") { return "bluetooth" }
    if owner.contains("USB") { return "usb" }
    if owner.contains("RTP") || owner.contains("Network") { return "network" }
    return "unknown"
  }
}

enum MidiError: Error {
  case clientFailed(OSStatus)
  case portFailed(OSStatus)
  case connectFailed(OSStatus)
  case deviceNotFound(String)
  case notEnabled

  /// Translated at the facade, so JavaScript sees the same shape of error
  /// from MIDI as it does from everything else.
  var asAudioEffectsError: AudioEffectsError {
    switch self {
    case let .clientFailed(status):
      return .midiFailed("create a MIDI client", status)
    case let .portFailed(status):
      return .midiFailed("open an input port", status)
    case let .connectFailed(status):
      return .midiFailed("connect to the device", status)
    case let .deviceNotFound(id):
      return .midiDeviceNotFound(id)
    case .notEnabled:
      return .midiNotEnabled
    }
  }
}
