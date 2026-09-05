#!/usr/bin/env bash
# render-fixture.sh — emit a hook fixture with __REPO_ROOT__ resolved.
#
# Adapted from vitest-agent/plugins/claude-code/hooks/__test__/render-fixture.sh.
# The fixtures under hooks/fixtures/ are templates: the machine-specific
# repository root is stored as the literal token __REPO_ROOT__ so the suite
# is not pinned to one developer's checkout path (M-5).
#
# The root is derived from this script's own location — NOT from
# `git rev-parse --show-toplevel`, which is unavailable when the tree is
# exported to a plain directory.
#
# Usage: bash render-fixture.sh <fixture.json>
# Invoke via `bash` — the repo's pre-commit hook strips the executable bit
# from .sh files, so the shebang alone is not enough.

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "render-fixture.sh: expected exactly one argument (a fixture path), got $#" >&2
	exit 2
fi

fixture="$1"

if [ ! -f "$fixture" ]; then
	echo "render-fixture.sh: fixture not found: ${fixture}" >&2
	exit 1
fi

# lib/ -> __test__/ -> claude-code/ -> plugins/ -> repo root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

# Use a sed delimiter that cannot appear in an absolute path.
sed "s|__REPO_ROOT__|${REPO_ROOT}|g" "$fixture"
