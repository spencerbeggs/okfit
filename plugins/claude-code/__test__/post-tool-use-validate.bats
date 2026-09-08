#!/usr/bin/env bats
# post-tool-use-validate.bats — covers hooks/post-tool-use/validate.sh against every
# branch of contract section 6.2.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/hooks/post-tool-use/validate.sh"
FIXTURES="$PLUGIN_ROOT/hooks/fixtures"
RENDER="$PLUGIN_ROOT/__test__/lib/render-fixture.sh"
REPO_ROOT="$(cd "$PLUGIN_ROOT/../.." && pwd)"

setup() {
	STUB_DIR="$(mktemp -d)"
}

teardown() {
	rm -rf "$STUB_DIR"
	unset OKFIT_HOOKS OKFIT_VALIDATE_HOOK OKFIT_CLI_CMD
}

# _barebin dir — symlinks to every external tool validate.sh needs, minus
# okfit — the "no CLI resolves" seam.
_barebin() {
	local dir="$1"
	local tool
	# node is needed only so the OKFIT_BIN smoke test's symlinked okfit.js
	# (a #!/usr/bin/env node script) can actually run; harmless for every
	# other test that uses this helper and never spawns a real okfit.
	for tool in bash jq cat node; do
		ln -sf "$(command -v "$tool")" "$dir/$tool"
	done
}

# _stub_cli context_json validate_json [validate_exit] — branches on $1
# (context vs validate). Writes a sentinel file on the validate branch so a
# test can assert the expensive call never happened (contract section 9.3),
# and records "$2" (the argument validate.sh passed) to
# $STUB_DIR/validate-arg so a test can assert it is the PROJECT root, never
# the bundle root (Important 3, final review — K-2).
_stub_cli() {
	local ctx_json="$1" val_json="$2" val_rc="${3:-0}"
	cat >"$STUB_DIR/okfit" <<EOF
#!/bin/bash
case "\$1" in
	context)
		printf '%s\n' '${ctx_json}'
		exit 0
		;;
	validate)
		touch "${STUB_DIR}/validate-invoked"
		printf '%s\n' "\$2" >"${STUB_DIR}/validate-arg"
		printf '%s\n' '${val_json}'
		exit ${val_rc}
		;;
esac
EOF
	chmod +x "$STUB_DIR/okfit"
	export OKFIT_CLI_CMD="$STUB_DIR/okfit"
}

_ctx() {
	# _ctx bundle_root project_root
	printf '{"schema":1,"project_root":"%s","bundle_root":"%s","config_path":null,"profile":"software-project","index_path":"%s/index.md","index_exists":true,"actors":{"agent":"okfit/claude-code"},"types":[],"tags":[]}' "$2" "$1" "$1"
}

# _run_hook envelope_json [path_override] [project_dir] [cwd_dir] — env -i
# plus only what a real dispatch provides. stderr goes to $STUB_DIR/stderr,
# never merged into $output (see session-start-orientation.bats for why).
# cwd_dir defaults to the caller's own $PWD (i.e. no change from before this
# parameter existed) — pass it explicitly to run the hook from inside an
# isolated project directory so a fallback PWD resolution cannot reach the
# real repo either.
_run_hook() {
	local envelope="$1"
	local path_override="${2:-$PATH}"
	local project_dir="${3:-$REPO_ROOT}"
	local cwd_dir="${4:-$PWD}"
	# $5 is HOME, defaulting to the caller's own $HOME (unchanged from before
	# this parameter existed). The OKFIT_BIN smoke test passes a fresh, empty
	# HOME explicitly: the real okfit CLI's own config discovery needs HOME
	# set at all (an unset HOME is itself an infrastructure failure, README.md
	# "Exit codes"), which every other test here never exercises since its
	# stub never actually reads HOME.
	local home_dir="${5:-$HOME}"
	(
		cd "$cwd_dir" || exit 1
		env -i \
			PATH="$path_override" \
			HOME="$home_dir" \
			CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
			CLAUDE_PROJECT_DIR="$project_dir" \
			OKFIT_CLI_CMD="${OKFIT_CLI_CMD:-}" \
			OKFIT_HOOKS="${OKFIT_HOOKS:-}" \
			OKFIT_VALIDATE_HOOK="${OKFIT_VALIDATE_HOOK:-}" \
			bash "$SCRIPT" <<<"$envelope" 2>"$STUB_DIR/stderr"
	)
}

_run_hook_file() {
	local envelope_file="$1"
	bash "$RENDER" "$envelope_file" | env -i \
		PATH="$PATH" \
		CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
		CLAUDE_PROJECT_DIR="$REPO_ROOT" \
		OKFIT_CLI_CMD="${OKFIT_CLI_CMD:-}" \
		OKFIT_HOOKS="${OKFIT_HOOKS:-}" \
		OKFIT_VALIDATE_HOOK="${OKFIT_VALIDATE_HOOK:-}" \
		bash "$SCRIPT" 2>"$STUB_DIR/stderr"
}

