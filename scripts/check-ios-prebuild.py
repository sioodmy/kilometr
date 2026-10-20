import pathlib
import plistlib
import re

root = pathlib.Path("ios")
info = plistlib.loads((root / "Kilometr/Info.plist").read_bytes())
extension = plistlib.loads((root / "KilometrLiveActivity/KilometrLiveActivity-Info.plist").read_bytes())
entitlements = plistlib.loads((root / "Kilometr/Kilometr.entitlements").read_bytes())
assert "aps-environment" not in entitlements
assert "com.apple.security.application-groups" not in entitlements
assert "UIBackgroundModes" not in info
assert "NSLocationAlwaysUsageDescription" not in info
assert "NSLocationAlwaysAndWhenInUseUsageDescription" not in info
assert "NSMotionUsageDescription" not in info
assert info["NSSupportsLiveActivities"]
assert info["NSAppTransportSecurity"]["NSAllowsLocalNetworking"]
assert not info["NSAppTransportSecurity"].get("NSAllowsArbitraryLoads", False)
assert re.fullmatch(r"\d+\.\d+\.\d+", info["CFBundleShortVersionString"])
assert info["CFBundleShortVersionString"] == extension["CFBundleShortVersionString"]
assert info["CFBundleVersion"] == extension["CFBundleVersion"]
project = (root / "Kilometr.xcodeproj/project.pbxproj").read_text()
assert project.count('productName = "KilometrLiveActivity";') == 1
assert "TripLiveActivity.swift in Sources" in project
assert "KilometrLiveActivity.appex in Copy Files" in project
for locale in ["pl", "en", "de", "uk"]:
    assert (root / "Kilometr/Supporting" / (locale + ".lproj") / "InfoPlist.strings").exists()
print("PASS: iOS prebuild, extension, localizations, versions and minimal entitlements")
