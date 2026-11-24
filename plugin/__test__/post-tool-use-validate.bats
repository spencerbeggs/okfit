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
# the --root value (the PROJECT root, K-2) and the full argv.
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
		[ "\$2" = "--root" ] && printf '%s\n' "\$3" >"${STUB_DIR}/validate-arg"
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

@test "a core.lint frontmatter-missing warning for the edited file does not block (OKF 0.3 3.2)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":0,"diagnostics":[{"source":"core.lint","file":"modules/example.md","code":"frontmatter-missing","severity":"warning","message":"no frontmatter, so this file is not a concept and is skipped"}]}' 0
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$REPO_ROOT/okf/modules/example.md" "$REPO_ROOT")"
		assert_hook_noop
	done
	[ -f "$STUB_DIR/validate-invoked" ]
}

@test "reads Copilot's tool_input.path spelling of the edited file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example.md","code":"frontmatter-unclosed","severity":"error","message":"type is required"}]}' 2
	local fixture
	fixture=$(hook_fixture PostToolUse "$(jq -nc --arg f "$REPO_ROOT/okf/modules/example.md" --arg c "$REPO_ROOT" '{tool_name: "Edit", tool_input: {path: $f, old_str: "a", new_str: "b"}, cwd: $c}')")
	_run copilot "$fixture"
	assert_stop copilot "frontmatter-unclosed"
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

@test "passes the edited file to okfit validate as a target (scoped validation)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	_run claude "$(render posttooluse.write-clean.json)"
	[ "$(paste -sd' ' "$STUB_DIR/validate-argv")" = "validate --root $REPO_ROOT $REPO_ROOT/okf/modules/example.md --format json --skip-provenance" ]
}

@test "blocks on a core.conformance diagnostic for the edited file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example.md","code":"frontmatter-unclosed","severity":"error","message":"type is required"}]}' 2
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_hook_exit 0
		assert_stop "$target" "frontmatter-unclosed: type is required"
	done
}

@test "does not block on a core.conformance diagnostic for a DIFFERENT file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/other.md","code":"frontmatter-unclosed","severity":"error","message":"m"}]}' 2
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

@test "passes the PROJECT root, never the bundle root, to okfit validate --root (Important 3)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" "$CLEAN"
	_run claude "$(render posttooluse.write-clean.json)"
	[ "$(cat "$STUB_DIR/validate-arg")" = "$REPO_ROOT" ]
}

# _stub_old_cli context_json legacy_json [legacy_exit] — a pre-`--root` CLI: the new
# `validate --root ... <file>` form is a usage error (64), the legacy
# `validate <project_root>` form works. Appends each validate argv to validate-calls.
_stub_old_cli() {
	local ctx_json="$1" val_json="$2" val_rc="${3:-0}"
	cat >"$STUB_DIR/okfit" <<STUB
#!/bin/bash
case "\$1" in
	context)
		printf '%s\n' '${ctx_json}'
		exit 0
		;;
	validate)
		printf '%s\n' "\$*" >>"${STUB_DIR}/validate-calls"
		if [ "\$2" = "--root" ]; then
			exit 64
		fi
		printf '%s\n' '${val_json}'
		exit ${val_rc}
		;;
esac
STUB
	chmod +x "$STUB_DIR/okfit"
	OKFIT_CLI_CMD="$STUB_DIR/okfit"
}

@test "retries the pre-phase-4 whole-bundle form when the scoped call exits 64, and still blocks on the edited file" {
	_stub_old_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example.md","code":"frontmatter-unclosed","severity":"error","message":"m"},{"source":"core.conformance","file":"modules/other.md","code":"frontmatter-unclosed","severity":"error","message":"o"}]}' 2
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-calls"
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_stop "$target" "modules/example.md:"
		[ "$(sed -n 1p "$STUB_DIR/validate-calls")" = "validate --root $REPO_ROOT $REPO_ROOT/okf/modules/example.md --format json --skip-provenance" ]
		[ "$(sed -n 2p "$STUB_DIR/validate-calls")" = "validate $REPO_ROOT --format json --skip-provenance" ]
		[ "$(wc -l <"$STUB_DIR/validate-calls" | tr -d ' ')" = "2" ]
	done
}

