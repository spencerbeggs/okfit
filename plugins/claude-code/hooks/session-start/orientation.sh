#!/usr/bin/env bash
# hooks/session-start/orientation.sh — SessionStart hook (M-21, contract
# section 6.1). Registered with no matcher (hooks/hooks.json, contract
# section 4), so it fires on every source: startup, resume, clear, compact.
#
# Runs exactly one subprocess, `okfit context --format json`, and turns the
# merged config's vocabulary, the bundle's index.md, and two nudges into one
# additionalContext block. Never runs `okfit validate` — a whole-bundle
# conformance and lint pass just to learn the bundle root is the wasted work
# M-15 exists to avoid.
#
# IMPORTANT: nothing in this script may write to stdout except the single
# emit_context call at the end (or, on the jq-missing branch, one hand-built
# printf). A stray echo produces two concatenated JSON objects and Claude
# Code rejects the whole payload as invalid JSON (DOCS/hooks.md:373).

set -euo pipefail

# M-1 (decisions.md #1): CLAUDE_PLUGIN_ROOT in production; a self-relative
# walk only when unset, which is the BATS case. Production never needs to
# set the variable itself.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Libraries are sourced BEFORE the kill-switch checks below, not after, even
# though contract section 6.0 lists the kill switch as step 2 and the source
# lines as step 4: the kill switch calls emit_noop (C-9.1), so hook-output.sh
# must already be loaded by the time that case statement runs. This matches
# the working order in VA/hooks/pre-tool-use/test-location.sh, which sources
# its libs before its own opt-out case. The fence (C-10) is idempotent, so
# sourcing hook-output.sh here and (if ever) again downstream is harmless.
# shellcheck source=../lib/hook-output.sh
. "$PLUGIN_ROOT/hooks/lib/hook-output.sh"
# shellcheck source=../lib/okfit-cli.sh
. "$PLUGIN_ROOT/hooks/lib/okfit-cli.sh"

# Kill switches (C-1.1, C-1.2, M-18), checked before stdin is read. Exact
# string "off" only — M-18 names one spelling.
case "${OKFIT_HOOKS:-}" in off) emit_noop; exit 0 ;; esac
case "${OKFIT_SESSION_HOOK:-}" in off) emit_noop; exit 0 ;; esac

# jq probe (M-30). Without jq, emit_context cannot run (it shells to
# `jq -n --arg`) and neither can any field extraction below, so this branch
# hand-builds its own JSON object with printf. C-6.3's text carries no
# character that needs JSON escaping, so this is safe.
if ! command -v jq >/dev/null 2>&1; then
	printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"okfit: jq not found; skipping session orientation. Install jq to enable bundle and vocabulary injection."}}\n' >&3
	exit 0
fi

# M-19: set before every CLI invocation. Harmless (the subprocess has no
# TTY), explicit per house convention.
export NO_COLOR=1

# Drain stdin once. `.cwd` is the only field this hook reads (C-8); every
# other field is discarded. The `2>/dev/null || echo ""` guard matters even
# though stdin is normally well-formed JSON: an oversized or malformed
# envelope must not make jq's own parse failure trip `set -e` here, since
# a bare `var=$(pipeline)` is not inside an `if`/`&&`/`||` guard on its own.
hook_json=$(cat)
cwd=$(printf '%s' "$hook_json" | jq -r '.cwd // ""' 2>/dev/null || echo "")

# Project-dir chain (M-17): CLAUDE_PROJECT_DIR, else the envelope's cwd,
# else PWD.
project_dir=$(okfit_project_dir "$cwd")

