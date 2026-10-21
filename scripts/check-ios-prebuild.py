import json
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
assert "KilometrStartupDiagnostics.swift in Sources" in project
diagnostics = root / "Kilometr/KilometrStartupDiagnostics.swift"
assert diagnostics.read_bytes() == pathlib.Path("plugins/ios/KilometrStartupDiagnostics.swift").read_bytes()
delegate = (root / "Kilometr/AppDelegate.swift").read_text()
assert delegate.count("KilometrStartupDiagnostics.install()") == 1
assert delegate.index("KilometrStartupDiagnostics.install()") < delegate.index("factory.startReactNative(")
for key in ["KilometrStartupTitle", "KilometrStartupHint", "KilometrStartupShare"]:
    assert info[key] == json.loads(pathlib.Path("src/i18n/native/en.json").read_text())["ios"][key]
for locale in ["pl", "en", "de", "uk"]:
    strings = (root / "Kilometr/Supporting" / (locale + ".lproj") / "InfoPlist.strings").read_text()
    expected = json.loads(pathlib.Path(f"src/i18n/native/{locale}.json").read_text())["ios"]
    for key, value in expected.items():
        assert f"{key} = {json.dumps(value, ensure_ascii=False)};" in strings, (locale, key)
print("PASS: iOS prebuild, native error screen, localizations, versions and minimal entitlements")
