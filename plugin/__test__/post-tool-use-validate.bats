#!/usr/bin/env bats
# post-tool-use-validate.bats — covers hooks/post-tool-use/validate.sh
# against every branch of contract section 6.2, run from builds/<target>/
# through pluginfinity's run_hook on both Claude Code and Copilot. A block on
# Claude Code is additionalContext on Copilot, which honours no PostToolUse
# block (assert_stop).

load lib/common

SCRIPT=hooks/post-tool-use/validate.sh

setup() {
	STUB_DIR="$BATS_TEST_TMPDIR/stub"
	mkdir -p "$STUB_DIR"
	OKFIT_CLI_CMD=""
}

# _stub_cli context_json validate_json [validate_exit] — branches on $1
# (context vs validate). Writes a sentinel on the validate branch, records
# the validate argument (the PROJECT root, K-2) and the full argv.
_stub_cli() {
	local ctx_json="$1" val_json="$2" val_rc="${3:-0}"
	cat >"$STUB_DIR/okfit" <<STUB
#!/bin/bash
case "\$1" in
	context)
		pwd >"${STUB_DIR}/context-cwd"
		printf '%s\n' '${ctx_json}'
		exit 0
		;;
	validate)
		touch "${STUB_DIR}/validate-invoked"
		printf '%s\n' "\$2" >"${STUB_DIR}/validate-arg"
		printf '%s\n' "\$@" >"${STUB_DIR}/validate-argv"
		printf '%s\n' '${val_json}'
		exit ${val_rc}
		;;
esac
STUB
	chmod +x "$STUB_DIR/okfit"
	OKFIT_CLI_CMD="$STUB_DIR/okfit"
}

_ctx() {
	# _ctx bundle_root project_root
	printf '{"schema":1,"project_root":"%s","bundle_root":"%s","config_path":null,"profile":"software-project","index_path":"%s/index.md","index_exists":true,"actors":{"agent":"okfit/claude-code"},"types":[],"tags":[]}' "$2" "$1" "$1"
}

_ctx_no_agent() {
	printf '{"schema":1,"project_root":"%s","bundle_root":"%s","config_path":null,"profile":"software-project","index_path":"%s/index.md","index_exists":true,"actors":{"agent":null},"types":[],"tags":[]}' "$2" "$1" "$1"
}

# _run target fixture [project_dir] [VAR=value...]
_run() {
	local target="$1" fixture="$2" project="${3:-$REPO_ROOT}"
	shift 3 || shift $#
	HOOK_PROJECT_DIR="$project" run_hook "$target" "$SCRIPT" "$fixture" OKFIT_CLI_CMD="$OKFIT_CLI_CMD" "$@"
}

# _input tool file cwd — a PostToolUse input for one tool and file.
_input() {
	hook_fixture PostToolUse "$(jq -nc --arg t "$1" --arg f "$2" --arg c "$3" '{tool_name: $t, tool_input: {file_path: $f}, cwd: $c}')"
}

CLEAN='{"schema":1,"exit_code":0,"diagnostics":[]}'

@test "no-ops with OKFIT_HOOKS=off and never invokes the stub" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)" "$REPO_ROOT" OKFIT_HOOKS=off
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "no-ops with OKFIT_VALIDATE_HOOK=off and never invokes the stub" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)" "$REPO_ROOT" OKFIT_VALIDATE_HOOK=off
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "is a silent no-op when jq is missing (the hook library skips the hook)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	local bin="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$bin"
	barebin "$bin"
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)" "$REPO_ROOT" PATH="$bin"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "allows silently with one stderr line when okfit_cli resolves nothing" {
	# Hermetic project dir with no node_modules, so the repo's own
	# node_modules/.bin/okfit is never reachable.
	local bin="$BATS_TEST_TMPDIR/bin" proj="$BATS_TEST_TMPDIR/proj"
	mkdir -p "$bin" "$proj/okf"
	barebin "$bin" jq
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/x.md" "$proj")" "$proj" PATH="$bin"
		assert_hook_noop
		[ "$stderr" = "okfit: CLI not found; validate hook allowing silently." ]
	done
}

@test "ignores a tool_name that is not Write or Edit" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.read-ignored.json)"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "ignores an empty tool_input.file_path" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "" "$REPO_ROOT")"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "reads Copilot's tool_input.path spelling of the edited file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example.md","code":"type-missing","severity":"error","message":"type is required"}]}' 2
	local fixture
	fixture=$(hook_fixture PostToolUse "$(jq -nc --arg f "$REPO_ROOT/okf/modules/example.md" --arg c "$REPO_ROOT" '{tool_name: "Edit", tool_input: {path: $f, old_str: "a", new_str: "b"}, cwd: $c}')")
	_run copilot "$fixture"
	assert_stop copilot "type-missing"
}

