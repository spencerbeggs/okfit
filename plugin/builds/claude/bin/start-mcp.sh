#!/bin/sh
# start-mcp.sh — the okfit-mcp launcher, on the pluginfinity server library.
# stdout is the protocol wire: nothing here prints to it before the exec.
#
# Execs the project's node_modules/.bin/okfit-mcp when it is installed;
# otherwise server_exec_bin prints the @okfit/plugin install line for the project's
# package manager on stderr and falls back to `npx --yes @okfit/mcp`.
# OKFIT_PROJECT_DIR is exported only when the host reports a project:
# Copilot gives a server no project directory, and okfit-mcp then falls
# back to CLAUDE_PROJECT_DIR and its working directory.

set -eu
. "$PLUGINFINITY_LIB/server.sh"

if project_dir=$(server_project_dir); then
	export OKFIT_PROJECT_DIR="$project_dir"
fi

server_exec_bin okfit-mcp @okfit/mcp --install @okfit/plugin "$@"
