# shellcheck shell=bash
# pluginfinity hook library. `pluginfinity build` writes this file into every
# target that has hooks; do not edit a copy under builds/, the next build
# overwrites it.
#
# Source it first in a hook script, relative to the script:
#   . "$(dirname "$0")/lib/pluginfinity/hook.sh"      # hooks/<name>.sh
#   . "$(dirname "$0")/../lib/pluginfinity/hook.sh"   # hooks/<event>/<name>.sh
#
# Bash 3.2 compatible. Writes nothing when sourced. Needs jq.
#
# Do not install your own `trap ... EXIT`: it replaces the library's
# fail-open / fail-closed trap, and a failing hook would then exit non-zero.

_pf_fail_closed=0
_pf_event=""
_pf_marker=""
_pf_kind_prefix=""

# --- logging --------------------------------------------------------------

_pf_write_log() { # kind message
	local dir="${XDG_STATE_HOME:-${HOME:-/nonexistent}/.local/state}/pluginfinity/${PLUGINFINITY_PLUGIN:-unknown}"
	mkdir -p "$dir" 2>/dev/null || return 0
	printf '%s [%s] %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${PLUGINFINITY_HOST:-unknown}" \
		"$(basename "$0")" "$2" >>"$dir/hook-$1.log" 2>/dev/null || return 0
}

# Append a line to the plugin's error log.
hook_log() { _pf_write_log error "$*"; }

# Append a line to the plugin's debug log when PLUGINFINITY_HOOK_DEBUG=1.
hook_debug() {
	[ "${PLUGINFINITY_HOOK_DEBUG:-0}" = 1 ] || return 0
	_pf_write_log debug "$*"
}

# Until the library is fully loaded a failure must still fail open: on Copilot
# a non-zero exit from a preToolUse hook denies the tool.
_pf_early_exit() {
	local code=$?
	[ "$code" -eq 0 ] || hook_log "exited $code while loading the hook library"
	_pf_cleanup
	exit 0
}
_pf_cleanup() {
	if [ -n "$_pf_marker" ]; then rm -f "$_pf_marker" 2>/dev/null || true; fi
	return 0
}
trap _pf_early_exit EXIT

_pf_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 0
# shellcheck source=/dev/null
. "$_pf_lib_dir/host.sh" 2>/dev/null || {
	hook_log "host.sh not loadable; hook skipped"
	exit 0
}

# --- input ----------------------------------------------------------------

# Read the event once. A terminal on stdin (a hand run) reads as {}.
if [ -t 0 ]; then
	_pf_input='{}'
else
	_pf_input=$(cat) || _pf_input='{}'
fi
[ -n "$_pf_input" ] || _pf_input='{}'

if ! command -v jq >/dev/null 2>&1; then
	hook_log "jq not found; hook skipped"
	exit 0
fi

# One marker file records that a response went out, and holds its kind for the
# debug log. It is a file, not a variable, so a response sent from a subshell
# or a pipeline still counts.
_pf_marker=$(mktemp "${TMPDIR:-/tmp}/pluginfinity-emitted.XXXXXX" 2>/dev/null) ||
	_pf_marker="${TMPDIR:-/tmp}/pluginfinity-emitted.$$"
: >"$_pf_marker" 2>/dev/null || true

