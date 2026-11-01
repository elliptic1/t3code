#!/usr/bin/env bash
# Standalone fork clients retain their pairing/signing identity and never load upstream OTAs.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_VARIANT=development T3CODE_MOBILE_UPDATES_ENABLED=0
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
signing="$PWD/.t3/fork-signing/debug.keystore"
current="$PWD/apps/mobile/android/app/debug.keystore"
mkdir -p "$(dirname "$signing")"
if [[ -f "$signing" && -f "$current" ]] && ! cmp -s "$signing" "$current"; then
  echo "Signing keys differ; preserve the existing app and resolve the key before building." >&2
  exit 1
fi
if [[ -f "$current" && ! -f "$signing" ]]; then
  cp "$current" "$signing"
  chmod 600 "$signing"
fi
(cd apps/mobile && vp exec expo prebuild --platform android --no-install)
if [[ -f "$signing" ]]; then
  cp "$signing" "$current"
else
  cp "$current" "$signing"
  chmod 600 "$signing"
fi
(cd apps/mobile/android && ./gradlew :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a -Pandroid.enableMinifyInReleaseBuilds=false \
  -Pandroid.enableShrinkResourcesInReleaseBuilds=false \
  '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=768m' --max-workers=2 --no-daemon)
(cd apps/wear && ./gradlew :app:testReleaseUnitTest :app:assembleRelease --max-workers=2 --no-daemon)
echo 'Standalone phone and watch APKs are in their app/build/outputs/apk/release directories.'
