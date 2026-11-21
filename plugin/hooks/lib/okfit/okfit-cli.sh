#!/bin/bash
# okfit-cli.sh — resolves the okfit CLI for a hook to invoke (M-17). The
# project directory comes from the pluginfinity hook library's
# hook_project_dir; this file only resolves the CLI.
#
# Resolution order (M-17, exact): $OKFIT_CLI_CMD — a command string,
# word-split by the caller at the call site, never quoted as one token,
# which is the seam every BATS test in this plugin uses to stub the CLI;
# then <project_dir>/node_modules/.bin/okfit; then `okfit` on PATH. An
# OKFIT_CLI_CMD="" fails the -n test and falls through rather than
# "resolving" to an empty command. Prints the resolved command and returns
# 0, or prints nothing and returns 1. Hooks never run npx.
# $1 = project_dir.
okfit_cli() {
	local project_dir="$1"
	if [ -n "${OKFIT_CLI_CMD:-}" ]; then
		printf '%s\n' "$OKFIT_CLI_CMD"
		return 0
	fi
	if [ -x "$project_dir/node_modules/.bin/okfit" ]; then
		printf '%s\n' "$project_dir/node_modules/.bin/okfit"
		return 0
	fi
	if command -v okfit >/dev/null 2>&1; then
		printf '%s\n' "okfit"
		return 0
	fi
	return 1
}

# okfit_version_lt a b — returns 0 when version a is strictly older than b,
# comparing major.minor.patch numerically (a prerelease or build suffix is
# ignored). Returns 1 when a >= b or either is not a version, so an
# unparseable value never warns. Bash 3.2 compatible.
okfit_version_lt() {
	local a="${1%%[-+]*}" b="${2%%[-+]*}" i x y
	local IFS=.
	local -a pa pb
	read -r -a pa <<<"$a"
	read -r -a pb <<<"$b"
	[ "${#pa[@]}" -eq 3 ] && [ "${#pb[@]}" -eq 3 ] || return 1
	for i in 0 1 2; do
		x="${pa[$i]}"
		y="${pb[$i]}"
		case "$x$y" in *[!0-9]* | "") return 1 ;; esac
		[ "$((10#$x))" -lt "$((10#$y))" ] && return 0
		[ "$((10#$x))" -gt "$((10#$y))" ] && return 1
	done
	return 1
}

# okfit_plugin_version — the plugin's own version from its built manifest
# (Claude: .claude-plugin/plugin.json; Copilot: plugin.json). Prints nothing
# when neither is readable.
okfit_plugin_version() {
	local root manifest
	root=$(hook_plugin_root) || return 0
	for manifest in "$root/.claude-plugin/plugin.json" "$root/plugin.json"; do
		if [ -r "$manifest" ]; then
			jq -r '.version // empty' "$manifest" 2>/dev/null || true
			return 0
		fi
	done
}