@test "no-ops outside the bundle root without invoking the validate stub" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"unrelated.ts","code":"x","severity":"error","message":"m"}]}' 2
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-outside.json)"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "treats a JsonErrorEnvelope (exit_code 3) as a warning, never a block" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"okfit_version":"0.1.0","exit_code":3,"error":{"tag":"ConfigMalformedError","message":"bad toml"}}' 3
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_hook_json '.decision // "none"' none
		[[ "$(context_text)" == *"okfit validate could not run for modules/example.md: bad toml."* ]]
	done
}

@test "blocks on a core.conformance diagnostic for the edited file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example.md","code":"type-missing","severity":"error","message":"type is required"}]}' 2
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_hook_exit 0
		assert_stop "$target" "type-missing: type is required"
	done
}

@test "does not block on a core.conformance diagnostic for a DIFFERENT file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/other.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_hook_noop
	done
}

@test "is silent on a core.lint diagnostic for the edited file (LSP phase 4, decision 8)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":1,"diagnostics":[{"source":"core.lint","file":"modules/example.md","code":"broken-links","severity":"warning","message":"dangling link"}]}' 1
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_hook_noop
	done
}

@test "is silent on a profile diagnostic for the edited file (LSP phase 4, decision 8)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":1,"diagnostics":[{"source":"profile","file":"modules/example.md","code":"project-missing","severity":"error","message":"missing Project"}]}' 1
	_run claude "$(render posttooluse.write-clean.json)"
	assert_hook_noop
}

@test "is silent on a warn-severity generated-at-drift diagnostic (LSP phase 4, decision 8)" {
	_stub_cli "$(_ctx "$REPO_ROOT" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":0,"diagnostics":[{"source":"core.lint","file":"okf/modules/example.md","code":"generated-at-drift","severity":"warn","message":"drift"}]}' 0
	_run claude "$(render posttooluse.edit-clean.json)"
	assert_hook_noop
}

@test "ignores a bundle-level diagnostic whose file is the empty string" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":1,"diagnostics":[{"source":"core.lint","file":"","code":"missing-index","severity":"warning","message":"no index"}]}' 1
	_run claude "$(render posttooluse.write-clean.json)"
	assert_hook_noop
}

@test "no-ops when the stub reports zero diagnostics" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_hook_noop
		[ -f "$STUB_DIR/validate-invoked" ]
	done
}

@test "Edit of a clean file emits noop (Minor 5, session-independent)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(render posttooluse.edit-clean.json)"
		assert_hook_noop
		[ -f "$STUB_DIR/validate-invoked" ]
	done
}

@test "passes the PROJECT root, never the bundle root, to okfit validate (Important 3)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	_run claude "$(render posttooluse.write-clean.json)"
	[ "$(cat "$STUB_DIR/validate-arg")" = "$REPO_ROOT" ]
}

@test "runs the okfit CLI from the project directory on both hosts" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	for target in $TARGETS; do
		rm -f "$STUB_DIR/context-cwd"
		_run "$target" "$(render posttooluse.write-clean.json)"
		[ "$(cat "$STUB_DIR/context-cwd")" = "$REPO_ROOT" ]
	done
}

@test "passes --skip-provenance on the invoked okfit validate command line (F-3/S-31)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	_run claude "$(render posttooluse.write-clean.json)"
	grep -qw -- "--skip-provenance" "$STUB_DIR/validate-argv"
}

@test "blocks on an Edit of index.md exactly like any other concept file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"index.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.edit-index.json)"
		assert_stop "$target" "index.md:"
	done
	_run claude "$(render posttooluse.edit-index.json)"
	assert_hook_json '.reason | startswith("index.md:")' true
}

@test "classifies correctly when bundle_root equals project_root" {
	_stub_cli "$(_ctx "$REPO_ROOT" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"okf/modules/example.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	_run claude "$(_input Write "$REPO_ROOT/okf/modules/example.md" "$REPO_ROOT")"
	assert_stop claude "type-missing"
}

@test "quotes a file path containing a space through every branch" {
	local spaced="$BATS_TEST_TMPDIR/fake proj"
	mkdir -p "$spaced/okf/modules"
	_stub_cli "$(_ctx "$spaced/okf" "$spaced")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example file.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$spaced/okf/modules/example file.md" "$spaced")" "$spaced"
		assert_stop "$target" "modules/example file.md:"
	done
}

# okfit #74: a concept file with no generated.by blocks on Write (the agent
# authored the whole file) and warns on Edit.

