const { withInfoPlist, withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const TARGET = 'KilometrLiveActivity';

module.exports = function withIOS(config) {
  const version = /^\d+\.\d+\.\d+$/.test(config.version)
    ? config.version
    : require('../app.json').expo.version;
  const build = config.ios?.buildNumber || '1';
  config = withInfoPlist(config, (mod) => {
    mod.modResults.CFBundleShortVersionString = version;
    mod.modResults.CFBundleVersion = build;
    mod.modResults.NSSupportsLiveActivities = true;
    mod.modResults.NSLocationWhenInUseUsageDescription =
      require('../src/i18n/native/en.json').ios.NSLocationWhenInUseUsageDescription;
    mod.modResults.NSAppTransportSecurity = {
      ...mod.modResults.NSAppTransportSecurity,
      NSAllowsLocalNetworking: true,
    };
    return mod;
  });
  config = withEntitlementsPlist(config, (mod) => {
    // Lokalne powiadomienia i ActivityKit bez APNs nie potrzebują konta deweloperskiego.
    delete mod.modResults['aps-environment'];
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const root = mod.modRequest.platformProjectRoot;
    const folder = path.join(root, TARGET);
    fs.mkdirSync(folder, { recursive: true });
    const source = path.join(mod.modRequest.projectRoot, 'modules/kilometr-tracking/ios');
    fs.copyFileSync(path.join(source, 'TripAttributes.swift'), path.join(folder, 'TripAttributes.swift'));
    fs.copyFileSync(path.join(source, 'extension/TripLiveActivity.swift'), path.join(folder, 'TripLiveActivity.swift'));
    fs.writeFileSync(path.join(folder, `${TARGET}-Info.plist`), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Kilometr</string>
<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${build}</string>
<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict>
</dict></plist>
`);
    if (project.pbxTargetByName(TARGET)) return mod;
    const target = project.addTarget(TARGET, 'app_extension', TARGET, `${mod.ios.bundleIdentifier}.liveactivity`);
    const group = project.addPbxGroup([], TARGET, TARGET);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    for (const file of ['TripAttributes.swift', 'TripLiveActivity.swift']) {
      project.addSourceFile(file, { target: target.uuid }, group.uuid);
    }
    const configurations = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    for (const entry of configurations.buildConfigurations) {
      Object.assign(project.pbxXCBuildConfigurationSection()[entry.value].buildSettings, {
        SWIFT_VERSION: '5.0',
        IPHONEOS_DEPLOYMENT_TARGET: '16.4',
        TARGETED_DEVICE_FAMILY: '"1,2"',
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        CODE_SIGN_STYLE: 'Automatic',
        GENERATE_INFOPLIST_FILE: 'NO',
        CURRENT_PROJECT_VERSION: `"${build}"`,
        MARKETING_VERSION: `"${version}"`,
      });
    }
    return mod;
  });
};
