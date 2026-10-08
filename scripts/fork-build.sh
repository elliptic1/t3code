#!/usr/bin/env bash
# Builds the private fork as its own macOS app, "T3 Code (Fork)", with a
# separate bundle id, Electron profile and T3 home (~/.t3-fork) so it never
# shares state with an upstream install.
#
# ponytail: the identity is patched in for the build and reverted afterwards, so
# the tree stays mergeable with upstream and its tests keep their expectations.
# If upstream moves one of these strings the script stops; update the pattern.
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=(
  apps/desktop/src/app/DesktopStatePaths.ts
  apps/desktop/src/app/DesktopUserData.ts
  apps/desktop/src/app/DesktopEnvironment.ts
  apps/desktop/package.json
  scripts/build-desktop-artifact.ts
)
if ! git diff --quiet -- "${FILES[@]}"; then
  echo "fork-build: commit or discard changes to the identity files first" >&2
  exit 1
fi
trap 'git checkout -- "${FILES[@]}"' EXIT

swap() { # file, exact text, replacement
  FILE="$1" FROM="$2" TO="$3" node -e '
    const fs = require("node:fs");
    const { FILE, FROM, TO } = process.env;
    const source = fs.readFileSync(FILE, "utf8");
    if (source.split(FROM).length !== 2) {
      console.error(`fork-build: expected exactly one "${FROM}" in ${FILE}`);
      process.exit(1);
    }
    fs.writeFileSync(FILE, source.replace(FROM, TO));
  '
}
swap apps/desktop/src/app/DesktopStatePaths.ts 'input.joinPath(input.homeDirectory, ".t3")' 'input.joinPath(input.homeDirectory, ".t3-fork")'
swap apps/desktop/src/app/DesktopUserData.ts '{ current: "t3code-v2",' '{ current: "t3code-fork",'
swap apps/desktop/src/app/DesktopEnvironment.ts 'displayName: `${APP_BASE_NAME} (${stageLabel})`' 'displayName: `${APP_BASE_NAME} (${stageLabel === "Alpha" ? "Fork" : stageLabel})`'
swap apps/desktop/package.json '"productName": "T3 Code (Alpha)"' '"productName": "T3 Code (Fork)"'
swap scripts/build-desktop-artifact.ts 'const DESKTOP_APP_ID = "com.t3tools.t3code";' 'const DESKTOP_APP_ID = "com.t3tools.t3code.fork";'

# A `-pr.` version ships without an update feed, so the app never replaces
# itself with an upstream release.
BASE_VERSION="$(node -p 'require("./apps/desktop/package.json").version')"
VERSION="${BASE_VERSION}-pr.0.$(date +%Y%m%d%H%M)"
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 \
  --build-version "$VERSION" --output-dir release "$@"
echo "fork-build: built $VERSION in release/"
