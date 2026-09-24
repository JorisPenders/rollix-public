#!/usr/bin/env bash
# Replace ./www with the contents of ~/dev/rollix/www, then commit and push.
set -euo pipefail

SRC="$HOME/dev/rollix/www"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$REPO_DIR/www"

if [ ! -d "$SRC" ]; then
  echo "Source directory not found: $SRC" >&2
  exit 1
fi

cd "$REPO_DIR"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC"/. "$DEST"/

git add -A www
if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

git commit -m "updated version $(date +%Y-%m-%d)"
git push