@test "retries once, then warns, when both validate forms exit 64" {
	_stub_old_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '' 64
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-calls"
		_run "$target" "$(render posttooluse.write-clean.json)"
		assert_hook_json '.decision // "none"' none
		[[ "$(context_text)" == *"okfit validate could not run for modules/example.md"* ]]
		[ "$(wc -l <"$STUB_DIR/validate-calls" | tr -d ' ')" = "2" ]
	done
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
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"index.md","code":"frontmatter-unclosed","severity":"error","message":"m"}]}' 2
	for target in $TARGETS; do
		_run "$target" "$(render posttooluse.edit-index.json)"
		assert_stop "$target" "index.md:"
	done
	_run claude "$(render posttooluse.edit-index.json)"
	assert_hook_json '.reason | startswith("index.md:")' true
}

@test "classifies correctly when bundle_root equals project_root" {
	_stub_cli "$(_ctx "$REPO_ROOT" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"okf/modules/example.md","code":"frontmatter-unclosed","severity":"error","message":"m"}]}' 2
	_run claude "$(_input Write "$REPO_ROOT/okf/modules/example.md" "$REPO_ROOT")"
	assert_stop claude "frontmatter-unclosed"
}

@test "quotes a file path containing a space through every branch" {
	local spaced="$BATS_TEST_TMPDIR/fake proj"
	mkdir -p "$spaced/okf/modules"
	_stub_cli "$(_ctx "$spaced/okf" "$spaced")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example file.md","code":"frontmatter-unclosed","severity":"error","message":"m"}]}' 2
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

# okfit #486: the hook compares physical paths, so a symlinked project path
# form does not skip its checks. The symlink is created explicitly (BATS's
# own tmpdir may already sit under a symlinked /var).

# _linked_proj — a bundle_with project plus $BATS_TEST_TMPDIR/link -> proj;
# sets proj, link, phys (the physical project root).
_linked_proj() {
	proj=$(_bundle_with modules/core.md 'type: Module
title: Core')
	ln -s "$proj" "$BATS_TEST_TMPDIR/link"
	link="$BATS_TEST_TMPDIR/link"
	phys=$(cd "$proj" && pwd -P)
}

@test "checks a Write through a symlinked project directory (#486)" {
	local proj link phys
	_linked_proj
	_stub_cli "$(_ctx "$phys/okf" "$phys")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$link/okf/modules/core.md" "$proj")" "$proj"
		assert_stop "$target" "modules/core.md: generated.by is missing"
	done
}

@test "checks a Write when the context reports the symlinked form and the host the physical one (#486)" {
	local proj link phys
	_linked_proj
	_stub_cli "$(_ctx "$link/okf" "$link")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$phys/okf/modules/core.md" "$proj")" "$proj"
		assert_stop "$target" "modules/core.md: generated.by is missing"
	done
}

@test "passes the physical file path to okfit validate (#486)" {
	local proj link phys
	_linked_proj
	_stub_cli "$(_ctx "$phys/okf" "$phys")" "$CLEAN"
	_run claude "$(_input Write "$link/okf/modules/core.md" "$proj")" "$proj"
	[ -f "$STUB_DIR/validate-argv" ]
	grep -qxF "$phys/okf/modules/core.md" "$STUB_DIR/validate-argv"
}

@test "checks a Bash heredoc write through a symlinked project directory (#486)" {
	local proj link phys
	_linked_proj
	_stub_cli "$(_ctx "$phys/okf" "$phys")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_bash_input "cat > $link/okf/modules/core.md <<EOF
x
EOF" "$proj")" "$proj"
		assert_stop "$target" "modules/core.md: generated.by is missing"
	done
}

@test "a file outside the bundle through a symlink is still a no-op (#486)" {
	local proj link phys
	_linked_proj
	mkdir -p "$proj/docs"
	printf -- '---\ntype: Module\n---\n' >"$proj/docs/x.md"
	_stub_cli "$(_ctx "$phys/okf" "$phys")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$link/docs/x.md" "$proj")" "$proj"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

# okfit #483: CRLF line endings and a UTF-8 BOM must not hide a concept's
# frontmatter from the awk helpers. _crlf_proj writes the bytes with printf.

