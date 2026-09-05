#!/usr/bin/env bats
# session-start-orientation.bats — covers hooks/session-start/orientation.sh against
# every branch of contract section 6.1.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/hooks/session-start/orientation.sh"
FIXTURES="$PLUGIN_ROOT/hooks/fixtures"
RENDER="$PLUGIN_ROOT/__test__/lib/render-fixture.sh"

setup() {
	STUB_DIR="$(mktemp -d)"
	PROJECT_DIR="$(mktemp -d)"
	mkdir -p "$PROJECT_DIR/okf"
}

teardown() {
	rm -rf "$STUB_DIR" "$PROJECT_DIR"
	unset OKFIT_HOOKS OKFIT_SESSION_HOOK OKFIT_VALIDATE_HOOK OKFIT_CLI_CMD
}

# _stub_cli json [exit_code] — points OKFIT_CLI_CMD (C-1.4) at a fake okfit
# printing $1 for any subcommand and exiting $2 (default 0). Writes a
# sentinel file on invocation so a kill-switch test can assert the stub was
# never called (contract section 9.1: "the stub writes a sentinel file on
# invocation").
_stub_cli() {
	cat >"$STUB_DIR/okfit" <<EOF
#!/bin/bash
touch "${STUB_DIR}/invoked"
printf '%s\n' '${1}'
exit ${2:-0}
EOF
	chmod +x "$STUB_DIR/okfit"
	export OKFIT_CLI_CMD="$STUB_DIR/okfit"
}

# _stub_context bundle_root index_path index_exists config_path profile
#   actors_agent types_json tags_json — builds one canned context envelope.
_stub_context() {
	local bundle_root="$1" index_path="$2" index_exists="$3" config_path="$4"
	local profile="$5" actors_agent="$6" types_json="${7:-[]}" tags_json="${8:-[]}"
	local config_field="null"
	[ -n "$config_path" ] && config_field="\"$config_path\""
	local profile_field="null"
	[ -n "$profile" ] && profile_field="\"$profile\""
	local agent_field="null"
	[ -n "$actors_agent" ] && agent_field="\"$actors_agent\""
	_stub_cli "{\"schema\":1,\"project_root\":\"$PROJECT_DIR\",\"bundle_root\":\"$bundle_root\",\"config_path\":$config_field,\"profile\":$profile_field,\"index_path\":\"$index_path\",\"index_exists\":$index_exists,\"actors\":{\"agent\":$agent_field},\"types\":$types_json,\"tags\":$tags_json}"
}

# _barebin dir — populates dir with symlinks to every external tool
# orientation.sh needs (bash, jq, cat, wc, head, tr, dirname), but NOT
# okfit — the seam the "no CLI resolves" tests use so `command -v okfit`
# fails while the script itself still runs.
_barebin() {
	local dir="$1"
	local tool
	for tool in bash jq cat wc head tr dirname sed; do
		ln -sf "$(command -v "$tool")" "$dir/$tool"
	done
}

# _run_hook envelope_json [path_override] [project_dir] — env -i plus only
# what a real dispatch provides. stderr is captured to $STUB_DIR/stderr
# rather than merged into $output, since bats' `run` otherwise interleaves
# it with stdout and breaks `jq -e` on the combined text.
_run_hook() {
	local envelope="$1"
	local path_override="${2:-$PATH}"
	local project_dir="${3:-$PROJECT_DIR}"
	env -i \
		PATH="$path_override" \
		CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
		CLAUDE_PROJECT_DIR="$project_dir" \
		OKFIT_CLI_CMD="${OKFIT_CLI_CMD:-}" \
		OKFIT_HOOKS="${OKFIT_HOOKS:-}" \
		OKFIT_SESSION_HOOK="${OKFIT_SESSION_HOOK:-}" \
		bash "$SCRIPT" <<<"$envelope" 2>"$STUB_DIR/stderr"
}

_run_hook_file() {
	local envelope_file="$1"
	local path_override="${2:-$PATH}"
	local project_dir="${3:-$PROJECT_DIR}"
	"$RENDER" "$envelope_file" | env -i \
		PATH="$path_override" \
		CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
		CLAUDE_PROJECT_DIR="$project_dir" \
		OKFIT_CLI_CMD="${OKFIT_CLI_CMD:-}" \
		bash "$SCRIPT" 2>"$STUB_DIR/stderr"
}

@test "emits exactly one JSON object on every source (startup, resume, clear, compact)" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
	local source
	for source in startup resume clear compact; do
		run _run_hook_file "$FIXTURES/sessionstart.${source}.json"
		[ "$status" -eq 0 ]
		echo "$output" | jq -es 'length == 1'
	done
}

@test "additionalContext names the bundle root and the profile from a stubbed context envelope" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e --arg root "$PROJECT_DIR/okf" \
		'.hookSpecificOutput.additionalContext | contains("okfit bundle: " + $root + " (profile: software-project)")'
}

