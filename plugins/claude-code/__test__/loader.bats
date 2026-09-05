#!/usr/bin/env bats
# loader.bats — covers bin/start-mcp.sh (M-25, M-26). No sibling-repo
# analogue: unlike vitest-agent's own loader, this one never dispatches
# through a package-manager binary — it execs node_modules/.bin/okfit-mcp
# directly or falls back to npx (Judge note A-14) — so detection is proven
# through the printed install message and the npx invocation alone, never
# through a pnpm/yarn/bun exec.
#
# Invoked via `sh "$LOADER"`, never through its own shebang: this repo's
# pre-commit hook strips the executable bit from .sh files (the same fact
# __test__/lib/render-fixture.sh's own header records), and invoking
# through `sh` rather than `bash` additionally proves the script is really
# POSIX sh, not merely bash-compatible.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
LOADER="$PLUGIN_ROOT/bin/start-mcp.sh"

setup() {
	PROJECT_DIR="$(mktemp -d)"
	FAKE_BIN="$(mktemp -d)"
	PATH="$FAKE_BIN:$PATH"
	export PATH PROJECT_DIR FAKE_BIN
	export CLAUDE_PROJECT_DIR="$PROJECT_DIR"
}

teardown() {
	rm -rf "$PROJECT_DIR" "$FAKE_BIN"
	unset CLAUDE_PROJECT_DIR PROJECT_DIR FAKE_BIN
}

# _fake_bin name [exit_code] — writes an executable to FAKE_BIN/<name> that
# records its own name and args to FAKE_BIN/<name>.invoked and exits
# exit_code (default 0).
_fake_bin() {
	name="$1"
	code="${2:-0}"
	cat >"$FAKE_BIN/$name" <<EOF
#!/bin/sh
printf '%s %s\n' "$name" "\$*" >"$FAKE_BIN/$name.invoked"
exit $code
EOF
	chmod +x "$FAKE_BIN/$name"
}

# _local_bin [exit_code] — writes an executable
# PROJECT_DIR/node_modules/.bin/okfit-mcp that records its invocation to
# PROJECT_DIR/okfit-mcp.invoked and exits exit_code (default 0).
_local_bin() {
	code="${1:-0}"
	mkdir -p "$PROJECT_DIR/node_modules/.bin"
	cat >"$PROJECT_DIR/node_modules/.bin/okfit-mcp" <<EOF
#!/bin/sh
printf 'okfit-mcp %s\n' "\$*" >"$PROJECT_DIR/okfit-mcp.invoked"
exit $code
EOF
	chmod +x "$PROJECT_DIR/node_modules/.bin/okfit-mcp"
}

@test "packageManager in package.json wins over a co-present lockfile" {
	_fake_bin npx
	printf '{"packageManager":"pnpm@9.0.0"}' >"$PROJECT_DIR/package.json"
	touch "$PROJECT_DIR/yarn.lock"
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: pnpm"* ]]
}

@test "detects pnpm from pnpm-lock.yaml" {
	_fake_bin npx
	touch "$PROJECT_DIR/pnpm-lock.yaml"
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: pnpm"* ]]
}

@test "detects bun from bun.lock" {
	_fake_bin npx
	touch "$PROJECT_DIR/bun.lock"
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: bun"* ]]
}

@test "detects bun from bun.lockb" {
	_fake_bin npx
	touch "$PROJECT_DIR/bun.lockb"
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: bun"* ]]
}

@test "detects yarn from yarn.lock" {
	_fake_bin npx
	touch "$PROJECT_DIR/yarn.lock"
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: yarn"* ]]
}

@test "detects npm from package-lock.json" {
	_fake_bin npx
	touch "$PROJECT_DIR/package-lock.json"
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: npm"* ]]
}

@test "bun.lock wins over a co-present yarn.lock" {
	_fake_bin npx
	touch "$PROJECT_DIR/bun.lock" "$PROJECT_DIR/yarn.lock"
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: bun"* ]]
}

@test "defaults to npm with no field and no lockfile" {
	_fake_bin npx
	run sh "$LOADER"
	[[ "$output" == *"Detected package manager: npm"* ]]
	[[ "$output" == *"npm install --save-dev @okfit/plugin"* ]]
}

@test "execs node_modules/.bin/okfit-mcp directly, with no package manager at all" {
	_local_bin
	_fake_bin pnpm
	run sh "$LOADER"
	[ -f "$PROJECT_DIR/okfit-mcp.invoked" ]
	[ ! -f "$FAKE_BIN/pnpm.invoked" ]
	[[ "$output" != *"Detected package manager"* ]]
}

@test "prints the pnpm install line and execs npx when okfit-mcp is absent" {
	_fake_bin npx
	printf '{"packageManager":"pnpm@9.0.0"}' >"$PROJECT_DIR/package.json"
	run sh "$LOADER"
	[[ "$output" == *"pnpm add -D @okfit/plugin"* ]]
	[ -f "$FAKE_BIN/npx.invoked" ]
	grep -q '@okfit/mcp' "$FAKE_BIN/npx.invoked"
}

@test "prints the npm install line and execs npx when okfit-mcp is absent" {
	_fake_bin npx
	run sh "$LOADER"
	[[ "$output" == *"npm install --save-dev @okfit/plugin"* ]]
	[ -f "$FAKE_BIN/npx.invoked" ]
	grep -q '@okfit/mcp' "$FAKE_BIN/npx.invoked"
}

@test "propagates the execed process's exit code unchanged" {
	_fake_bin npx 7
	run sh "$LOADER"
	[ "$status" -eq 7 ]
}