# _crlf_proj frontmatter_printf_format [bom] — a fake project whose
# okf/modules/core.md holds the CRLF frontmatter; echoes the project dir.
_crlf_proj() {
	local fm="$1" bom="${2:-}" proj="$BATS_TEST_TMPDIR/proj"
	mkdir -p "$proj/okf/modules"
	# shellcheck disable=SC2059
	printf -- "${bom}---\r\n${fm}---\r\n\r\n# Body\r\n" >"$proj/okf/modules/core.md"
	printf '%s' "$proj"
}

@test "blocks a Write of a CRLF concept with no generated.by, like its LF twin (#483)" {
	local proj
	proj=$(_crlf_proj 'type: Module\r\ntitle: Core\r\n')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/modules/core.md" "$proj")" "$proj"
		assert_stop "$target" "modules/core.md: generated.by is missing"
	done
}

@test "no-ops on a CRLF concept that carries generated.by (#483)" {
	local proj
	proj=$(_crlf_proj 'type: Module\r\ntitle: Core\r\ngenerated:\r\n  by: okfit/claude-code\r\n')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/modules/core.md" "$proj")" "$proj"
		assert_hook_noop
	done
}

@test "reads a concept that opens with a UTF-8 BOM as a concept (#483)" {
	local proj
	proj=$(_crlf_proj 'type: Module\r\ntitle: Core\r\n' '\xef\xbb\xbf')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/modules/core.md" "$proj")" "$proj"
		assert_stop "$target" "modules/core.md: generated.by is missing"
	done
}

@test "a Bash write of a CRLF typed concept never spawns validate (#483)" {
	local proj
	proj=$(_crlf_proj 'type: Module\r\ntitle: Core\r\n')
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(_bash_input "echo hi > okf/modules/core.md" "$proj")" "$proj"
		assert_stop "$target" "modules/core.md: generated.by is missing"
		[ ! -f "$STUB_DIR/validate-invoked" ]
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
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/core.md","code":"frontmatter-unclosed","severity":"error","message":"type is required"},{"source":"core.lint","file":"modules/core.md","code":"stale","severity":"warning","message":"m"}]}' 2
	_run claude "$(_input Edit "$proj/okf/modules/core.md" "$proj")" "$proj"
	assert_stop claude "frontmatter-unclosed"
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

# okfit #223: a Bash write to a bundle concept (heredoc, tee, cp, sed -i) gets
# the same generated.by check as a Write. Heuristic parsing of the command.

# _bash_input command cwd — a PostToolUse input for the Bash tool.
_bash_input() {
	hook_fixture PostToolUse "$(jq -nc --arg cmd "$1" --arg c "$2" '{tool_name: "Bash", tool_input: {command: $cmd}, cwd: $c}')"
}

# _bash_proj — a fake project with a stamped-less concept, an index, and
# a non-bundle markdown file; echoes the project dir.
_bash_proj() {
	local proj="$BATS_TEST_TMPDIR/proj"
	mkdir -p "$proj/okf/modules" "$proj/docs"
	printf -- '---\ntype: Module\ntitle: X\n---\n\n# X\n' >"$proj/okf/x.md"
	printf -- '---\ntype: Module\ntitle: A\n---\n\n# A\n' >"$proj/okf/a.md"
	printf -- '---\ntype: Module\ntitle: S\ngenerated:\n  by: okfit/claude-code\n---\n\n# S\n' >"$proj/okf/stamped.md"
	printf -- '---\nokf_version: "0.2"\n---\n' >"$proj/okf/index.md"
	printf -- '---\ntype: Module\n---\n' >"$proj/docs/readme.md"
	printf '%s' "$proj"
}

@test "blocks a Bash heredoc write of a concept with no generated.by (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_bash_input $'cat > okf/x.md <<EOF\n---\ntype: Module\n---\nEOF' "$proj")" "$proj"
		assert_stop "$target" "x.md: generated.by is missing"
		assert_stop "$target" "okfit/claude-code"
	done
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "no-ops on a Bash write of a concept that carries generated.by (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_bash_input "cat > okf/stamped.md <<EOF
x
EOF" "$proj")" "$proj"
		assert_hook_noop
	done
}

@test "blocks a Bash tee write, naming every offending file (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_bash_input "echo hi | tee okf/a.md $proj/okf/x.md" "$proj")" "$proj"
		assert_stop "$target" "a.md: generated.by is missing"
		assert_stop "$target" "x.md: generated.by is missing"
	done
}

