#!/usr/bin/env bash
set -euo pipefail
OUTPUT="${RUNNER_TEMP:?}/ios-simulator"
xcodebuild -workspace ios/Kilometr.xcworkspace -scheme Kilometr \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$OUTPUT" ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO build > "$RUNNER_TEMP/ios-simulator.log" 2>&1 || {
    tail -n 180 "$RUNNER_TEMP/ios-simulator.log"
    exit 1
  }
DEVICE="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
print(next(d["udid"] for runtime, rows in devices.items() if "iOS" in runtime
           for d in rows if d["isAvailable"] and d["name"].startswith("iPhone")))
')"
trap 'xcrun simctl shutdown "$DEVICE" || true' EXIT
xcrun simctl boot "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b
xcrun simctl install "$DEVICE" "$OUTPUT/Build/Products/Release-iphonesimulator/Kilometr.app"
xcrun simctl launch "$DEVICE" app.kilometr
sleep 15
xcrun simctl spawn "$DEVICE" launchctl list | rg 'UIKitApplication:app\.kilometr'
xcrun simctl io "$DEVICE" screenshot "$RUNNER_TEMP/ios-launch.png"
