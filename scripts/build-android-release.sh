#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
key_file="${HSC_RELEASE_STORE_FILE:-$HOME/Library/Application Support/Thoughtless Labs/Hide and Seek Cards/android-upload.jks}"
key_alias="${HSC_RELEASE_KEY_ALIAS:-hide-and-seek-cards-upload}"
keychain_service="com.thoughtlesslabs.hideandseekcards.android-upload"

if [[ ! -f "$key_file" ]]; then
  echo "Android upload key is missing. Run scripts/create-android-upload-key.sh first." >&2
  exit 1
fi

export HSC_RELEASE_STORE_FILE="$key_file"
export HSC_RELEASE_STORE_PASSWORD="$(security find-generic-password -s "$keychain_service" -a store-password -w)"
export HSC_RELEASE_KEY_ALIAS="$key_alias"
export HSC_RELEASE_KEY_PASSWORD="$(security find-generic-password -s "$keychain_service" -a key-password -w)"
export VITE_GAME_SERVER_URL="${VITE_GAME_SERVER_URL:-https://cards.thoughtlesslabs.com}"

if [[ -n "${HSC_JAVA_HOME:-}" ]]; then
  export JAVA_HOME="$HSC_JAVA_HOME"
elif [[ -d "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
elif [[ -x "/usr/libexec/java_home" ]]; then
  java_21_home="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [[ -n "$java_21_home" ]]; then
    export JAVA_HOME="$java_21_home"
  fi
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "JDK 21 is required. Install openjdk@21 or set HSC_JAVA_HOME to a JDK 21 home." >&2
  exit 1
fi

java_major="$($JAVA_HOME/bin/java -version 2>&1 | sed -nE '1s/.*version "([0-9]+).*/\1/p')"
if [[ "$java_major" != "21" ]]; then
  echo "JDK 21 is required, but JAVA_HOME resolves to Java ${java_major:-unknown}: $JAVA_HOME" >&2
  echo "Set HSC_JAVA_HOME to a JDK 21 home before building." >&2
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"

cd "$project_root"
pnpm cap:sync:release
cd android
./gradlew clean
./gradlew test lint
# AGP 8 can retain an incorrect UP-TO-DATE result for signReleaseBundle after
# a clean removes the previously signed bundle. Force the release graph to run
# so the artifact is always packaged and signed from the current inputs.
./gradlew bundleRelease --no-build-cache --rerun-tasks

unset HSC_RELEASE_STORE_PASSWORD HSC_RELEASE_KEY_PASSWORD

echo "Signed Android App Bundle: $project_root/android/app/build/outputs/bundle/release/app-release.aab"