@test "blocks Bash authoring writes: >, >|, tee, cp, install (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for cmd in "cp /tmp/src.md okf/x.md" "install -m 644 /tmp/src.md okf/x.md" "echo hi >|okf/x.md" "echo hi > okf/x.md" "echo hi | tee okf/x.md"; do
		_run claude "$(_bash_input "$cmd" "$proj")" "$proj"
		assert_stop claude "generated.by is missing"
	done
}

@test "only warns on Bash edit-like writes: >>, tee -a, sed -i, mv (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		for cmd in "mv /tmp/src.md okf/a.md" "sed -i 's/a/b/' okf/x.md" "perl -pi -e 's/a/b/' okf/x.md" "echo hi >>okf/x.md" "echo hi | tee -a okf/x.md" "echo hi | tee --append okf/x.md"; do
			_run "$target" "$(_bash_input "$cmd" "$proj")" "$proj"
			assert_hook_json '.decision // "none"' none
			[[ "$(context_text)" == *"generated.by is missing"*"okfit/claude-code"* ]]
		done
	done
}

@test "a Bash command with both kinds blocks and lists every offender (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_bash_input "echo a > okf/x.md && sed -i s/a/b/ okf/a.md" "$proj")" "$proj"
		assert_stop "$target" "x.md: generated.by is missing"
		assert_stop "$target" "a.md: generated.by is missing"
	done
}

@test "Bash reads that mention .md never spawn the CLI (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for cmd in "cat okf/a.md" "git log -- okf/x.md" "grep foo okf/*.md"; do
		_run claude "$(_bash_input "$cmd" "$proj")" "$proj"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/context-cwd" ]
}

@test "no-ops on a Bash write of index.md or log.md (#223)" {
	local proj
	proj=$(_bash_proj)
	printf '# Log\n' >"$proj/okf/log.md"
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	_run claude "$(_bash_input "cat > okf/index.md <<EOF
x
EOF" "$proj")" "$proj"
	assert_hook_noop
	_run claude "$(_bash_input "echo x >> okf/log.md" "$proj")" "$proj"
	assert_hook_noop
}

@test "no-ops on a Bash write outside the bundle (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	_run claude "$(_bash_input "cat > docs/readme.md <<EOF
x
EOF" "$proj")" "$proj"
	assert_hook_noop
}

@test "a Bash command that never mentions .md is a no-op and never invokes the CLI (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_bash_input "ls -la && git status" "$proj")" "$proj"
		assert_hook_noop
	done
	[ ! -f "$STUB_DIR/context-cwd" ]
}

@test "no-ops on a Bash write when actors.agent is unset (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$CLEAN"
	_run claude "$(_bash_input "cat > okf/x.md <<EOF
x
EOF" "$proj")" "$proj"
	assert_hook_noop
}

@test "the kill switches silence the Bash path too (#223)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	_run claude "$(_bash_input "echo x > okf/x.md" "$proj")" "$proj" OKFIT_HOOKS=off
	assert_hook_noop
	_run claude "$(_bash_input "echo x > okf/x.md" "$proj")" "$proj" OKFIT_VALIDATE_HOOK=off
	assert_hook_noop
	[ ! -f "$STUB_DIR/context-cwd" ]
}

# OKF v0.3 phase 4, Task 1 (characterization): a typeless .md written into the
# bundle passes the hook silently today. Task 8 teaches the hook to block it
# where the config or profile forbids it.

# _ctx_no_profile bundle_root project_root — a context for a bundle whose config sets nothing.
_ctx_no_profile() {
	printf '{"schema":1,"project_root":"%s","bundle_root":"%s","config_path":null,"profile":null,"index_path":"%s/index.md","index_exists":true,"actors":{"agent":null},"types":[],"tags":[]}' "$2" "$1" "$1"
}

# _typeless_proj — a project whose okf/ holds a root index and a typeless notes.md; echoes the project dir.
_typeless_proj() {
	local proj="$BATS_TEST_TMPDIR/typeless"
	mkdir -p "$proj/okf"
	printf -- '---\nokf_version: "0.3"\n---\n' >"$proj/okf/index.md"
	printf '# Notes\n' >"$proj/okf/notes.md"
	printf '%s' "$proj"
}

# _unlisted_json file globs — a validate envelope carrying the non-concept-unlisted lint.
_unlisted_json() {
	printf '{"schema":1,"exit_code":1,"diagnostics":[{"source":"core.lint","file":"%s","code":"non-concept-unlisted","severity":"warning","message":"%s is not a concept (no frontmatter) and matches no [bundle] non_concepts glob (%s); add frontmatter with a type, move it out of the bundle, or list it in non_concepts"}]}' "$1" "$1" "$2"
}

PROFILE_GLOBS='**/README.md, **/AGENTS.md, **/CONTRIBUTING.md, **/SKILL.md'
UNLISTED_REASON="notes.md: not a concept: it has no frontmatter type, and this bundle allows non-concept Markdown only where [bundle] non_concepts says ($PROFILE_GLOBS). Give it frontmatter with a type (okf-authoring), move it out of the bundle, or ask the human to add it to non_concepts."

