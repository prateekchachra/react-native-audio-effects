require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "AudioEffects"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/prateekchachra/react-native-audio-effects.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.private_header_files = "ios/**/*.h"

  s.swift_version = "5.9"

  install_modules_dependencies(s)

  # AudioKit is Swift Package Manager only.
  #
  # The project stopped publishing to CocoaPods after AudioKit 5.1.0, and
  # AudioKitEX and SoundpipeAudioKit were never published there at all — so a
  # plain `s.dependency "SoundpipeAudioKit"` can never resolve. (v1.0.1 of this
  # library declared exactly that, which is why its Swift sources could not
  # compile in a consuming app.)
  #
  # `spm_dependency` is React Native's own helper (>= 0.75). It registers the
  # package on the Pods project during `pod install`, so CocoaPods users get
  # AudioKit without having to touch their Podfile.
  #
  # NOTE: SPM packages linked into *statically* linked pods can fail at link
  # time. Consuming apps should use dynamic frameworks:
  #
  #     USE_FRAMEWORKS=dynamic pod install
  #
  # or add `use_frameworks! :linkage => :dynamic` to the Podfile. The example
  # app's Podfile does this.
  spm_dependency(s,
    url: "https://github.com/AudioKit/AudioKit.git",
    requirement: { kind: "upToNextMajorVersion", minimumVersion: "5.7.2" },
    products: ["AudioKit"]
  )

  spm_dependency(s,
    url: "https://github.com/AudioKit/AudioKitEX.git",
    requirement: { kind: "upToNextMajorVersion", minimumVersion: "5.7.0" },
    products: ["AudioKitEX"]
  )

  spm_dependency(s,
    url: "https://github.com/AudioKit/SoundpipeAudioKit.git",
    requirement: { kind: "upToNextMajorVersion", minimumVersion: "5.7.4" },
    products: ["SoundpipeAudioKit"]
  )

  # Chorus and Flanger live here, not in AudioKitEX — they were moved out of
  # core when AudioKit 5 split into packages.
  spm_dependency(s,
    url: "https://github.com/AudioKit/DunneAudioKit.git",
    requirement: { kind: "upToNextMajorVersion", minimumVersion: "5.6.2" },
    products: ["DunneAudioKit"]
  )
end
