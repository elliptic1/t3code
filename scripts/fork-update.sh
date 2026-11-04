#!/usr/bin/env bash
# Pulls the latest commits into the branch checked out in this repository's main checkout,
# rebuilds the fork with fork-build.sh, and installs it in /Applications, restarting it if it is
# running. The app's "Update from source" button runs this through an agent thread, which
# resolves merge conflicts and reruns it.
#
# The commits come from the branch's upstream branch, plus upstream/main when there is an
# upstream remote (`upstream`, or `origin` when that is not the branch's own remote). They are
# merged in a <checkout>-update worktree beside the checkout, since a dev server or other agents
# may be using the checkout itself. Once the build succeeds, the branch is pushed to its remote.
#
# Usage: scripts/fork-update.sh [--rebuild]
# --rebuild builds and installs even when there is nothing new to merge.
#
# Exit status: 0 done (or already up to date), 2 merge conflict or typecheck failure to fix in
# the update worktree, 4 the branch could not be fast-forwarded, anything else a failed step.
# A failed push is reported but does not stop the install.
set -euo pipefail

# install-fork-keepalive.py's job, which starts the app again whenever it quits.
KEEPALIVE_LABEL=com.elliptic1.t3code.fork
domain="gui/$(id -u)"
log="$HOME/Library/Logs/T3 Code Fork/update.log"
# The commit the installed app was built from, so a build that failed after the branch had
# already landed is retried instead of being reported as up to date.
installed_rev_file="$HOME/Library/Logs/T3 Code Fork/installed-rev"
self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

keepalive_loaded() {
  launchctl print "$domain/$KEEPALIVE_LABEL" > /dev/null 2>&1
}

# pgrep exits 1 only for "no match"; anything else counts as running. Electron rewrites the main
# process's argv, so match anything inside the bundle (its helpers), not just Contents/MacOS/.
app_running() {
  [ -d "$1" ] || return 1
  local pattern status=0
  # pgrep takes a regex, and the bundle name has parentheses.
  pattern=$(printf '%s' "$1/Contents/" | sed 's/[][\.*^$()+?{}|]/\\&/g')
  pgrep -f "$pattern" > /dev/null || status=$?
  [ "$status" != 1 ]
}

# The bundle the keepalive job runs, or nothing when the job isn't set up.
keepalive_app() {
  /usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$HOME/Library/LaunchAgents/$KEEPALIVE_LABEL.plist" 2> /dev/null |
    sed -n 's|^ *\(/.*\.app\)/Contents/MacOS/.*|\1|p' | head -1
}

# Quits the installed copy of the app extracted in $1, replaces it, and starts the new one.
install_app() {
  local work=$1 app dest id keepalive=false
  app=$(find "$work" -maxdepth 1 -name "*.app" | head -1)
  # Replace the bundle the keepalive job runs: the build's own name (T3 Code (Fork Nightly))
  # differs from the installed one.
  dest=$(keepalive_app)
  [ -n "$dest" ] || dest="/Applications/$(basename "$app")"
  id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$app/Contents/Info.plist")
  if keepalive_loaded; then
    # Quitting would only make the job start the old app again, so stop the job instead.
    keepalive=true
    launchctl bootout "$domain/$KEEPALIVE_LABEL" || true
  elif app_running "$dest"; then
    osascript -e "tell application id \"$id\" to quit" || true
  fi
  for _ in $(seq 1 120); do
    app_running "$dest" || break
    sleep 1
  done
  if app_running "$dest"; then
    echo "$dest did not quit within 2 minutes; not installing the new build." >&2
    exit 3
  fi
  rm -rf "$dest"
  mv "$app" "$dest"
  mkdir -p "$(dirname "$installed_rev_file")"
  cp "$work/.rev" "$installed_rev_file"
  rm -rf "$work"
  echo "Installed $dest"
  if [ "$keepalive" = true ]; then
    launchctl bootstrap "$domain" "$HOME/Library/LaunchAgents/$KEEPALIVE_LABEL.plist"
  else
    open "$dest"
  fi
}

# Internal: run detached, so it outlives the app whose agent thread started the update.
if [ "${1:-}" = --install-after-quit ]; then
  # Give that agent's turn time to finish before the app quits.
  sleep 10
  install_app "$2"
  exit 0
fi

rebuild=false
[ "${1:-}" = --rebuild ] && rebuild=true

# Agent shells don't always load the toolchain from the login profile.
if ! command -v vp > /dev/null && [ -f "$HOME/.config/vite-plus/env" ]; then
  . "$HOME/.config/vite-plus/env"
fi
if ! command -v cargo > /dev/null && [ -f "$HOME/.cargo/env" ]; then
  . "$HOME/.cargo/env"
fi

main=$(dirname "$(git -C "$(dirname "$self")" rev-parse --path-format=absolute --git-common-dir)")
target=$(git -C "$main" branch --show-current)
if [ -z "$target" ]; then
  echo "$main has no branch checked out, so there is nothing to update." >&2
  exit 1
fi
worktree="$main-update"
branch=source-update

