#!/usr/bin/env bats
# session-start-orientation.bats — covers hooks/session-start/orientation.sh
# against every branch of contract section 6.1, run from builds/<target>/
# through pluginfinity's run_hook on both Claude Code and Copilot.

load lib/common

SCRIPT=hooks/session-start/orientation.sh

setup() {
	STUB_DIR="$BATS_TEST_TMPDIR/stub"
	PROJECT_DIR="$BATS_TEST_TMPDIR/proj"
	mkdir -p "$STUB_DIR" "$PROJECT_DIR/okf"
	OKFIT_CLI_CMD=""
}

# _stub_cli json [exit_code] — points OKFIT_CLI_CMD (C-1.4) at a fake okfit
# printing $1 for any subcommand and exiting $2 (default 0). Writes a
# sentinel file on invocation so a kill-switch test can assert the stub was
# never called.
_stub_cli() {
	cat >"$STUB_DIR/okfit" <<STUB
#!/bin/bash
touch "${STUB_DIR}/invoked"
pwd >"${STUB_DIR}/cwd"
printf '%s\n' '${1}'
exit ${2:-0}
STUB
	chmod +x "$STUB_DIR/okfit"
	OKFIT_CLI_CMD="$STUB_DIR/okfit"
}

# _stub_context bundle_root index_path index_exists config_path profile
#   actors_agent types_json tags_json [profile_requested]
_stub_context() {
	local bundle_root="$1" index_path="$2" index_exists="$3" config_path="$4"
	local profile="$5" actors_agent="$6" types_json="${7:-[]}" tags_json="${8:-[]}"
	local profile_requested="${9:-$profile}"
	local config_field="null"
	[ -n "$config_path" ] && config_field="\"$config_path\""
	local profile_field="null"
	[ -n "$profile" ] && profile_field="\"$profile\""
	local profile_requested_field="null"
	[ -n "$profile_requested" ] && profile_requested_field="\"$profile_requested\""
	local agent_field="null"
	[ -n "$actors_agent" ] && agent_field="\"$actors_agent\""
	_stub_cli "{\"schema\":1,\"project_root\":\"$PROJECT_DIR\",\"bundle_root\":\"$bundle_root\",\"config_path\":$config_field,\"profile\":$profile_field,\"profile_requested\":$profile_requested_field,\"index_path\":\"$index_path\",\"index_exists\":$index_exists,\"actors\":{\"agent\":$agent_field},\"types\":$types_json,\"tags\":$tags_json}"
}

# _fixture — a SessionStart input whose cwd is the fake project.
_fixture() {
	hook_fixture SessionStart "{\"source\":\"startup\",\"cwd\":\"$PROJECT_DIR\"}"
}

# _run target [fixture] [VAR=value...] — run the built hook with the stub and
# the kill switches passed through.
_run() {
	local target="$1" fixture="${2:-$(_fixture)}"
	shift 2 || shift $#
	HOOK_PROJECT_DIR="$PROJECT_DIR" run_hook "$target" "$SCRIPT" "$fixture" \
		OKFIT_CLI_CMD="$OKFIT_CLI_CMD" "$@"
}

_default_context() {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project ""
}

@test "emits exactly one JSON object on every source (startup, resume, clear, compact)" {
	_default_context
	local source target
	for target in $TARGETS; do
		for source in startup resume clear compact; do
			_run "$target" "$(render "sessionstart.${source}.json")"
			assert_hook_exit 0
			one_object
		done
	done
}

@test "uses each host's context shape" {
	_default_context
	_run claude
	assert_hook_json .hookSpecificOutput.hookEventName SessionStart
	_run copilot
	assert_hook_json '.additionalContext | type' string
	assert_hook_json '.hookSpecificOutput // "none"' none
}

@test "additionalContext names the bundle root and the profile from a stubbed context envelope" {
	_default_context
	for target in $TARGETS; do
		_run "$target"
		assert_hook_exit 0
		[[ "$(context_text)" == *"okfit bundle: $PROJECT_DIR/okf (profile: software-project)"* ]]
	done
}

@test "runs okfit context from the project directory on both hosts" {
	_default_context
	local real
	real=$(cd "$PROJECT_DIR" && pwd -P)
	for target in $TARGETS; do
		rm -f "$STUB_DIR/cwd"
		_run "$target"
		[ "$(cd "$(cat "$STUB_DIR/cwd")" && pwd -P)" = "$real" ]
	done
}

