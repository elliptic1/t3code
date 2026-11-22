#!/usr/bin/env bash
# Standalone fork clients retain their pairing/signing identity and never load upstream OTAs.
# Runs on the Mac mini and on Linux. Set FORK_BUILD_WEAR=0 to skip the watch APK.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_VARIANT=development T3CODE_MOBILE_UPDATES_ENABLED=0
toolchain="$HOME/.local/share/t3-fork-toolchain"
if ! command -v vp >/dev/null && [[ -d "$toolchain" ]]; then
  export PATH="$toolchain/vpinst/node_modules/.bin:$toolchain/node-v26.12.1-linux-x64/bin:$PATH"
fi
if [[ "$(uname)" == Darwin ]]; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
else
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
fi
# The installed fork app is signed with React Native's template debug key.
expected_cert=fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
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
apk="$PWD/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
apksigner="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)"
if ! "$apksigner" verify --print-certs "$apk" | grep -q "SHA-256 digest: $expected_cert"; then
  echo "$apk is not signed with the installed app's key; it would not update in place." >&2
  exit 1
fi
if [[ "${FORK_BUILD_WEAR:-1}" != 0 ]]; then
  (cd apps/wear && ./gradlew :app:testReleaseUnitTest :app:assembleRelease --max-workers=2 --no-daemon)
fi
echo "Phone APK: $apk"
