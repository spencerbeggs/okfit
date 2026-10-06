#!/usr/bin/env bats
# launchers.bats — covers bin/start-mcp.sh and bin/start-lsp.sh as built for
# each host, on the pluginfinity server library. Each run is `sh <launcher>`
# under env -i from inside a fake project, with only what the host provides:
# PATH, HOME, the PLUGINFINITY_* keys the build puts in every server's env,
# and CLAUDE_PROJECT_DIR on Claude Code. Package-manager detection itself is
# the library's and is tested upstream; these tests pin okfit's wiring.

bats_require_minimum_version 1.5.0

BUILDS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/builds"
KINDS="mcp lsp"

setup() {
	FAKE_BIN="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$BATS_TEST_TMPDIR/proj/.git" "$FAKE_BIN"
	# Physical: under env -i, sh derives $PWD without the /var symlink.
	PROJECT_DIR="$(cd "$BATS_TEST_TMPDIR/proj" && pwd -P)"
}

# _fake_npx [exit_code] — an npx on PATH that records its argv.
_fake_npx() {
	cat >"$FAKE_BIN/npx" <<STUB
#!/bin/sh
printf 'npx %s\n' "\$*" >"$FAKE_BIN/npx.invoked"
exit ${1:-0}
STUB
	chmod +x "$FAKE_BIN/npx"
}

# _local_bin kind [exit_code] — node_modules/.bin/okfit-<kind> that echoes
# its args and OKFIT_PROJECT_DIR on stdout.
_local_bin() {
	mkdir -p "$PROJECT_DIR/node_modules/.bin"
	cat >"$PROJECT_DIR/node_modules/.bin/okfit-$1" <<STUB
#!/bin/sh
printf 'okfit-$1 %s\n' "\$*"
printf 'project=%s\n' "\${OKFIT_PROJECT_DIR:-}"
exit ${2:-0}
STUB
	chmod +x "$PROJECT_DIR/node_modules/.bin/okfit-$1"
}

# _launch host kind [args...] — run the built launcher from the project.
_launch() {
	local host="$1" kind="$2"
	shift 2
	local claude_dir=""
	[ "$host" = claude ] && claude_dir="$PROJECT_DIR"
	cd "$PROJECT_DIR"
	run --separate-stderr env -i PATH="$FAKE_BIN:/usr/bin:/bin" HOME="$BATS_TEST_TMPDIR/home" \
		PLUGINFINITY_HOST="$host" PLUGINFINITY_PLUGIN=okfit PLUGINFINITY_LIB="$BUILDS/$host/lib/pluginfinity" \
		CLAUDE_PROJECT_DIR="$claude_dir" sh "$BUILDS/$host/bin/start-$kind.sh" "$@"
}

@test "both hosts' builds ship both launchers and the server library" {
	for host in claude copilot; do
		for kind in $KINDS; do
			[ -f "$BUILDS/$host/bin/start-$kind.sh" ]
		done
		[ -f "$BUILDS/$host/lib/pluginfinity/server.sh" ]
	done
}

@test "execs node_modules/.bin/okfit-<kind> with its args and nothing else on stdout" {
	for host in claude copilot; do
		for kind in $KINDS; do
			_local_bin "$kind"
			_launch "$host" "$kind" --stdio
			[ "$status" -eq 0 ]
			[ "$output" = "okfit-$kind --stdio
project=$PROJECT_DIR" ]
		done
	done
}

@test "prints the @okfit/plugin install line on stderr and falls back to npx --yes @okfit/<kind>" {
	_fake_npx
	printf '{"packageManager":"pnpm@9.0.0"}' >"$PROJECT_DIR/package.json"
	for host in claude copilot; do
		for kind in $KINDS; do
			rm -f "$FAKE_BIN/npx.invoked"
			_launch "$host" "$kind" --stdio
			[ "$status" -eq 0 ]
			[ -z "$output" ]
			[[ "$stderr" == *"okfit-$kind is not installed"* ]]
			[[ "$stderr" == *"pnpm add -D @okfit/plugin"* ]]
			[ "$(cat "$FAKE_BIN/npx.invoked")" = "npx --yes @okfit/$kind --stdio" ]
		done
	done
}

@test "defaults the install line to npm with no field and no lockfile" {
	_fake_npx
	_launch claude mcp
	[[ "$stderr" == *"npm install --save-dev @okfit/plugin"* ]]
}

@test "propagates the execed process's exit code unchanged" {
	_fake_npx 7
	for host in claude copilot; do
		for kind in $KINDS; do
			_launch "$host" "$kind"
			[ "$status" -eq 7 ]
		done
	done
}

@test "a Copilot MCP server started from the plugin root has no project and goes straight to npx" {
	_fake_npx
	cd "$BUILDS/copilot"
	run --separate-stderr env -i PATH="$FAKE_BIN:/usr/bin:/bin" HOME="$BATS_TEST_TMPDIR/home" \
		PLUGINFINITY_HOST=copilot PLUGINFINITY_PLUGIN=okfit PLUGINFINITY_LIB="$BUILDS/copilot/lib/pluginfinity" \
		sh "$BUILDS/copilot/bin/start-mcp.sh"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
	[[ "$stderr" == *"no project directory is known"* ]]
	[ "$(cat "$FAKE_BIN/npx.invoked")" = "npx --yes @okfit/mcp" ]
}

@test "fails loudly when run outside a host (no PLUGINFINITY_LIB)" {
	cd "$PROJECT_DIR"
	run env -i PATH=/usr/bin:/bin sh "$BUILDS/claude/bin/start-mcp.sh"
	[ "$status" -ne 0 ]
}