@test "every stubbed type name and tag name appears as a bullet" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project "" \
		'[{"name":"Module","description":"A module","guidance":"guide text"},{"name":"Decision","description":null,"guidance":null}]' \
		'[{"name":"api","description":"API related"}]'
	for target in $TARGETS; do
		_run "$target"
		local ctx
		ctx="$(context_text)"
		echo "$ctx" | grep -qF -- "- Module: A module"
		echo "$ctx" | grep -qF -- "  guide text"
		echo "$ctx" | grep -qF -- "- Decision: (no description)"
		echo "$ctx" | grep -qF -- "- api: API related"
	done
}

@test "a type's required keys, verified requirement, and fields render under its bullet (issue #33)" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project "" \
		'[{"name":"Decision","description":"A choice","guidance":null,"required":null,"require_verified":true,"fields":[]},{"name":"Module","description":"A module","guidance":null,"required":["resource","kind"],"require_verified":null,"fields":[{"name":"kind","description":"d","kind":null,"values":[{"name":"package","description":"p"},{"name":"website","description":"w"}]},{"name":"layer","description":"d","kind":null,"values":null},{"name":"resource","description":"d","kind":"path","values":null}]}]' \
		'[]'
	_run claude
	local ctx
	ctx="$(context_text)"
	echo "$ctx" | grep -qF -- "- Decision: A choice"
	echo "$ctx" | grep -qF -- "  verified: required"
	echo "$ctx" | grep -qF -- "  required: resource, kind"
	echo "$ctx" | grep -qF -- "  fields: kind (package | website), layer, resource (path)"
	echo "$ctx" | grep -A1 -F -- "- Decision: A choice" | tail -1 | grep -qF -- "  verified: required"
}

@test "index.md content appears verbatim when index_exists is true" {
	printf '# Bundle index\n\nSome prose.\n' >"$PROJECT_DIR/okf/index.md"
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" true "" software-project ""
	for target in $TARGETS; do
		_run "$target"
		[[ "$(context_text)" == *"# Bundle index"* ]]
		[[ "$(context_text)" == *"Some prose."* ]]
	done
}

@test "emits C-6.14 when index_exists is false" {
	_default_context
	_run claude
	[[ "$(context_text)" == *"No index.md yet at $PROJECT_DIR/okf/index.md. Run \`okfit init\` or write one."* ]]
}

@test "a 13000-byte index.md triggers C-6.13 with the real byte count" {
	head -c 13000 /dev/zero | tr '\0' 'x' >"$PROJECT_DIR/okf/index.md"
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" true "" software-project ""
	_run claude
	local ctx
	ctx="$(context_text)"
	echo "$ctx" | grep -qF "[truncated at 12000 bytes; index.md is 13000 bytes — read it directly for the rest]"
	[ "$(echo "$ctx" | tr -d '\n' | grep -o 'x' | wc -l | tr -d ' ')" -lt 13000 ]
}

@test "appends C-6.7 and C-6.8 when config_path is null" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "" software-project "set"
	_run claude
	[[ "$(context_text)" == *"No okfit config found in this project."* ]]
	[[ "$(context_text)" == *"Run \`okfit init\` to scaffold an okf/ bundle and a config."* ]]
}

@test "omits C-6.7 and C-6.8 when config_path is non-null" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.toml" software-project "set"
	_run claude
	[[ "$(context_text)" != *"No okfit config found"* ]]
}

@test "appends C-6.9 when actors.agent is null" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.toml" software-project ""
	_run claude
	[[ "$(context_text)" == *"Note: actors.agent is not set"* ]]
	[[ "$(context_text)" == *"okfit/claude-code"* ]]
}

@test "omits C-6.9 when actors.agent is set" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.toml" software-project "okfit/claude-code"
	_run claude
	[[ "$(context_text)" != *"actors.agent is not set"* ]]
}

@test "emits C-6.6 with the CLI's own error message when the stubbed CLI exits non-zero" {
	_stub_cli '{"schema":1,"okfit_version":"0.1.0","exit_code":3,"error":{"tag":"ConfigMalformedError","message":"bad toml"}}' 3
	for target in $TARGETS; do
		_run "$target"
		assert_hook_exit 0
		[ "$(context_text)" = "okfit context could not run (its config looks malformed: bad toml); skipping orientation this session." ]
		[[ "$stderr" == *"okfit: context exited 3"* ]]
	done
}

