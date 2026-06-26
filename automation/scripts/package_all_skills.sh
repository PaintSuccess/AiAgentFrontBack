#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILLS="$ROOT/.agents/skills"
DIST="$ROOT/automation/dist"
mkdir -p "$DIST"

for skill_dir in "$SKILLS"/*; do
  [ -d "$skill_dir" ] || continue
  name="$(basename "$skill_dir")"
  (cd "$SKILLS" && zip -qr "$DIST/${name}.zip" "$name")
done

echo "Packaged skills into $DIST"