@test "no-ops with OKFIT_HOOKS=off and never invokes the stub" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":0,"diagnostics":[]}'
	export OKFIT_HOOKS=off
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "no-ops with OKFIT_VALIDATE_HOOK=off and never invokes the stub" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":0,"diagnostics":[]}'
	export OKFIT_VALIDATE_HOOK=off
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "allows silently with one stderr line when jq is missing" {
	local barebin
	barebin="$(mktemp -d)"
	ln -sf "$(command -v bash)" "$barebin/bash"
	ln -sf "$(command -v cat)" "$barebin/cat"
	run _run_hook '{}' "$barebin"
	rm -rf "$barebin"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ "$(cat "$STUB_DIR/stderr")" = "okfit: jq not found; validate hook allowing silently." ]
}

@test "allows silently with one stderr line when okfit_cli resolves nothing" {
	# Hermetic project dir with no node_modules — the real repo's checked-out
	# node_modules/.bin/okfit (a root devDependency, always present after
	# `pnpm install`) must never be reachable from this test. CLAUDE_PROJECT_DIR,
	# the envelope's own .cwd, and the subshell's PWD are all pointed at this
	# same isolated directory so none of okfit_project_dir's three resolution
	# steps can fall through to the real repo.
	local barebin
	barebin="$(mktemp -d)"
	_barebin "$barebin"
	local project_dir
	project_dir="$(mktemp -d)"
	mkdir -p "$project_dir/okf"
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"'"$project_dir"'/okf/x.md"},"cwd":"'"$project_dir"'"}' "$barebin" "$project_dir" "$project_dir"
	rm -rf "$barebin" "$project_dir"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ "$(cat "$STUB_DIR/stderr")" = "okfit: CLI not found; validate hook allowing silently." ]
}

@test "ignores a tool_name that is not Write or Edit" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":0,"diagnostics":[]}'
	run _run_hook_file "$FIXTURES/posttooluse.read-ignored.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "ignores an empty tool_input.file_path" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":0,"diagnostics":[]}'
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":""},"cwd":"'"$REPO_ROOT"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
}

@test "no-ops outside the bundle root without invoking the validate stub" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"unrelated.ts","code":"x","severity":"error","message":"m"}]}' 2
	run _run_hook_file "$FIXTURES/posttooluse.write-outside.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ ! -f "$STUB_DIR/validate-invoked" ]
}

@test "treats a JsonErrorEnvelope (exit_code 3) as a warning, never a block" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"okfit_version":"0.1.0","exit_code":3,"error":{"tag":"ConfigMalformedError","message":"bad toml"}}' 3
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '(.decision // "none") != "block"'
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext
		| contains("okfit validate could not run for modules/example.md: bad toml.")'
}

@test "blocks on a core.conformance diagnostic for the edited file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example.md","code":"type-missing","severity":"error","message":"type is required"}]}' 2
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.decision == "block"'
	echo "$output" | jq -e '.reason | contains("type-missing") and contains("type is required")'
}

@test "does not block on a core.conformance diagnostic for a DIFFERENT file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/other.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
}

@test "warns without blocking on a core.lint diagnostic for the edited file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":1,"diagnostics":[{"source":"core.lint","file":"modules/example.md","code":"broken-links","severity":"warning","message":"dangling link"}]}' 1
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '(.decision // "none") != "block"'
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext
		| contains("modules/example.md: 1 lint warning(s):") and contains("broken-links")'
}

@test "warns without blocking on a profile diagnostic for the edited file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":1,"diagnostics":[{"source":"profile","file":"modules/example.md","code":"project-missing","severity":"error","message":"missing Project"}]}' 1
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '(.decision // "none") != "block"'
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext | contains("project-missing")'
}

@test "surfaces an info-severity generated-at-drift diagnostic as context, not a block" {
	_stub_cli "$(_ctx "$REPO_ROOT" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":0,"diagnostics":[{"source":"core.lint","file":"okf/modules/example.md","code":"generated-at-drift","severity":"info","message":"generated.at is missing; the last body change was 2026-09-07T20:49:08Z (fc63da0)"}]}' 0
	run _run_hook_file "$FIXTURES/posttooluse.edit-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext | contains("generated-at-drift") and contains("modules/example.md")'
}

@test "ignores a bundle-level diagnostic whose file is the empty string" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":1,"diagnostics":[{"source":"core.lint","file":"","code":"missing-index","severity":"warning","message":"no index"}]}' 1
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
}

@test "no-ops when the stub reports zero diagnostics" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":0,"diagnostics":[]}'
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ -f "$STUB_DIR/validate-invoked" ]
}