# A Claude field name, read from either payload form: as written, then the
# camelCase spelling (tool_input from a toolArgs object or JSON string,
# tool_name from toolName, anything else camelCased at the top level). A
# tool_input key also falls back to Copilot's own spelling of it, since Copilot
# keeps its key names (path, file_text, old_str, new_str) under Claude event
# and tool names.
_PF_INPUT_FILTER='
def camel: gsub("_(?<c>[a-z])"; .c | ascii_upcase);
def args: if type == "string" then (fromjson? // .) else . end;
def alias: {file_path: "path", content: "file_text", old_string: "old_str", new_string: "new_str"};
. as $in
| ($path | if . == "" then [] else split(".") end) as $p
| (try ($in | getpath($p)) catch null) as $v
| (if $v != null then $v
   elif $p[0] == "tool_input" and ($p | length) == 2 and (alias[$p[1]] != null)
        and (try ($in | getpath([$p[0], alias[$p[1]]])) catch null) != null
     then ($in | getpath([$p[0], alias[$p[1]]]))
   elif $p[0] == "tool_input" then (try (($in.toolArgs | args) | getpath($p[1:])) catch null)
   elif $p[0] == "tool_name" then $in.toolName
   else (try ($in | getpath([$p[0] | camel] + $p[1:])) catch null) end)
| if . == null then empty elif type == "string" then . else tojson end'

# Print an input field by its Claude name (dotted for nested keys), or the
# whole input as JSON with no argument. Prints nothing for a missing field.
hook_input() { printf '%s' "$_pf_input" | jq -r --arg path "${1:-}" "$_PF_INPUT_FILTER" 2>/dev/null; }

# --- failure policy -------------------------------------------------------

_pf_has_emitted() { [ -s "$_pf_marker" ]; }

_pf_closed_response() { # code
	local reason="${PLUGINFINITY_PLUGIN:-a plugin} hook failed (exit $1)" body
	_pf_kind_prefix="fail-closed "
	if hook_supports deny; then
		_pf_permission deny "$reason"
	elif hook_supports block; then
		body=$(jq -nc --arg r "$reason" '{decision: "block", reason: $r}') || return 1
		_pf_emit "$body" block
	fi
}

_pf_on_exit() {
	local code=$? outcome=none
	if [ "$code" -ne 0 ]; then
		hook_log "exited $code during ${_pf_event:-an unknown event}"
		if [ "$_pf_fail_closed" = 1 ] && ! _pf_has_emitted; then
			# A Stop hook that crashes while stop_hook_active is true must not block again, or it loops.
			case "$_pf_event" in
			Stop | SubagentStop)
				[ "$(hook_input stop_hook_active)" = true ] || _pf_closed_response "$code" || true
				;;
			*) _pf_closed_response "$code" || true ;;
			esac
		fi
	fi
	if [ "${PLUGINFINITY_HOOK_DEBUG:-0}" = 1 ]; then
		if _pf_has_emitted; then outcome=$(cat "$_pf_marker" 2>/dev/null) || outcome=response; fi
		if [ "$code" -ne 0 ]; then outcome="$outcome (exit $code)"; fi
		hook_debug "outcome: $outcome"
	fi
	_pf_cleanup
	exit 0
}

# Make a failure deny (PreToolUse) or block (where blocking is honoured)
# instead of letting the action through.
hook_fail_closed() { _pf_fail_closed=1; }

# --- context --------------------------------------------------------------

# The event's Claude name: PLUGINFINITY_EVENT (set on every Copilot entry by
# the build), else the input's hook_event_name.
hook_event() {
	if [ -n "${PLUGINFINITY_EVENT:-}" ]; then
		printf '%s\n' "$PLUGINFINITY_EVENT"
	else
		hook_input hook_event_name
	fi
}
_pf_event=$(hook_event 2>/dev/null) || _pf_event=""

# claude or copilot.
hook_host() { printf '%s\n' "$PLUGINFINITY_HOST"; }

# The build root this script runs from.
hook_plugin_root() { (cd "$_pf_lib_dir/../../.." && pwd); }

# The project the session works in: CLAUDE_PROJECT_DIR on Claude, else the
# closest directory above the input's cwd holding .git, else that cwd.
hook_project_dir() {
	if [ "$PLUGINFINITY_HOST" = claude ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
		printf '%s\n' "$CLAUDE_PROJECT_DIR"
		return 0
	fi
	local dir probe
	dir=$(hook_input cwd)
	[ -n "$dir" ] || dir=$PWD
	probe=$dir
	while [ -n "$probe" ] && [ "$probe" != / ] && [ "$probe" != . ]; do
		if [ -e "$probe/.git" ]; then
			printf '%s\n' "$probe"
			return 0
		fi
		probe=$(dirname "$probe")
	done
	printf '%s\n' "$dir"
}

# cd into hook_project_dir, ignoring CDPATH and treating a leading dash as a path.
# Writes nothing to stdout; on failure it logs through hook_log and returns non-zero.
hook_cd_project() {
	local dir
	dir=$(hook_project_dir)
	CDPATH= cd -- "$dir" >/dev/null 2>&1 || {
		hook_log "hook_cd_project: cannot cd to $dir"
		return 1
	}
}

# Whether the host honours capability $1 on event $2 (default: this event).
# Mirrors okf/references/{claude-code,copilot-cli}-plugin-format.md.
hook_supports() {
	local cap="${1:-}" event="${2:-$_pf_event}"
	case "$PLUGINFINITY_HOST:$cap" in
	*:noop | *:raw) return 0 ;;
	claude:system_message)
		case "$event" in Notification | SessionEnd | PreCompact | ConfigChange) return 1 ;; esac
		return 0
		;;
	*:deny | *:allow | *:ask) [ "$event" = PreToolUse ] && return 0 ;;
	claude:context)
		case "$event" in
		SessionStart | SubagentStart | PostModelSwitch | UserPromptSubmit | UserPromptExpansion | PreToolUse | \
			PostToolUse | PostToolUseFailure | PostToolBatch | Stop | SubagentStop) return 0 ;;
		esac
		;;
	copilot:context)
		case "$event" in SessionStart | SubagentStart | PostToolUse | Notification) return 0 ;; esac
		;;
	claude:block)
		case "$event" in
		UserPromptSubmit | UserPromptExpansion | PostToolUse | PostToolBatch | Stop | \
			SubagentStop | ConfigChange | PreCompact | TaskCreated | PreModelSwitch) return 0 ;;
		esac
		;;
	copilot:block)
		case "$event" in Stop | SubagentStop) return 0 ;; esac
		;;
	esac
	return 1
}

