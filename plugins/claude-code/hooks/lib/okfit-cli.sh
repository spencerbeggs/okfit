#!/bin/bash
# okfit-cli.sh — resolves the okfit CLI and the project directory for a hook
# to invoke (M-17). Each function prints the resolved value to stdout and
# returns 0; returns 1 with nothing printed when nothing resolved. Hooks
# never run npx: this file names exactly three resolution steps and none is
# package-manager detection, a deliberate divergence from vitest-agent's own
# hooks/lib/detect-pm.sh, whose detect_pm_exec returns prefixes like
# "pnpm exec" / "npx --no-install".

# Resolution order (M-17, exact): C-1.4 $OKFIT_CLI_CMD — a command string,
# word-split by the caller at the call site, never quoted as one token,
# which is the seam every BATS test in this plugin uses to stub the CLI;
# then <project_dir>/node_modules/.bin/okfit; then `okfit` on PATH. An
# OKFIT_CLI_CMD="" fails the -n test and falls through rather than
# "resolving" to an empty command. $1 = project_dir.
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

# Project-dir chain (M-17, exact): C-1.6 $CLAUDE_PROJECT_DIR, else the stdin
# envelope's own .cwd (passed in as $1, already jq-extracted by the caller —
# this file parses no JSON), else $PWD.
okfit_project_dir() {
	local envelope_cwd="${1:-}"
	if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
		printf '%s\n' "$CLAUDE_PROJECT_DIR"
		return 0
	fi
	if [ -n "$envelope_cwd" ]; then
		printf '%s\n' "$envelope_cwd"
		return 0
	fi
	printf '%s\n' "$PWD"
}