@test "Edit of a clean file emits noop (Minor 5, session-independent)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":0,"diagnostics":[]}'
	run _run_hook_file "$FIXTURES/posttooluse.edit-clean.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'
	[ -f "$STUB_DIR/validate-invoked" ]
}

@test "passes the PROJECT root, never the bundle root, to okfit validate (Important 3)" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" '{"schema":1,"exit_code":0,"diagnostics":[]}'
	run _run_hook_file "$FIXTURES/posttooluse.write-clean.json"
	[ "$status" -eq 0 ]
	[ "$(cat "$STUB_DIR/validate-arg")" = "$REPO_ROOT" ]
}

@test "blocks on an Edit of index.md exactly like any other concept file" {
	_stub_cli "$(_ctx "$REPO_ROOT/okf" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"index.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	run _run_hook_file "$FIXTURES/posttooluse.edit-index.json"
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.decision == "block"'
	echo "$output" | jq -e '.reason | startswith("index.md:")'
}

@test "classifies correctly when bundle_root equals project_root" {
	_stub_cli "$(_ctx "$REPO_ROOT" "$REPO_ROOT")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"okf/modules/example.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"'"$REPO_ROOT"'/okf/modules/example.md"},"cwd":"'"$REPO_ROOT"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.decision == "block"'
}

@test "quotes a file path containing a space through every branch" {
	local spaced="$STUB_DIR/fake proj"
	mkdir -p "$spaced/okf/modules"
	_stub_cli "$(_ctx "$spaced/okf" "$spaced")" \
		'{"schema":1,"exit_code":2,"diagnostics":[{"source":"core.conformance","file":"modules/example file.md","code":"type-missing","severity":"error","message":"m"}]}' 2
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"'"$spaced"'/okf/modules/example file.md"},"cwd":"'"$spaced"'"}'
	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.decision == "block"'
	echo "$output" | jq -e '.reason | startswith("modules/example file.md:")'
}

@test "resolves node_modules/.bin/okfit with OKFIT_CLI_CMD unset (Important 2, real okfit binary)" {
	[ -n "${OKFIT_BIN:-}" ] && [ -x "${OKFIT_BIN:-}" ] || skip "OKFIT_BIN not set; skipping the production-resolution smoke test"
	local project_dir
	# Resolved to its physical path (pwd -P): on macOS, mktemp -d's own /var
	# result is itself a symlink to /private/var, and the real okfit CLI
	# canonicalises process.cwd() while validate.sh's own prefix check never
	# does (M-20 ruling — symlinked project directories deliberately stay
	# uncanonicalised in the hook). Using the physical path here keeps this
	# test out of that known, ruled-on gap rather than tripping it.
	project_dir="$(cd "$(mktemp -d)" && pwd -P)"
	mkdir -p "$project_dir/node_modules/.bin"
	# Important 2: a symlink to the physical path, not a copy — a copy of a
	# node ESM entry point loses the sibling dist/ tree it resolves relative
	# imports against, so a copied "okfit" fails to even start.
	ln -s "$(cd "$(dirname "$OKFIT_BIN")" && pwd -P)/$(basename "$OKFIT_BIN")" "$project_dir/node_modules/.bin/okfit"
	local barebin
	barebin="$(mktemp -d)"
	_barebin "$barebin"
	local home_dir
	home_dir="$(mktemp -d)"

	# Minor 5: the clean bundle fixture is the conformant baseline — the real
	# CLI validates it clean, so an edit inside it is a no-op.
	cp -R "$PLUGIN_ROOT/__test__/fixtures/bundles/clean/okf" "$project_dir/okf"
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"'"$project_dir"'/okf/modules/example.md"},"cwd":"'"$project_dir"'"}' "$barebin" "$project_dir" "$project_dir" "$home_dir"
	[ "$status" -eq 0 ]
	echo "$output" | jq -es 'length == 1'
	echo "$output" | jq -e '.continue == true and .suppressOutput == true'

	# Important 2: break one file with a deliberately non-conformant concept
	# (no `type` key) and confirm the real CLI's own core.conformance hit
	# blocks, naming the edited file in the reason.
	cat >"$project_dir/okf/modules/broken.md" <<'MD'
---
title: Broken Module
description: Deliberately missing its required type key.
---

# Broken Module
MD
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"'"$project_dir"'/okf/modules/broken.md"},"cwd":"'"$project_dir"'"}' "$barebin" "$project_dir" "$project_dir" "$home_dir"
	rm -rf "$project_dir" "$barebin" "$home_dir"
	[ "$status" -eq 0 ]
	echo "$output" | jq -es 'length == 1'
	echo "$output" | jq -e '.decision == "block"'
	echo "$output" | jq -e '.reason | contains("modules/broken.md")'
}