@test "a Write of a typeless okf/notes.md is silent where the config sets nothing" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_profile "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(_input Write "$proj/okf/notes.md" "$proj")" "$proj"
		assert_hook_noop
		# control: the hook did run its validate for the file, so the silence is the hook's verdict
		[ -f "$STUB_DIR/validate-invoked" ]
	done
}

@test "a Write of a typeless okf/notes.md blocks under the software-project profile (R8)" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$(_unlisted_json notes.md "$PROFILE_GLOBS")" 1
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(_input Write "$proj/okf/notes.md" "$proj")" "$proj"
		assert_stop "$target" "$UNLISTED_REASON"
		[ -f "$STUB_DIR/validate-invoked" ]
	done
}

@test "a Write of an unlisted okf/notes.md falls back to 'allows it' when the glob list is empty (R8)" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$(_unlisted_json notes.md "")" 1
	local reason="notes.md: not a concept: it has no frontmatter type, and this bundle allows non-concept Markdown only where [bundle] non_concepts allows it. Give it frontmatter with a type (okf-authoring), move it out of the bundle, or ask the human to add it to non_concepts."
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/notes.md" "$proj")" "$proj"
		assert_stop "$target" "$reason"
		[[ "$reason" != *"says ()"* ]]
	done
}

@test "an Edit of a typeless okf/notes.md warns, never blocks (R8)" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$(_unlisted_json notes.md "$PROFILE_GLOBS")" 1
	for target in $TARGETS; do
		_run "$target" "$(_input Edit "$proj/okf/notes.md" "$proj")" "$proj"
		assert_hook_json '.decision // "none"' none
		[[ "$(context_text)" == *"$UNLISTED_REASON"* ]]
	done
}

@test "a Write of okf/README.md and of a typed concept stays clean under the profile (R8)" {
	local proj
	proj=$(_typeless_proj)
	printf '# Readme\n' >"$proj/okf/README.md"
	printf -- '---\ntype: Module\ntitle: T\n---\n' >"$proj/okf/typed.md"
	# the lint does not flag a listed or typed file, so the stub reports nothing for them
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(_input Write "$proj/okf/README.md" "$proj")" "$proj"
		assert_hook_noop
		[ -f "$STUB_DIR/validate-invoked" ]
		_run "$target" "$(_input Write "$proj/okf/typed.md" "$proj")" "$proj"
		assert_hook_noop
	done
}

@test "a lint hit for a different file does not block a Write (R8)" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$(_unlisted_json other.md "$PROFILE_GLOBS")" 1
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(_input Write "$proj/okf/notes.md" "$proj")" "$proj"
		assert_hook_noop
		[ -f "$STUB_DIR/validate-invoked" ]
	done
}

@test "a conformance block also carries the non-concept line (R8)" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"notes.md","code":"frontmatter-unclosed","severity":"error","message":"m"},{"source":"core.lint","file":"notes.md","code":"non-concept-unlisted","severity":"warning","message":"notes.md is not a concept (no frontmatter) and matches no [bundle] non_concepts glob (**/README.md); add frontmatter with a type, move it out of the bundle, or list it in non_concepts"}]}' 2
	_run claude "$(_input Write "$proj/okf/notes.md" "$proj")" "$proj"
	assert_hook_json '.reason | contains("frontmatter-unclosed") and contains("notes.md: not a concept: it has no frontmatter type")' true
}

