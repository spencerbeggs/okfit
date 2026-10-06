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
