Pod::Spec.new do |s|
  s.name = 'KilometrTracking'
  s.version = '1.0.0'
  s.summary = 'Aktywność podróży Kilometr'
  s.description = s.summary
  s.license = { :type => 'GPL-3.0-or-later' }
  s.author = 'Kilometr'
  s.homepage = 'https://github.com/sioodmy/kilometr'
  s.source = { :git => s.homepage }
  s.platform = :ios, '16.4'
  s.swift_version = '5.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'ActivityKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