@test "falls back to the generic C-6.6 sentence when the CLI stdout carries no error.message" {
	_stub_cli '{"schema":1,"okfit_version":"0.1.0","exit_code":3}' 3
	_run claude
	[ "$(context_text)" = "okfit context could not run (its config looks malformed); skipping orientation this session." ]
}

@test "appends the unknown-profile line when profile is null and profile_requested is neither null nor none (Important 1)" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.toml" "" "set" "[]" "[]" "nope"
	_run claude
	[[ "$(context_text)" == *'Profile "nope" is unknown; no vocabulary was loaded. Check bundle.profile in the okfit config.'* ]]
}

@test "omits the unknown-profile line when profile_requested is \"none\"" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.toml" "" "set" "[]" "[]" "none"
	_run claude
	[[ "$(context_text)" != *"is unknown; no vocabulary was loaded"* ]]
}

@test "appends the okfit init nudge when config_path is outside project_root (Minor 7, user-level XDG config)" {
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "/some/xdg/config.toml" software-project "set"
	_run claude
	[[ "$(context_text)" == *"No okfit config found in this project."* ]]
}

@test "truncates a large vocabulary block at 8000 bytes (Minor 10)" {
	local types_json
	types_json=$(jq -n '[range(0;200) | {name: ("Type" + (. + 1000 | tostring)), description: "d", guidance: ([range(0;100)] | map("g") | join(""))}]')
	_stub_context "$PROJECT_DIR/okf" "$PROJECT_DIR/okf/index.md" false "$PROJECT_DIR/okfit.toml" software-project "set" "$types_json" "[]"
	_run claude
	local ctx
	ctx="$(context_text)"
	echo "$ctx" | grep -qF "[truncated at 8000 bytes; vocabulary is"
	[ "$(echo -n "$ctx" | wc -c | tr -d ' ')" -lt 8600 ]
}

@test "emits C-6.1 and C-6.2 when okfit_cli resolves nothing" {
	local bin="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$bin"
	barebin "$bin" jq wc head tr sed
	for target in $TARGETS; do
		_run "$target" "" PATH="$bin"
		assert_hook_exit 0
		[[ "$(context_text)" == *"okfit: no okfit CLI found. Install @okfit/plugin"* ]]
		[[ "$(context_text)" == *"pnpm add -D @okfit/plugin"* ]]
	done
}

@test "no-ops with OKFIT_HOOKS=off and never invokes the stub" {
	_default_context
	for target in $TARGETS; do
		_run "$target" "" OKFIT_HOOKS=off
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/invoked" ]
}

@test "no-ops with OKFIT_SESSION_HOOK=off and never invokes the stub" {
	_default_context
	for target in $TARGETS; do
		_run "$target" "" OKFIT_SESSION_HOOK=off
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/invoked" ]
}

@test "is a silent no-op when jq is missing (the hook library skips the hook)" {
	_default_context
	local bin="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$bin"
	barebin "$bin"
	for target in $TARGETS; do
		_run "$target" "" PATH="$bin"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/invoked" ]
}

@test "drains a 2MB stdin without hanging" {
	_default_context
	local big="$BATS_TEST_TMPDIR/big.json"
	{
		printf '{"hook_event_name":"SessionStart","cwd":"%s","pad":"' "$PROJECT_DIR"
		head -c 2000000 /dev/zero | tr '\0' 'x'
		printf '"}'
	} >"$big"
	for target in $TARGETS; do
		_run "$target" "$big"
		assert_hook_exit 0
		[[ "$(context_text)" == *"okfit bundle:"* ]]
	done
}

@test "a project directory whose path contains a space round-trips" {
	local spaced="$BATS_TEST_TMPDIR/fake proj"
	mkdir -p "$spaced/okf"
	echo "hi from a spaced path" >"$spaced/okf/index.md"
	_stub_context "$spaced/okf" "$spaced/okf/index.md" true "" software-project ""
	for target in $TARGETS; do
		HOOK_PROJECT_DIR="$spaced" run_hook "$target" "$SCRIPT" "$(hook_fixture SessionStart "{\"cwd\":\"$spaced\"}")" OKFIT_CLI_CMD="$OKFIT_CLI_CMD"
		[[ "$(context_text)" == *"hi from a spaced path"* ]]
	done
}