# --- output ---------------------------------------------------------------

_pf_emit() { # json [kind]
	if [ -z "${1:-}" ]; then
		hook_log "refused to send an empty response"
		return 1
	fi
	if _pf_has_emitted; then
		hook_debug "ignored a second response: $1"
		return 0
	fi
	printf '%s' "${_pf_kind_prefix}${2:-response}" >"$_pf_marker" 2>/dev/null || true
	printf '%s\n' "$1"
}

_pf_unsupported() { # function-name
	hook_debug "$1 does nothing on $PLUGINFINITY_HOST for ${_pf_event:-an unknown event}"
	hook_noop
}

_pf_permission() { # decision reason [updated-input-json]
	local key=updatedInput body u=null
	[ "$PLUGINFINITY_HOST" = copilot ] && key=modifiedArgs
	if [ -n "${3:-}" ]; then
		u=$(printf '%s' "$3" | jq -c . 2>/dev/null) || {
			hook_log "hook_allow: not JSON: $3"
			return 1
		}
	fi
	body=$(jq -nc --arg d "$1" --arg r "${2:-}" --argjson u "$u" --arg k "$key" \
		'{permissionDecision: $d}
		 + (if $r == "" then {} else {permissionDecisionReason: $r} end)
		 + (if $u == null then {} else {($k): $u} end)' 2>/dev/null) || return 1
	if [ "$PLUGINFINITY_HOST" != copilot ]; then
		body=$(jq -nc --argjson b "$body" '{hookSpecificOutput: ({hookEventName: "PreToolUse"} + $b)}') || return 1
	fi
	_pf_emit "$body" "$1"
}

# Respond with nothing to change.
hook_noop() { _pf_emit '{}' noop; }

# Add text to the model's context.
hook_context() {
	hook_supports context || {
		_pf_unsupported hook_context
		return 0
	}
	local body
	if [ "$PLUGINFINITY_HOST" = copilot ]; then
		body=$(jq -nc --arg c "${1:-}" '{additionalContext: $c}') || return 1
	else
		body=$(jq -nc --arg e "$_pf_event" --arg c "${1:-}" \
			'{hookSpecificOutput: {hookEventName: $e, additionalContext: $c}}') || return 1
	fi
	_pf_emit "$body" context
}

# PreToolUse: refuse the tool call.
hook_deny() {
	hook_supports deny || {
		_pf_unsupported hook_deny
		return 0
	}
	_pf_permission deny "${1:-Blocked by ${PLUGINFINITY_PLUGIN:-a plugin}}"
}

# PreToolUse: allow the tool call, optionally replacing its input (JSON).
hook_allow() {
	hook_supports allow || {
		_pf_unsupported hook_allow
		return 0
	}
	_pf_permission allow "" "${1:-null}"
}

# PreToolUse: ask the user.
hook_ask() {
	hook_supports ask || {
		_pf_unsupported hook_ask
		return 0
	}
	_pf_permission ask "${1:-}"
}

# Block the event's action with a reason (Stop: keep working on it).
hook_block() {
	hook_supports block || {
		_pf_unsupported hook_block
		return 0
	}
	local body
	body=$(jq -nc --arg r "${1:-Blocked by ${PLUGINFINITY_PLUGIN:-a plugin}}" '{decision: "block", reason: $r}') || return 1
	_pf_emit "$body" block
}

# Show the user a message.
hook_system_message() {
	hook_supports system_message || {
		_pf_unsupported hook_system_message
		return 0
	}
	local body
	body=$(jq -nc --arg m "${1:-}" '{systemMessage: $m}') || return 1
	_pf_emit "$body" system_message
}

# Emit a host-specific JSON response verbatim, only on that host.
hook_raw() {
	if [ "${1:-}" != "$PLUGINFINITY_HOST" ]; then
		hook_debug "hook_raw for ${1:-no host} skipped on $PLUGINFINITY_HOST"
		return 0
	fi
	local body
	body=$(printf '%s' "${2:-}" | jq -c . 2>/dev/null) || {
		hook_log "hook_raw: not JSON: ${2:-}"
		return 1
	}
	_pf_emit "$body" raw
}

trap _pf_on_exit EXIT

if [ "${PLUGINFINITY_HOOK_DEBUG:-0}" = 1 ]; then hook_debug "input: ${_pf_input:0:4000}"; fi
