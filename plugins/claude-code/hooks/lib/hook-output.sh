#!/bin/bash
# hook-output.sh — shared helpers for emitting Claude Code hook stdout.
#
# Adapted from vitest-agent/plugins/claude-code/hooks/lib/hook-output.sh,
# trimmed to what okfit uses (M-2). Two functions have no upstream analogue:
# emit_context is a rename of that file's emit_additional_context, and
# emit_block is new — the PostToolUse top-level decision shape okfit's
# validate hook needs and vitest-agent, having no PostToolUse blocker, never
# needed. vitest-agent's VITEST_AGENT_PROJECT_DIR propagation block and its
# emit_system_message helper are both dropped: this plugin writes no state
# (M-19) and neither okfit hook fires on an event lacking additionalContext.
#
# Every Claude Code hook that exits 0 MUST emit valid JSON on stdout, and
# stdout must contain nothing else (hooks.md: "Stdout must contain only the
# JSON object"). All caller-provided strings flow through `jq -n --arg` so
# embedded quotes, newlines, and backslashes cannot break the output.
#
# Usage:
#   . "${CLAUDE_PLUGIN_ROOT}/hooks/lib/hook-output.sh"
#   emit_noop                          # silent no-op, no jq needed (C-9.1)
#   emit_context "SessionStart" "$ctx" # additionalContext; hookEventName MUST match the firing event (C-9.2)
#   emit_allow "$reason"               # PreToolUse allow; unused in phase 1, kept for a future hook (C-9.3)
#   emit_deny "$reason"                # PreToolUse deny; unused in phase 1, kept for a future hook (C-9.4)
#   emit_block "$reason"               # PostToolUse top-level decision: "block" (C-9.5)
#   jq -n '...' | emit_raw             # escape hatch: forwards stdin verbatim to the fenced descriptor (C-9.6)
#
# The kill-switch preamble every hook script in hooks/session-start/ and
# hooks/post-tool-use/ opens with (§5.3, C-1.1–C-1.3) needs emit_noop, so it
# runs AFTER this file is sourced, not before:
#
#   . "$PLUGIN_ROOT/hooks/lib/hook-output.sh"
#   case "${OKFIT_HOOKS:-}" in off) emit_noop; exit 0 ;; esac
#   case "${OKFIT_SESSION_HOOK:-}" in off) emit_noop; exit 0 ;; esac    # orientation.sh only
#   case "${OKFIT_VALIDATE_HOOK:-}" in off) emit_noop; exit 0 ;; esac   # validate.sh only
#   . "$PLUGIN_ROOT/hooks/lib/okfit-cli.sh"
#
# Matching is exact-string "off" (M-18) — okfit does not widen this to
# "off | 0 | false" the way vitest-agent's own hooks do.

# --- stdout fence (C-10) ---------------------------------------------------
# Claude Code parses a hook's stdout as ONE JSON object, so any other byte on
# fd 1 corrupts the payload — including stdout from a spawned `okfit` CLI
# whose call site only remembered to redirect stderr. Move the real hook
# stdout to fd 3 and point fd 1 at stderr: only the emit_* helpers below,
# which write explicitly to fd 3, can reach the host.
#
# Command substitution is unaffected: `$(cmd)` installs its own pipe on fd 1.
#
# The guard is deliberately NOT exported: a nested script that sources this
# lib must fence its own fd 1, not inherit the parent's fd 3.
if [ -z "${_OKFIT_HOOK_STDOUT_FENCED:-}" ]; then
	exec 3>&1 1>&2
	_OKFIT_HOOK_STDOUT_FENCED=1
fi

# Silent no-op response (C-9.1). Needs no jq: the kill-switch preamble calls
# this before jq is ever probed, so it must work with only bash on PATH.
emit_noop() {
	printf '%s\n' '{"continue": true, "suppressOutput": true}' >&3
}

# Inject additionalContext (C-9.2). Event names this plugin actually fires:
# SessionStart, PostToolUse. hookEventName MUST match the firing event or
# the platform silently drops the field. $1 = event name, $2 = context text.
emit_context() {
	local event="$1"
	local ctx="$2"
	jq -n --arg e "$event" --arg c "$ctx" '{
		hookSpecificOutput: {
			hookEventName: $e,
			additionalContext: $c
		}
	}' >&3
}

# PreToolUse permission allow (C-9.3). Unused by either hook in phase 1 —
# kept so a future PreToolUse hook needs no second copy. $1 = reason.
emit_allow() {
	local reason="$1"
	jq -n --arg r "$reason" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
			permissionDecisionReason: $r
		}
	}' >&3
}

# PreToolUse permission deny (C-9.4). Unused by either hook in phase 1, same
# reason as emit_allow. $1 = reason. permissionDecision is "deny" — "block"
# is not a legal value for this field.
emit_deny() {
	local reason="$1"
	jq -n --arg r "$reason" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: $r
		}
	}' >&3
}

# PostToolUse top-level block (C-9.5). Top-level decision/reason, NOT
# wrapped in hookSpecificOutput. $1 = reason shown to Claude.
emit_block() {
	local reason="$1"
	jq -n --arg r "$reason" '{ decision: "block", reason: $r }' >&3
}

# Escape hatch (C-9.6): forwards an already-encoded JSON object on stdin to
# the fenced descriptor verbatim. Needs no jq itself — the caller owns the
# encoder.
emit_raw() {
	cat >&3
}
