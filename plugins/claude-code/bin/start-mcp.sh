#!/usr/bin/env sh
# start-mcp.sh — plugin MCP server loader (M-25).
#
# Detects the project's package manager only to choose the install-command
# line in the not-installed message below; the exec target is always
# either the project's own node_modules/.bin/okfit-mcp or npx, never a
# package-manager dispatch (Judge note A-14 — the deliberate divergence
# from vitest-agent/plugins/claude-code/bin/start-mcp.sh:27-32, which
# execs through pnpm/yarn/bun/npx). Zero jq dependency at runtime: the
# packageManager field is read with grep/sed. Detection order follows
# vitest-agent/plugins/claude-code/bin/start-mcp.mjs:44-67 (packageManager
# field first) and :34-40 (lockfile order: pnpm-lock.yaml, bun.lock,
# bun.lockb, yarn.lock, package-lock.json — interpretation B-5).
#
# Not wired into .claude-plugin/plugin.json's mcpServers in phase 1 (M-27):
# this file ships and is tested, but nothing invokes it yet.

set -eu

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# detect_pm — prints one of npm/pnpm/yarn/bun on stdout. Package.json's
# packageManager field wins outright over any lockfile (even a co-present
# one); otherwise the first lockfile present in source order wins; npm is
# the default.
detect_pm() {
	pm=""
	if [ -f "$ROOT/package.json" ]; then
		pm=$(grep -o '"packageManager"[[:space:]]*:[[:space:]]*"[^"]*"' "$ROOT/package.json" 2>/dev/null \
			| sed -E 's/.*:[[:space:]]*"([a-z]+)@.*/\1/')
	fi
	case "$pm" in
		npm | pnpm | yarn | bun)
			printf '%s\n' "$pm"
			return
			;;
	esac
	if [ -f "$ROOT/pnpm-lock.yaml" ]; then
		printf '%s\n' "pnpm"
	elif [ -f "$ROOT/bun.lock" ]; then
		printf '%s\n' "bun"
	elif [ -f "$ROOT/bun.lockb" ]; then
		printf '%s\n' "bun"
	elif [ -f "$ROOT/yarn.lock" ]; then
		printf '%s\n' "yarn"
	elif [ -f "$ROOT/package-lock.json" ]; then
		printf '%s\n' "npm"
	else
		printf '%s\n' "npm"
	fi
}

# install_line pm — prints the one install command line matching pm.
install_line() {
	case "$1" in
		pnpm) printf '  pnpm add -D @okfit/plugin\n' ;;
		yarn) printf '  yarn add -D @okfit/plugin\n' ;;
		bun) printf '  bun add -d @okfit/plugin\n' ;;
		*) printf '  npm install --save-dev @okfit/plugin\n' ;;
	esac
}

BIN="$ROOT/node_modules/.bin/okfit-mcp"
if [ -x "$BIN" ]; then
	exec "$BIN" "$@"
fi

PM="$(detect_pm)"
{
	printf 'okfit plugin: okfit-mcp is not installed in this project.\n'
	printf '\n'
	printf 'Detected package manager: %s\n' "$PM"
	printf 'Project directory: %s\n' "$ROOT"
	printf '\n'
	printf 'Install it with:\n'
	install_line "$PM"
	printf '\n'
	printf 'Falling back to `npx --yes @okfit/mcp`, which will download it.\n'
} >&2

exec npx --yes @okfit/mcp "$@"