@test "a Bash authoring write of a typeless okf/notes.md blocks through one scoped validate (R8)" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$(_unlisted_json notes.md "$PROFILE_GLOBS")" 1
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(_bash_input $'cat > okf/notes.md <<\'EOF\'\n# Notes\nEOF' "$proj")" "$proj"
		assert_stop "$target" "$UNLISTED_REASON"
		[ -f "$STUB_DIR/validate-invoked" ]
		# the file argument is the physical path (#486); --root is the context's
		[ "$(paste -sd' ' "$STUB_DIR/validate-argv")" = "validate --root $proj $(cd "$proj" && pwd -P)/okf/notes.md --format json --skip-provenance" ]
	done
}

@test "a Bash edit-like write of a typeless file never spawns validate (R8)" {
	local proj
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$(_unlisted_json notes.md "$PROFILE_GLOBS")" 1
	for target in $TARGETS; do
		rm -f "$STUB_DIR/validate-invoked"
		_run "$target" "$(_bash_input "printf 'more\n' >> okf/notes.md" "$proj")" "$proj"
		assert_hook_noop
		[ ! -f "$STUB_DIR/validate-invoked" ]
	done
	# control: the authoring form of the same command does spawn it
	_run claude "$(_bash_input "printf 'more\n' > okf/notes.md" "$proj")" "$proj"
	[ -f "$STUB_DIR/validate-invoked" ]
}

@test "a Bash authoring write of a typed concept never spawns validate (R8)" {
	local proj
	proj=$(_bash_proj)
	_stub_cli "$(_ctx_no_agent "$proj/okf" "$proj")" "$(_unlisted_json x.md "$PROFILE_GLOBS")" 1
	_run claude "$(_bash_input "echo hi > okf/x.md" "$proj")" "$proj"
	assert_hook_noop
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

# A listed non-concept is not a concept: with actors.agent set the hook never asks it for generated.by
# (final-review finding 2). Controls: a typed concept without generated.by still blocks.

@test "a Write of a listed README.md is clean when actors.agent is set, a typed concept without generated.by blocks" {
	local proj
	proj=$(_typeless_proj)
	mkdir -p "$proj/okf/a/b"
	printf '# Readme\n' >"$proj/okf/README.md"
	printf '# Nested\n' >"$proj/okf/a/b/README.md"
	printf -- '---\ntype: Module\ntitle: T\n---\n' >"$proj/okf/typed.md"
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/README.md" "$proj")" "$proj"
		assert_hook_noop
		_run "$target" "$(_input Write "$proj/okf/a/b/README.md" "$proj")" "$proj"
		assert_hook_noop
		# control: the same context blocks a typed concept that lacks generated.by
		_run "$target" "$(_input Write "$proj/okf/typed.md" "$proj")" "$proj"
		assert_stop "$target" "typed.md: generated.by is missing"
	done
}

@test "a Bash write of a listed README.md, or an append to a typeless file, gets no generated.by advice when actors.agent is set" {
	local proj
	proj=$(_typeless_proj)
	printf '# Readme\n' >"$proj/okf/README.md"
	printf -- '---\ntype: Module\ntitle: T\n---\n' >"$proj/okf/typed.md"
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$CLEAN"
	for target in $TARGETS; do
		_run "$target" "$(_bash_input "cp /tmp/src.md okf/README.md" "$proj")" "$proj"
		assert_hook_noop
		_run "$target" "$(_bash_input "printf 'more\n' >> okf/notes.md" "$proj")" "$proj"
		assert_hook_noop
		# control: an appended write to a typed concept without generated.by is still told to stamp it
		_run "$target" "$(_bash_input "printf 'more\n' >> okf/typed.md" "$proj")" "$proj"
		[[ "$(context_text)" == *"generated.by is missing"* ]]
	done
}

@test "an unlisted typeless Write blocks with the non-concept reason only when actors.agent is set" {
	local proj text
	proj=$(_typeless_proj)
	_stub_cli "$(_ctx "$proj/okf" "$proj")" "$(_unlisted_json notes.md "$PROFILE_GLOBS")" 1
	for target in $TARGETS; do
		_run "$target" "$(_input Write "$proj/okf/notes.md" "$proj")" "$proj"
		assert_stop "$target" "$UNLISTED_REASON"
		if [ "$target" = claude ]; then text=$(printf '%s' "$output" | jq -r '.reason'); else text=$(context_text); fi
		[[ "$text" != *"generated.by"* ]]
	done
}
