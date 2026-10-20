#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST="$PWD/modules/kilometr-raptor/rust/Cargo.toml"
TARGET_DIR="$PWD/modules/kilometr-raptor/rust/target"
OUTPUT="$PWD/modules/kilometr-raptor/ios/build"
export IPHONEOS_DEPLOYMENT_TARGET=16.4
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cargo build --manifest-path "$MANIFEST" --locked --release --target aarch64-apple-ios
cargo build --manifest-path "$MANIFEST" --locked --release --target aarch64-apple-ios-sim
mkdir -p "$OUTPUT"
rm -rf "$OUTPUT/KilometrRust.xcframework"
xcodebuild -create-xcframework \
  -library "$TARGET_DIR/aarch64-apple-ios/release/libkilometr_raptor.a" \
  -library "$TARGET_DIR/aarch64-apple-ios-sim/release/libkilometr_raptor.a" \
  -output "$OUTPUT/KilometrRust.xcframework"
