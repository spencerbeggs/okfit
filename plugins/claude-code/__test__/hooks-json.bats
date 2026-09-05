#!/usr/bin/env bats
# hooks-json.bats — pins hooks.json's wiring: the top-level `hooks` wrapper
# (Judge note A-1), the two registered events, PostToolUse's exact matcher,
# both timeouts (C-2), and that every named script exists and is readable
# (M-32; readable not executable — the repo's lint-staged strips the exec
# bit from committed *.sh). Companion to __test__/agent-skill-registration.bats,
# which owns the skills/agent roster (interpretation B-8) — this file owns
# only hooks.json.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
MANIFEST="$PLUGIN_ROOT/hooks/hooks.json"

# _named_scripts manifest — prints, one per line, every hook script path
# named in a "command" field with ${CLAUDE_PLUGIN_ROOT} resolved against
# PLUGIN_ROOT. Uses only parameter expansion (no sed/awk escaping of the
# literal token ${CLAUDE_PLUGIN_ROOT} is needed this way).
_named_scripts() {
	placeholder='${CLAUDE_PLUGIN_ROOT}'
	jq -r '.hooks[][].hooks[].command' "$1" | while IFS= read -r cmd; do
		path="${cmd#*\"}"
		path="${path%\"*}"
		path="${path/$placeholder/$PLUGIN_ROOT}"
		printf '%s\n' "$path"
	done
}

@test "hooks.json is valid JSON" {
	run jq -e . "$MANIFEST"
	[ "$status" -eq 0 ]
}

@test "hooks.json has a top-level hooks key with exactly SessionStart and PostToolUse" {
	run jq -r '.hooks | keys | sort | join(",")' "$MANIFEST"
	[ "$status" -eq 0 ]
	[ "$output" = "PostToolUse,SessionStart" ]
}

@test "SessionStart declares no matcher; PostToolUse's matcher is exactly Write|Edit" {
	run jq -r '.hooks.SessionStart[0] | has("matcher")' "$MANIFEST"
	[ "$status" -eq 0 ]
	[ "$output" = "false" ]

	run jq -r '.hooks.PostToolUse[0].matcher' "$MANIFEST"
	[ "$status" -eq 0 ]
	[ "$output" = "Write|Edit" ]
}

@test "timeouts are 10 and 30" {
	run jq -r '.hooks.SessionStart[0].hooks[0].timeout' "$MANIFEST"
	[ "$status" -eq 0 ]
	[ "$output" -eq 10 ]

	run jq -r '.hooks.PostToolUse[0].hooks[0].timeout' "$MANIFEST"
	[ "$status" -eq 0 ]
	[ "$output" -eq 30 ]
}

@test "every command names a script that exists" {
	while IFS= read -r script; do
		[ -f "$script" ] || {
			echo "hooks.json names a script that does not exist: $script" >&2
			return 1
		}
	done < <(_named_scripts "$MANIFEST")
}

@test "every named hook script is readable" {
	while IFS= read -r script; do
		[ -r "$script" ] || {
			echo "hook script is not readable: $script" >&2
			return 1
		}
	done < <(_named_scripts "$MANIFEST")
}
