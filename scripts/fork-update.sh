#!/usr/bin/env bash
# The fork's "Check for Updates": merge upstream main into this checkout, let
# Claude resolve any conflicts, rebuild with fork-build.sh, swap the new bundle
# into /Applications, push the merged branch to the fork remote and relaunch it
# through its launchd KeepAlive agent.
#
# Started detached by the desktop menu when T3CODE_FORK_SOURCE_DIR is set (see
# DesktopApplicationMenu.ts). Progress goes to ntfy and the log below.
#
# ponytail: one checkout, one app, no rollback beyond the .previous bundle kept
# next to the install. Add a typecheck gate before the build if bad merges slip.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.local/share/vite-plus/bin:/opt/homebrew/bin:$PATH"

APP="/Applications/T3 Code (Fork).app"
AGENT="gui/$(id -u)/com.elliptic1.t3code.fork"
LOG="$HOME/Library/Logs/T3 Code Fork/fork-update.log"
LOCK="${TMPDIR:-/tmp}/t3-fork-update.lock"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "=== fork-update $(date) ==="

notify() { # title, tags, priority, body
  curl -s -H "Title: $1" -H "Tags: $2" -H "Priority: $3" -d "$4" \
    "https://ntfy.mininews.app/T3Code" >/dev/null || true
}
mkdir "$LOCK" 2>/dev/null || { notify "T3 fork update already running" warning default "$LOG"; exit 0; }
trap 'rm -rf "$LOCK"' EXIT
trap 'notify "T3 fork update FAILED" x high "Line $LINENO. Log: $LOG"' ERR

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin
git fetch fork
# fork/$BRANCH first (it may hold work pushed from elsewhere, so the push below stays
# a fast-forward), then upstream.
REFS=()
for ref in "fork/$BRANCH" origin/main; do
  git merge-base --is-ancestor "$ref" HEAD || REFS+=("$ref")
done
if [ ${#REFS[@]} -eq 0 ]; then
  notify "T3 fork is up to date" white_check_mark default "Nothing new on upstream main or the fork."
  exit 0
fi
BEHIND=$(git rev-list --count HEAD.."${REFS[-1]}")
notify "T3 fork update started" gear default "Merging ${REFS[*]} ($BEHIND commits behind)."

unresolved() { git rev-parse -q --verify MERGE_HEAD >/dev/null || [ -n "$(git diff --name-only --diff-filter=U)" ]; }
PRE_MERGE=$(git rev-parse HEAD)
read -r -d '' PROMPT <<'PROMPT_END' || true
This is the T3 Code fork checkout. A branch (upstream origin/main or the fork's own
fork/main) was merged into the current branch with `git merge --autostash` and left
conflicts. Resolve them all. Do not push.
- Keep the fork's own features (voice, dictation, Wear OS, usage additions, anything not in upstream) working on top of upstream's changes.
- iOS code is deliberately deleted in this fork: resolve modify/delete conflicts on iOS files with `git rm`.
- Otherwise prefer upstream where the fork made no intentional change.
- Touch only conflicted files plus what is needed for them to compile. Run `vp i` if the lockfile conflicted.
- If MERGE_HEAD exists, conclude the merge with `git commit --no-edit`; that re-applies the autostash.
- Conflicts from re-applying the autostash are the developer's uncommitted work: resolve them keeping both sides' intent, then `git reset -q` so that work stays uncommitted.
PROMPT_END
for ref in "${REFS[@]}"; do
  # Autostash carries uncommitted work across the merge and is re-applied when the
  # merge commit lands; that re-apply can conflict too, even after a clean merge.
  git merge --autostash --no-edit "$ref" || true
  if unresolved; then
    notify "T3 fork update: resolving conflicts" gear default \
      "$(git diff --name-only --diff-filter=U | wc -l | tr -d ' ') conflicted files merging $ref, handing to Claude."
    claude -p --dangerously-skip-permissions "$PROMPT"
  fi
  if unresolved; then
    echo "unresolved conflicts remain after $ref" >&2
    false
  fi
done
if git diff --name-only "$PRE_MERGE" | xargs -I{} grep -lE '^(<<<<<<<|>>>>>>>) ' {} 2>/dev/null | grep -q .; then
  echo "conflict markers left in merged files" >&2
  false
fi

vp i
bash scripts/fork-build.sh
DMG=$(ls -t release/*-arm64.dmg | head -1)
MOUNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG"
rm -rf "$APP.new" && ditto "$(ls -d "$MOUNT"/*.app | head -1)" "$APP.new"
hdiutil detach "$MOUNT"

# The running app is under launchd KeepAlive: swap the bundle in place, then
# kickstart. This script runs detached from the app, so it survives the kill.
rm -rf "$APP.previous"
mv "$APP" "$APP.previous"
mv "$APP.new" "$APP"
# Pushed only after the build passed, so a broken merge never reaches the fork.
# Plain fast-forward push; a rejection is reported but must not block the relaunch.
PUSHED="pushed to fork/$BRANCH"
git push fork "$BRANCH" || PUSHED="PUSH TO FORK FAILED (see log)"
notify "T3 fork updated" white_check_mark default "Merged $BEHIND upstream commits, built $(basename "$DMG"), $PUSHED. Relaunching."
launchctl kickstart -k "$AGENT"
