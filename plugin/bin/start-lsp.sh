#!/bin/sh
# start-lsp.sh — the okfit-lsp launcher, on the pluginfinity server library.
# stdout is the protocol wire: nothing here prints to it before the exec.
#
# Execs the project's node_modules/.bin/okfit-lsp when it is installed;
# otherwise server_exec_bin prints the @okfit/plugin install line for the project's
# package manager on stderr and falls back to `npx --yes @okfit/lsp`.
# OKFIT_PROJECT_DIR is exported only when the host reports a project:
# Copilot gives a server no project directory, and okfit-lsp then falls
# back to CLAUDE_PROJECT_DIR and its working directory.

set -eu
. "$PLUGINFINITY_LIB/server.sh"

if project_dir=$(server_project_dir); then
	export OKFIT_PROJECT_DIR="$project_dir"
fi

server_exec_bin okfit-lsp @okfit/lsp --install @okfit/plugin "$@"
