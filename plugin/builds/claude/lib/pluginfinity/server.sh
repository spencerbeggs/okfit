# shellcheck shell=sh
# pluginfinity server library. `pluginfinity build` writes this file into every
# target that has a local MCP or LSP server; do not edit a copy under builds/,
# the next build overwrites it.
#
# Source it first in a launcher, and keep `set -u` (or write
# ${PLUGINFINITY_LIB:?run by the host}) so a launcher run outside the host fails loudly:
#   . "$PLUGINFINITY_LIB/server.sh"
#
# POSIX sh. Writes nothing to stdout, which carries the server's protocol.

_pf_server_lib_dir=$(cd "$(dirname "$PLUGINFINITY_LIB/server.sh")" && pwd -P)

# claude or copilot.
server_host() { printf '%s\n' "${PLUGINFINITY_HOST:-unknown}"; }

# The build root the launcher runs from.
server_plugin_root() { (cd "$_pf_server_lib_dir/../.." && pwd -P); }

# Append a line to the plugin's server error log.
server_log() {
	_pf_dir="${XDG_STATE_HOME:-${HOME:-/nonexistent}/.local/state}/pluginfinity/${PLUGINFINITY_PLUGIN:-unknown}"
	mkdir -p "$_pf_dir" 2>/dev/null || return 0
	printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(server_host)" "$*" >>"$_pf_dir/server-error.log" 2>/dev/null || return 0
}

# The project the session works in. Prints it and returns 0, or prints nothing
# and returns 1 when there is none to report:
#   - Claude with CLAUDE_PROJECT_DIR set: that directory.
#   - Otherwise, when the working directory is the plugin root or inside it:
#     nothing, status 1. Copilot starts an MCP server with its cwd at the plugin
#     root and gives it no project directory, so that cwd says nothing about the
#     project. On Copilot, MCP servers get no project directory; a server should
#     ask its MCP client for roots.
#   - Otherwise: the closest directory above $PWD holding .git, else $PWD
#     (Copilot starts LSP servers at the git root).
server_project_dir() {
	if [ "${PLUGINFINITY_HOST:-}" = claude ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
		printf '%s\n' "$CLAUDE_PROJECT_DIR"
		return 0
	fi
	_pf_root=$(server_plugin_root)
	_pf_cwd=$(pwd -P)
	case "$_pf_cwd" in
	"$_pf_root" | "$_pf_root"/*) return 1 ;;
	esac
	_pf_probe=$PWD
	while [ -n "$_pf_probe" ] && [ "$_pf_probe" != / ]; do
		if [ -e "$_pf_probe/.git" ]; then
			printf '%s\n' "$_pf_probe"
			return 0
		fi
		_pf_probe=$(dirname "$_pf_probe")
	done
	printf '%s\n' "$PWD"
}

# npm, pnpm, yarn or bun: package.json's packageManager first, then lockfiles.
_pf_detect_pm() { # project
	_pf_pm=""
	if [ -f "$1/package.json" ]; then
		_pf_pm=$(grep -o '"packageManager"[[:space:]]*:[[:space:]]*"[^"]*"' "$1/package.json" 2>/dev/null |
			sed -E 's/.*:[[:space:]]*"([a-z]+)@.*/\1/')
	fi
	case "$_pf_pm" in npm | pnpm | yarn | bun)
		printf '%s\n' "$_pf_pm"
		return 0
		;;
	esac
	if [ -f "$1/pnpm-lock.yaml" ]; then
		printf 'pnpm\n'
	elif [ -f "$1/bun.lock" ] || [ -f "$1/bun.lockb" ]; then
		printf 'bun\n'
	elif [ -f "$1/yarn.lock" ]; then
		printf 'yarn\n'
	else
		printf 'npm\n'
	fi
}

_pf_install_line() { # pm package
	case "$1" in
	pnpm) printf '  pnpm add -D %s\n' "$2" ;;
	yarn) printf '  yarn add -D %s\n' "$2" ;;
	bun) printf '  bun add -d %s\n' "$2" ;;
	*) printf '  npm install --save-dev %s\n' "$2" ;;
	esac
}

# Exec the project's node_modules/.bin/<bin>, else npx --yes <package>. With no
# project directory (see server_project_dir) it skips the lookup and the
# install hint, and goes straight to npx. An optional `--install <package>`
# straight after the two positionals names a different package in the install
# hint only; npx still runs <package>. Later args pass through untouched.
server_exec_bin() { # bin package [--install install-package] [args...]
	_pf_bin=$1
	_pf_pkg=$2
	_pf_install=$2
	shift 2
	if [ "${1:-}" = --install ] && [ $# -ge 2 ]; then
		_pf_install=$2
		shift 2
	fi
	if _pf_project=$(server_project_dir); then
		if [ -x "$_pf_project/node_modules/.bin/$_pf_bin" ]; then
			exec "$_pf_project/node_modules/.bin/$_pf_bin" "$@"
		fi
		_pf_pm=$(_pf_detect_pm "$_pf_project")
		{
			printf '%s: %s is not installed in %s.\n' "${PLUGINFINITY_PLUGIN:-plugin}" "$_pf_bin" "$_pf_project"
			printf 'Install it with:\n'
			_pf_install_line "$_pf_pm" "$_pf_install"
		} >&2
	else
		printf '%s: no project directory is known, so %s cannot be looked up in node_modules.\n' \
			"${PLUGINFINITY_PLUGIN:-plugin}" "$_pf_bin" >&2
	fi
	printf 'Falling back to "npx --yes %s".\n' "$_pf_pkg" >&2
	exec npx --yes "$_pf_pkg" "$@"
}