# _bundle_with concept_relpath frontmatter_body — a fake project whose okf/
# holds one concept file with the given frontmatter; echoes the project dir.
_bundle_with() {
	local rel="$1" fm="$2"
	local proj="$BATS_TEST_TMPDIR/proj"
	mkdir -p "$proj/okf/$(dirname "$rel")"
	printf -- '---\n%s\n---\n\n# Body\n' "$fm" >"$proj/okf/$rel"
	printf '%s' "$proj"
}

@test "blocks a Write of a concept with no generated.by when actors.agent is set (#74)" {
	local proj
	proj=$(_bundle_with modules/core.md 'type: Module
title: Core')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/modules/core.md" "$proj")" "$proj"
		assert_stop "$target" "modules/core.md: generated.by is missing"
		assert_stop "$target" "okfit/claude-code"
	done
}

@test "warns, never blocks, on an Edit of a concept with no generated.by (#74)" {
	local proj
	proj=$(_bundle_with modules/core.md 'type: Module
title: Core')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Edit "$proj/okf/modules/core.md" "$proj")" "$proj"
		[[ "$(context_text)" == *"generated.by"*"okfit/claude-code"* ]]
		assert_hook_json '.decision // "none"' none
	done
}

@test "no-ops on a Write of a concept that already carries generated.by (#74)" {
	local proj
	proj=$(_bundle_with modules/core.md 'type: Module
title: Core
generated:
  by: okfit/claude-code')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/modules/core.md" "$proj")" "$proj"
		assert_hook_noop
	done
}

@test "no-ops on a concept with no generated.by when actors.agent is unset (#74)" {
	local proj
	proj=$(_bundle_with modules/core.md 'type: Module
title: Core')
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$CLEAN"
	_run claude "$(_input Write "$proj/okf/modules/core.md" "$proj")" "$proj"
	assert_hook_noop
}

@test "never applies the generated.by check to index.md or log.md (#74)" {
	local proj
	proj=$(_bundle_with modules/index.md 'okf_version: "0.2"')
	printf '# Log\n' >"$proj/okf/log.md"
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	_run claude "$(_input Write "$proj/okf/modules/index.md" "$proj")" "$proj"
	assert_hook_noop
	_run claude "$(_input Write "$proj/okf/log.md" "$proj")" "$proj"
	assert_hook_noop
}

@test "only the generated.by warning is reported on an Edit, even with lint warnings present (#74, LSP phase 4 decision 8)" {
	local proj
	proj=$(_bundle_with modules/core.md 'type: Module
title: Core')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" \
		'{"schema":1,"exit_code":0,"diagnostics":[{"source":"core.lint","file":"modules/core.md","code":"stale","severity":"warning","message":"m"}]}'
	_run claude "$(_input Edit "$proj/okf/modules/core.md" "$proj")" "$proj"
	[[ "$(context_text)" == *"generated.by"* ]]
	[[ "$(context_text)" != *"stale:"* ]]
}

@test "a conformance error still blocks when lint warnings are also present for the file (LSP phase 4 decision 8)" {
	local proj
	proj=$(_bundle_with modules/core.md 'type: Module
title: Core
generated:
  by: okfit/claude-code')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/core.md","code":"type-missing","severity":"error","message":"type is required"},{"source":"core.lint","file":"modules/core.md","code":"stale","severity":"warning","message":"m"}]}' 2
	_run claude "$(_input Edit "$proj/okf/modules/core.md" "$proj")" "$proj"
	assert_stop claude "type-missing"
	assert_hook_json '.reason | contains("stale")' false
}

@test "resolves node_modules/.bin/okfit with OKFIT_CLI_CMD unset (Important 2, real okfit binary)" {
	[ -n "${OKFIT_BIN:-}" ] && [ -x "${OKFIT_BIN:-}" ] || skip "OKFIT_BIN not set; skipping the production-resolution smoke test"
	local proj bin
	# Physical path: the real CLI canonicalises its cwd; the hook does not.
	proj="$(cd "$BATS_TEST_TMPDIR" && pwd -P)/real"
	mkdir -p "$proj/node_modules/.bin"
	ln -s "$(cd "$(dirname "$OKFIT_BIN")" && pwd -P)/$(basename "$OKFIT_BIN")" "$proj/node_modules/.bin/okfit"
	bin="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$bin"
	barebin "$bin" jq node awk
	cp -R "$PLUGIN_DIR/__test__/fixtures/bundles/clean/okf" "$proj/okf"
	_run claude "$(_input Write "$proj/okf/modules/example.md" "$proj")" "$proj" PATH="$bin"
	assert_hook_noop
	cat >"$proj/okf/modules/broken.md" <<'MD'
---
title: Broken Module
description: Deliberately missing its required type key.
---

# Broken Module
MD
	_run claude "$(_input Write "$proj/okf/modules/broken.md" "$proj")" "$proj" PATH="$bin"
	one_object
	assert_stop claude "modules/broken.md"
}
