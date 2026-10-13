#!/usr/bin/env sh
# Lightweight Gradle bootstrap wrapper; downloads the official Gradle distribution once.
set -eu
URL='https://services.gradle.org/distributions/gradle-8.9-bin.zip'
VERSION='gradle-8.9'
BASE_DIR="${GRADLE_USER_HOME:-$HOME/.gradle}/wrapper/dists/localify-crimson/gradle-8.9-bin"
GRADLE_BIN="$BASE_DIR/$VERSION/bin/gradle"
if [ ! -x "$GRADLE_BIN" ]; then
  mkdir -p "$BASE_DIR"
  TMP_ZIP="$BASE_DIR/$VERSION.zip.tmp"
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 2 "$URL" -o "$TMP_ZIP"
  elif command -v wget >/dev/null 2>&1; then wget -O "$TMP_ZIP" "$URL"
  else echo 'Need curl or wget to download Gradle 8.9.' >&2; exit 1; fi
  unzip -q -o "$TMP_ZIP" -d "$BASE_DIR"
  rm -f "$TMP_ZIP"
fi
exec "$GRADLE_BIN" "$@"