remotes=()
sources=()
tracking_remote=$(git -C "$main" config "branch.$target.remote" || true)
if [ -n "$tracking_remote" ] && [ "$tracking_remote" != . ]; then
  remotes+=("$tracking_remote")
  sources+=("$(git -C "$main" rev-parse --abbrev-ref "$target@{upstream}")")
fi
for upstream_remote in upstream origin; do
  if [ "$upstream_remote" != "$tracking_remote" ] && git -C "$main" remote get-url "$upstream_remote" > /dev/null 2>&1; then
    remotes+=("$upstream_remote")
    sources+=("$upstream_remote/main")
    break
  fi
done
if [ ${#sources[@]} = 0 ]; then
  echo "$target has no upstream branch and there is no upstream or origin remote, so there is nothing to pull." >&2
  exit 1
fi

if [ ! -d "$worktree" ]; then
  git -C "$main" worktree add -B "$branch" "$worktree" "$target"
fi
cd "$worktree"

if git rev-parse -q --verify MERGE_HEAD > /dev/null; then
  if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
    echo "A merge in $worktree still has conflicts:" >&2
    git diff --name-only --diff-filter=U >&2
    exit 2
  fi
  git commit --no-edit
fi

# Resume an unlanded merge, start over when the branch has moved past this one, and stop rather
# than drop commits when the two have diverged.
if ! git merge-base --is-ancestor "$target" HEAD; then
  if git merge-base --is-ancestor HEAD "$target"; then
    git reset --hard "$target"
  else
    echo "$branch in $worktree has commits that are not on $target, and $target has moved on." >&2
    echo "Rebase or merge them onto $target, or reset $branch to $target, then rerun." >&2
    exit 2
  fi
fi

# Whole remotes, for their tags: fork-build.sh takes its version from the newest nightly tag.
git fetch --multiple "${remotes[@]}"

for source in "${sources[@]}"; do
  git merge-base --is-ancestor "$source" HEAD && continue
  if ! git merge -m "Merge $source into $target" "$source"; then
    echo "Merging $source conflicts in $worktree:" >&2
    git diff --name-only --diff-filter=U >&2
    exit 2
  fi
done

if [ "$(git rev-parse HEAD)" = "$(git rev-parse "$target")" ]; then
  if [ "$rebuild" = false ] && [ "$(cat "$installed_rev_file" 2> /dev/null)" = "$(git rev-parse HEAD)" ]; then
    echo "$target is already up to date with ${sources[*]}, and installed."
    exit 0
  fi
else
  echo "New on $target:"
  git --no-pager log --oneline --first-parent -n 40 "$target..HEAD"
fi

vp i
if ! vp run typecheck; then
  echo "Typecheck failed after the merge. Fix it in $worktree, commit, and rerun." >&2
  exit 2
fi

# Land before building, so the next build from the checkout keeps this merge.
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$target")" ]; then
  if [ "$(git -C "$main" branch --show-current)" != "$target" ]; then
    echo "$main no longer has $target checked out. Check it out again, then rerun." >&2
    exit 4
  fi
  if ! git -C "$main" merge --ff-only "$branch"; then
    echo "Could not fast-forward $target in $main, probably because uncommitted changes there" >&2
    echo "touch the same files. Commit or move them, then rerun." >&2
    exit 4
  fi
  # Keep a dev server in the checkout from running against missing dependencies.
  (cd "$main" && vp i)
fi

started=$(mktemp)
trap 'rm -f "$started"' EXIT
scripts/fork-build.sh
zip=$(find release -maxdepth 1 -name "*-arm64.zip" -newer "$started" | head -1)
if [ -z "$zip" ]; then
  echo "fork-build.sh finished but left no new release/*-arm64.zip." >&2
  exit 1
fi
work=$(mktemp -d /tmp/fork-update.XXXXXX)
ditto -x -k "$zip" "$work"
git rev-parse HEAD > "$work/.rev"

# The build passed, so the merge is safe to publish. A plain push: if the remote moved, say so.
if [ -n "$tracking_remote" ] && [ "$tracking_remote" != . ]; then
  if git -C "$main" push "$tracking_remote" "$target"; then
    echo "Pushed $target to $tracking_remote."
  else
    echo "PUSH FAILED: could not push $target to $tracking_remote. The app is still installed." >&2
  fi
fi
installed=$(keepalive_app)
[ -n "$installed" ] || installed="/Applications/$(basename "$(find "$work" -maxdepth 1 -name "*.app" | head -1)")"

if keepalive_loaded || app_running "$installed"; then
  mkdir -p "$(dirname "$log")"
  # setsid puts the installer in its own session, so quitting the app doesn't take it down.
  /usr/bin/python3 -c 'import os, sys; os.setsid(); os.execv(sys.argv[1], sys.argv[1:])' \
    /bin/bash "$self" --install-after-quit "$work" > "$log" 2>&1 < /dev/null &
  echo "Built $(basename "$zip"). The app restarts in about 10 seconds to install it; see $log."
  exit 0
fi
install_app "$work"
