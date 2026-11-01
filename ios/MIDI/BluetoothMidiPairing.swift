import CoreAudioKit
import Foundation
import UIKit

/**
 The system's Bluetooth MIDI pairing sheet.

 Bluetooth MIDI peripherals do not appear in iOS Settings — there is no
 pane for them. The only way to pair one is `CABTMIDICentralViewController`,
 which Apple ships for exactly this purpose, so every app that supports a
 wireless controller presents this same view. Once the user pairs here,
 the device shows up as an ordinary CoreMIDI source and `MidiInput` sees
 it like any other.

 Presenting it needs Bluetooth permission, so the host app must carry an
 `NSBluetoothAlwaysUsageDescription` string. Without one the sheet opens
 and finds nothing, which looks like broken hardware rather than a
 missing key.
 */
@objc(BluetoothMidiPairing)
public final class BluetoothMidiPairing: NSObject {
  /// Held only while presented, so the Done button has something to close.
  private var presented: UIViewController?

  @objc public func present(completion: @escaping (NSError?) -> Void) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }

      guard let host = Self.topViewController() else {
        completion(
          NSError(
            domain: "AudioEffects",
            code: 1,
            userInfo: [
              "code": "MIDI_NO_VIEW_CONTROLLER",
              NSLocalizedDescriptionKey:
                "No view controller is on screen to present the Bluetooth MIDI sheet from.",
            ]
          )
        )
        return
      }

      let pairing = CABTMIDICentralViewController()
      let navigation = UINavigationController(rootViewController: pairing)
      pairing.navigationItem.rightBarButtonItem = UIBarButtonItem(
        barButtonSystemItem: .done,
        target: self,
        action: #selector(self.dismiss)
      )

      self.presented = navigation
      host.present(navigation, animated: true) {
        completion(nil)
      }
    }
  }

  @objc private func dismiss() {
    presented?.dismiss(animated: true)
    presented = nil
  }

  /**
   The view controller currently on screen.

   Walks past anything already presented, because React Native apps
   routinely have a modal up — a file picker, another sheet — and
   presenting on a controller that is itself covered silently does
   nothing.
   */
  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }

    let window =
      scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first

    var top = window?.rootViewController
    while let next = top?.presentedViewController {
      top = next
    }
    return top
  }
}