# CLI resolution (M-17): OKFIT_CLI_CMD, else node_modules/.bin/okfit under
# project_dir, else `okfit` on PATH. Never npx.
if ! cli_cmd=$(okfit_cli "$project_dir"); then
	emit_context "SessionStart" "$(printf '%s\n%s' \
		"okfit: no okfit CLI found. Install @okfit/plugin to get vocabulary and validation in this session." \
		"Run: pnpm add -D @okfit/plugin (or your package manager's equivalent).")"
	exit 0
fi

# The one subprocess this hook ever runs. `set +e`/`set -e` bracket the call
# so the exact exit code can be captured without a bare failing command
# substitution tripping `set -e` (the `if ! var=$(...)` idiom achieves the
# same thing but discards the numeric code branch 4's stderr line needs).
# cli_cmd is deliberately unquoted: OKFIT_CLI_CMD may carry a multi-word
# command (M-17), and this is the one call site that must word-split it.
set +e
# shellcheck disable=SC2086
context_json=$($cli_cmd context --format json 2>/dev/null)
context_rc=$?
set -e

# Branch 4 (interpretation B-1 in the judge notes): a non-zero exit or
# unparseable stdout is the only real failure case for `context` — "no
# config file anywhere" is a SUCCESS with config_path: null (contract
# section 8.5), handled as branch 5 below, never here.
if [ "$context_rc" -ne 0 ] || ! printf '%s' "$context_json" | jq -e . >/dev/null 2>&1; then
	emit_context "SessionStart" "okfit context could not run (its config looks malformed); skipping orientation this session."
	echo "okfit: context exited $context_rc" >&2
	exit 0
fi

# From here the envelope is known-good JSON (C-7): every field is read
# straight off it, never re-derived.
bundle_root=$(printf '%s' "$context_json" | jq -r '.bundle_root')
profile=$(printf '%s' "$context_json" | jq -r '.profile // empty')
config_path=$(printf '%s' "$context_json" | jq -r '.config_path // empty')
index_path=$(printf '%s' "$context_json" | jq -r '.index_path')
index_exists=$(printf '%s' "$context_json" | jq -r '.index_exists')
actors_agent=$(printf '%s' "$context_json" | jq -r '.actors.agent // empty')

profile_display="${profile:-none}"
config_display="${config_path:-(none)}"

# One "Types:" (or "Tags:") header plus one bullet per entry, already
# sorted by name (contextEnvelope sorts before this hook ever sees the
# JSON, contract section 8.2). A guidance line, when present, sits on its
# own indented line under the bullet.
types_block=$(printf '%s' "$context_json" | jq -r '
	["Types:"] + [
		.types[] | "- " + .name + ": " + (.description // "(no description)")
			+ (if .guidance != null then "\n  " + .guidance else "" end)
	] | join("\n")
')

tags_block=$(printf '%s' "$context_json" | jq -r '
	["Tags:"] + [
		.tags[] | "- " + .name + ": " + (.description // "(no description)")
	] | join("\n")
')

# index.md, truncated at C-5.1 (12,000 bytes). No line-aware truncation —
# neither sibling repo has a precedent for one and a mid-line cut inside a
# system reminder costs nothing (contract section 6.1).
if [ "$index_exists" = "true" ]; then
	index_bytes=$(wc -c <"$index_path" | tr -d ' ')
	if [ "$index_bytes" -gt 12000 ]; then
		index_section="$(head -c 12000 "$index_path")

[truncated at 12000 bytes; index.md is ${index_bytes} bytes — read it directly for the rest]"
	else
		index_section="$(cat "$index_path")"
	fi
else
	index_section="No index.md yet at ${index_path}. Run \`okfit init\` or write one."
fi

CONTEXT="okfit bundle: ${bundle_root} (profile: ${profile_display})
config: ${config_display}

${types_block}

${tags_block}

${index_section}"

# C-6.7/C-6.8: appended (not substituted — branch 5 still has a vocabulary,
# since the software-project profile applies with no config file at all)
# when no config file was discovered.
if [ -z "$config_path" ]; then
	CONTEXT="${CONTEXT}

No okfit config found in this project.
Run \`okfit init\` to scaffold an okf/ bundle and a config."
fi

# C-6.9 (M-29): the default state, since neither DEFAULTS nor
# software-project sets actors.agent.
if [ -z "$actors_agent" ]; then
	CONTEXT="${CONTEXT}

Note: actors.agent is not set in this project's config. Set actors.agent = \"okfit/claude-code\" so this plugin's agent can stamp generated.by."
fi

emit_context "SessionStart" "$CONTEXT"
