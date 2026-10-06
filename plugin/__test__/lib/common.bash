# shellcheck shell=bash
# common.bash — shared helpers for the hook suites. Loads pluginfinity's bats
# helper (run_hook, hook_fixture, assert_hook_*) from the repo root's
# node_modules: plugin/ is not a workspace package, so it has no
# node_modules of its own.

load "$BATS_TEST_DIRNAME/../../node_modules/pluginfinity/bats/pluginfinity.bash"

REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"
RENDER="$PLUGIN_DIR/__test__/lib/render-fixture.sh"
TARGETS="claude copilot"

# render name — renders __test__/fixtures/<name> into the test's temp dir
# and prints the absolute path, for run_hook.
render() {
	local out="$BATS_TEST_TMPDIR/rendered-$1"
	bash "$RENDER" "$PLUGIN_DIR/__test__/fixtures/$1" >"$out"
	printf '%s\n' "$out"
}

# context_text — the additionalContext of the last run_hook, in either host's
# shape (Claude nests it under hookSpecificOutput; Copilot keeps it flat).
context_text() {
	printf '%s' "$output" | jq -r '.hookSpecificOutput.additionalContext // .additionalContext // empty'
}

# assert_stop target needle — the last run sent a stop-and-fix signal whose
# text contains needle: a top-level block on Claude, additionalContext on
# Copilot, which honours no PostToolUse block.
assert_stop() {
	local target="$1" needle="$2" text
	if [ "$target" = claude ]; then
		[ "$(printf '%s' "$output" | jq -r '.decision')" = block ] || {
			echo "expected a block on claude, got: $output" >&2
			return 1
		}
		text=$(printf '%s' "$output" | jq -r '.reason')
	else
		[ "$(printf '%s' "$output" | jq -r '.decision // "none"')" = none ] || {
			echo "copilot got a decision field: $output" >&2
			return 1
		}
		text=$(context_text)
	fi
	[[ "$text" == *"$needle"* ]] || {
		echo "stop text lacks '$needle': $text" >&2
		return 1
	}
}

# one_object — stdout is exactly one JSON value.
one_object() {
	printf '%s' "$output" | jq -es 'length == 1' >/dev/null
}

# barebin dir tool... — symlinks each named tool into dir, plus what the
# pluginfinity hook library itself needs (minus jq, which a test adds by
# name when it wants it).
barebin() {
	local dir="$1" tool
	shift
	for tool in bash cat mktemp rm date mkdir basename dirname "$@"; do
		ln -sf "$(command -v "$tool")" "$dir/$tool"
	done
}