@test "every stubbed type name and tag name appears as a bullet" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project "" \
		'[{"name":"Module","description":"A module","guidance":"guide text"},{"name":"Decision","description":null,"guidance":null}]' \
		'[{"name":"api","description":"API related"}]'
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	local ctx
	ctx="$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')"
	echo "$ctx" | grep -qF -- "- Module: A module"
	echo "$ctx" | grep -qF -- "  guide text"
	echo "$ctx" | grep -qF -- "- Decision: (no description)"
	echo "$ctx" | grep -qF -- "- api: API related"
}

@test "index.md content appears verbatim when index_exists is true" {
	echo "# Bundle index

Some prose." >"$PROJECT_DIR/okf/index.md"
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" true "" software-project ""
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext | contains("# Bundle index") and contains("Some prose.")'
}

@test "emits C-6.14 when index_exists is false" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e --arg p "$PROJECT_DIR/okf/index.md" \
		'.hookSpecificOutput.additionalContext | contains("No index.md yet at " + $p + ". Run `okfit init` or write one.")'
}

@test "a 13000-byte index.md triggers C-6.13 with the real byte count" {
	head -c 13000 /dev/zero | tr '\0' 'x' >"$PROJECT_DIR/okf/index.md"
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" true "" software-project ""
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	local ctx
	ctx="$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')"
	echo "$ctx" | grep -qF "[truncated at 12000 bytes; index.md is 13000 bytes — read it directly for the rest]"
	# The truncated prefix is present; the 13000th byte (past the cut) is not.
	[ "$(echo "$ctx" | tr -d '\n' | grep -o 'x' | wc -l | tr -d ' ')" -lt 13000 ]
}

@test "appends C-6.7 and C-6.8 when config_path is null" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project "set"
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext
		| contains("No okfit config found in this project.")
		and contains("Run `okfit init` to scaffold an okf/ bundle and a config.")'
}

@test "omits C-6.7 and C-6.8 when config_path is non-null" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.config.toml" software-project "set"
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '(.hookSpecificOutput.additionalContext | contains("No okfit config found")) | not'
}

@test "appends C-6.9 when actors.agent is null" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.config.toml" software-project ""
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext
		| contains("Note: actors.agent is not set") and contains("okfit/claude-code")'
}

@test "omits C-6.9 when actors.agent is set" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.config.toml" software-project "okfit/claude-code"
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '(.hookSpecificOutput.additionalContext | contains("actors.agent is not set")) | not'
}

@test "emits C-6.6 when the stubbed CLI exits non-zero" {
	_stub_cli '{"schema":1,"okfit_version":"0.1.0","exit_code":3,"error":{"tag":"ConfigMalformedError","message":"bad toml"}}' 3
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext ==
		"okfit context could not run (its config looks malformed); skipping orientation this session."'
	grep -qF "okfit: context exited 3" "$STUB_DIR/stderr"
}

@test "emits C-6.1 and C-6.2 when okfit_cli resolves nothing" {
	local barebin
	barebin="$(mktemp -d)"
	_barebin "$barebin"
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}' "$barebin"
	rm -rf "$barebin"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext
		| contains("okfit: no okfit CLI found. Install @okfit/plugin")
		and contains("pnpm add -D @okfit/plugin")'
}

@test "no-ops with OKFIT_HOOKS=off and never invokes the stub" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
	export OKFIT_HOOKS=off
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ ! -f "$STUB_DIR/invoked" ]
}

@test "no-ops with OKFIT_SESSION_HOOK=off and never invokes the stub" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
	export OKFIT_SESSION_HOOK=off
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ ! -f "$STUB_DIR/invoked" ]
}

@test "falls back to the hand-built literal when jq is missing" {
	local fakebin
	fakebin="$(mktemp -d)"
	ln -s "$(command -v cat)" "$fakebin/cat"
	ln -s "$(command -v bash)" "$fakebin/bash"
	run _run_hook '{"cwd":"'"$PROJECT_DIR"'"}' "$fakebin"
	rm -rf "$fakebin"
	[ "$status" -eq 0 ]
	# A hand-built printf, not jq: still exactly one JSON object.
	echo "$output" | jq -es 'length == 1'
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext ==
		"okfit: jq not found; skipping session orientation. Install jq to enable bundle and vocabulary injection."'
}

@test "drains a 2MB stdin without hanging" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
	local big
	big="$(mktemp)"
	head -c 2000000 /dev/zero | tr '\0' 'x' >"$big"
	run bash -c "env -i PATH='$PATH' CLAUDE_PLUGIN_ROOT='$PLUGIN_ROOT' CLAUDE_PROJECT_DIR='$PROJECT_DIR' OKFIT_CLI_CMD='$OKFIT_CLI_CMD' bash '$SCRIPT' <'$big'"
	rm -f "$big"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
}

@test "drains an empty stdin without erroring" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
	run _run_hook ""
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
}

@test "a project directory whose path contains a space round-trips" {
	local spaced="$STUB_DIR/fake proj"
	mkdir -p "$spaced/okf"
	echo "hi from a spaced path" >"$spaced/okf/index.md"
	_stub_context "$spaced/okf" "$spaced/okf/index.md" true "" software-project ""
	run _run_hook '{"cwd":"'"$spaced"'"}' "$PATH" "$spaced"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext | contains("hi from a spaced path")'
}
