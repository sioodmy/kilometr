#!/usr/bin/env bash
set -euo pipefail
ARCHIVE="${1:?archive path}"
OUTPUT="${2:?output directory}"
APP="$ARCHIVE/Products/Applications/Kilometr.app"
test -d "$APP/PlugIns/KilometrLiveActivity.appex"
mkdir -p "$OUTPUT"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
mkdir "$STAGING/Payload"
ditto "$APP" "$STAGING/Payload/Kilometr.app"
cd "$STAGING"
zip -q -r -y "$OUTPUT/kilometr-unsigned.ipa" Payload
cd "$OUTPUT"
shasum -a 256 kilometr-unsigned.ipa > kilometr-unsigned.ipa.sha256
