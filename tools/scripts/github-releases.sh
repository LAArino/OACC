#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Creates one GitHub release per version tag (v0.1.0 to v0.10.0, as found in
# `git tag`) with the matching CHANGELOG.md section as its notes
# (docs/RELEASING.md, criterion 10; docs/production/go-public-checklist.md).
#
# Usage (from anywhere inside the repository, with `gh` signed in):
#
#   bash tools/scripts/github-releases.sh --dry-run    # prints what it would do
#   bash tools/scripts/github-releases.sh              # creates the releases
#   bash tools/scripts/github-releases.sh --dry-run --notes-dir /tmp/notes
#
# --notes-dir DIR keeps the extracted notes files (vX.Y.Z.md) in DIR instead of
# a temporary directory removed on exit. The script is idempotent: a tag whose
# release already exists (`gh release view` succeeds) is skipped. `gh` picks
# the repository from the `origin` remote; set GH_REPO=owner/name to override.
# Releases are created oldest first, so the newest version ends up "Latest".

set -euo pipefail

dry_run=false
notes_dir=""

usage() {
  sed -n '9,13p' "$0" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --notes-dir)
      [ "$#" -ge 2 ] || { echo "--notes-dir needs a directory" >&2; exit 2; }
      notes_dir=$2
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

repo_root=$(git rev-parse --show-toplevel)
changelog="$repo_root/CHANGELOG.md"
[ -f "$changelog" ] || { echo "CHANGELOG.md not found in $repo_root" >&2; exit 1; }

if [ -n "$notes_dir" ]; then
  mkdir -p "$notes_dir"
else
  notes_dir=$(mktemp -d)
  trap 'rm -rf "$notes_dir"' EXIT
fi

if ! $dry_run; then
  command -v gh >/dev/null 2>&1 || { echo "gh (GitHub CLI) is required" >&2; exit 1; }
fi

# Prints the body of the "## [X.Y.Z] - date" section of CHANGELOG.md: from the
# line after its heading up to the next "## [" heading or the link reference
# definitions at the end of the file, without leading or trailing blank lines.
extract_notes() {
  awk -v version="$1" '
    index($0, "## [" version "] ") == 1 { in_section = 1; next }
    in_section && (/^## \[/ || /^\[[^]]+\]: /) { exit }
    in_section { lines[++n] = $0 }
    END {
      first = 1; while (first <= n && lines[first] ~ /^[[:space:]]*$/) first++
      last = n;  while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
      for (i = first; i <= last; i++) print lines[i]
    }
  ' "$changelog"
}

release_exists() {
  command -v gh >/dev/null 2>&1 && gh release view "$1" >/dev/null 2>&1
}

tags=$(git -C "$repo_root" tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -V)
[ -n "$tags" ] || { echo "No version tags found" >&2; exit 1; }

created=0
skipped=0
for tag in $tags; do
  version=${tag#v}
  notes_file="$notes_dir/$tag.md"
  extract_notes "$version" >"$notes_file"
  if [ ! -s "$notes_file" ]; then
    echo "$tag: no '## [$version] - date' section in CHANGELOG.md" >&2
    exit 1
  fi

  if release_exists "$tag"; then
    echo "$tag: release exists, skipped"
    skipped=$((skipped + 1))
    continue
  fi

  if $dry_run; then
    echo "$tag: would run: gh release create $tag --verify-tag --title \"OACC $tag\" --notes-file $notes_file ($(wc -l <"$notes_file" | tr -d ' ') lines)"
    sed -n '1,5p' "$notes_file" | sed 's/^/    | /'
  else
    gh release create "$tag" --verify-tag --title "OACC $tag" --notes-file "$notes_file"
    echo "$tag: release created"
  fi
  created=$((created + 1))
done

if $dry_run; then
  echo "Dry run: $created release(s) would be created, $skipped skipped. Notes files in $notes_dir"
else
  echo "Done: $created release(s) created, $skipped skipped."
fi
