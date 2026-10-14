#!/bin/sh
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Re-creates spec/oeapi-v5.0.bundled.json from the upstream Open Education API
# specification (tag v5.0) so the vendored copy can be checked or refreshed.
#
#   sh tools/oeapi-mock/scripts/fetch-spec.sh            # writes spec/oeapi-v5.0.bundled.json
#   sh tools/oeapi-mock/scripts/fetch-spec.sh --check    # compares with the vendored copy
#
# Needs git and npx (Node 22). The upstream checkout goes to a temporary
# directory; only its v5/*.yaml files are copied next to nothing else, and
# Redocly runs from a clean directory so the upstream redocly.yaml and its
# plugin are never loaded.
set -eu

REPO=https://github.com/open-education-api/specification.git
REF=v5.0
EXPECTED_COMMIT=3d470c09f46b9f05f6bbf57a568297fdc9a280f1
REDOCLY=@redocly/cli@2.63.0

here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git clone -q --depth 1 --branch "$REF" "$REPO" "$tmp/upstream" 2>/dev/null
commit=$(git -C "$tmp/upstream" rev-parse HEAD)
if [ "$commit" != "$EXPECTED_COMMIT" ]; then
  echo "warning: tag $REF now points to $commit (vendored from $EXPECTED_COMMIT)" >&2
fi

mkdir -p "$tmp/clean"
(cd "$tmp/upstream" && find v5 -name '*.yaml' -print) | while read -r f; do
  mkdir -p "$tmp/clean/$(dirname "$f")"
  cp "$tmp/upstream/$f" "$tmp/clean/$f"
done

(cd "$tmp/clean" && npx -y "$REDOCLY" bundle v5/spec.yaml -o bundled.json >/dev/null)

if [ "${1:-}" = "--check" ]; then
  if cmp -s "$tmp/clean/bundled.json" "$here/spec/oeapi-v5.0.bundled.json"; then
    echo "spec/oeapi-v5.0.bundled.json matches $REF ($commit)"
  else
    echo "spec/oeapi-v5.0.bundled.json differs from $REF ($commit)" >&2
    exit 1
  fi
else
  cp "$tmp/clean/bundled.json" "$here/spec/oeapi-v5.0.bundled.json"
  cp "$tmp/upstream/LICENSE.md" "$here/spec/LICENSE.md"
  echo "wrote spec/oeapi-v5.0.bundled.json from $REF ($commit)"
fi
