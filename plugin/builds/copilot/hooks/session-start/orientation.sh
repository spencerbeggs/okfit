#!/usr/bin/env bash
# hooks/session-start/orientation.sh — SessionStart hook (M-21, contract
# section 6.1). Registered with no matcher (pluginfinity.config.ts,
# contract section 4), so it fires on every source: startup, resume, clear, compact.
#
# Runs exactly one subprocess, `okfit context --format json`, and turns the
# merged config's vocabulary, the bundle's index.md, and two nudges into one
# additionalContext block. Never runs `okfit validate` — a whole-bundle
# conformance and lint pass just to learn the bundle root is the wasted work
# M-15 exists to avoid.
#
# IMPORTANT: nothing in this script may write to stdout except the single
# hook_context call that ends each branch. The library has no stdout fence,
# so every CLI call is captured with $(...) and diagnostics go to stderr.

set -euo pipefail

# The pluginfinity hook library: reads the event, writes each host's
# response shape, and fails open (logged) on any non-zero exit. It needs jq
# and is a silent no-op without it.
# shellcheck source=/dev/null
. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
# shellcheck source=../lib/okfit/okfit-cli.sh
. "$(dirname "$0")/../lib/okfit/okfit-cli.sh"

# Kill switches (C-1.1, C-1.2, M-18). Exact string "off" only.
case "${OKFIT_HOOKS:-}" in off) hook_noop; exit 0 ;; esac
case "${OKFIT_SESSION_HOOK:-}" in off) hook_noop; exit 0 ;; esac

# M-19: set before every CLI invocation.
export NO_COLOR=1

# CLAUDE_PROJECT_DIR on Claude Code; on Copilot the closest .git above the
# input's cwd, else the cwd.
project_dir=$(hook_project_dir)

# Run the CLI from the project: `okfit context` resolves the project from
# its working directory, and Copilot runs hooks from the plugin root.
hook_cd_project || { hook_noop; exit 0; }

# CLI resolution (M-17): OKFIT_CLI_CMD, else node_modules/.bin/okfit under
# project_dir, else `okfit` on PATH. Never npx.
if ! cli_cmd=$(okfit_cli "$project_dir"); then
	hook_context "$(printf '%s\n%s' \
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
	# Minor 9 (final review): a non-zero exit still carries a valid
	# JsonErrorEnvelope on stdout (CLI/render/json.ts), so quote its own
	# .error.message when present rather than the generic sentence alone.
	error_message=""
	if printf '%s' "$context_json" | jq -e '.error.message' >/dev/null 2>&1; then
		error_message=$(printf '%s' "$context_json" | jq -r '.error.message' 2>/dev/null || echo "")
	fi
	if [ -n "$error_message" ]; then
		hook_context "okfit context could not run (its config looks malformed: ${error_message}); skipping orientation this session."
	else
		hook_context "okfit context could not run (its config looks malformed); skipping orientation this session."
	fi
	echo "okfit: context exited $context_rc" >&2
	exit 0
fi

# From here the envelope is known-good JSON (C-7): every field is read
# straight off it, never re-derived.
project_root=$(printf '%s' "$context_json" | jq -r '.project_root')
bundle_root=$(printf '%s' "$context_json" | jq -r '.bundle_root')
profile=$(printf '%s' "$context_json" | jq -r '.profile // empty')
profile_requested=$(printf '%s' "$context_json" | jq -r '.profile_requested // empty')
config_path=$(printf '%s' "$context_json" | jq -r '.config_path // empty')
index_path=$(printf '%s' "$context_json" | jq -r '.index_path')
index_exists=$(printf '%s' "$context_json" | jq -r '.index_exists')
actors_agent=$(printf '%s' "$context_json" | jq -r '.actors.agent // empty')

profile_display="${profile:-none}"
config_display="${config_path:-(none)}"

# One "Types:" (or "Tags:") header plus one bullet per entry, already
# sorted by name (contextEnvelope sorts before this hook ever sees the
# JSON, contract section 8.2). A guidance line, when present, sits on its
# own indented line under the bullet, followed by the constraints validate
# enforces (issue #33): required keys, whether verified is required, and
# each declared field with its enum values or "path" kind. Every lookup is
# null-safe so an older envelope without those keys still renders.
types_block=$(printf '%s' "$context_json" | jq -r '
	def field_line: .name
		+ (if (.values // null) != null then " (" + ([.values[].name] | join(" | ")) + ")"
		   elif (.kind // null) != null then " (" + .kind + ")"
		   else "" end);
	["Types:"] + [
		.types[] | "- " + .name + ": " + (.description // "(no description)")
			+ (if .guidance != null then "\n  " + .guidance else "" end)
			+ (if ((.required // []) | length) > 0 then "\n  required: " + (.required | join(", ")) else "" end)
			+ (if (.require_verified // false) then "\n  verified: required" else "" end)
			+ (if ((.fields // []) | length) > 0 then "\n  fields: " + ([.fields[] | field_line] | join(", ")) else "" end)
	] | join("\n")
')

tags_block=$(printf '%s' "$context_json" | jq -r '
	["Tags:"] + [
		.tags[] | "- " + .name + ": " + (.description // "(no description)")
	] | join("\n")
')

# Minor 10 (final review): the combined types+tags vocabulary block is
# bounded at 8,000 bytes, same truncation-line pattern as index.md below
# (C-5.1's 12,000-byte cap). A large config's vocabulary must not crowd
# index.md or the nudges out of the platform's own additionalContext cap
# (C-5, 10,000 characters).
vocab_text="${types_block}

${tags_block}"
vocab_bytes=$(printf '%s' "$vocab_text" | wc -c | tr -d ' ')
if [ "$vocab_bytes" -gt 8000 ]; then
	vocab_text="$(printf '%s' "$vocab_text" | head -c 8000)

[truncated at 8000 bytes; vocabulary is ${vocab_bytes} bytes — read it directly with \`okfit context --format json\`]"
fi

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

${vocab_text}

${index_section}"

# C-6.7/C-6.8: appended (not substituted — branch 5 still has a vocabulary,
# since the software-project profile applies with no config file at all)
# when no config file was discovered. Minor 7 (final review): a config
# found but living OUTSIDE project_root (a user-level XDG config) still
# means the project itself has no config, so the nudge fires there too —
# the project-relative test is deliberately not just "$config_path is set".
config_outside_project=0
if [ -n "$config_path" ]; then
	case "$config_path" in
		"$project_root"/*) ;;
		*) config_outside_project=1 ;;
	esac
fi
if [ -z "$config_path" ] || [ "$config_outside_project" -eq 1 ]; then
	CONTEXT="${CONTEXT}

No okfit config found in this project.
Run \`okfit init\` to scaffold an okf/ bundle and a config."
fi

# Important 1 (final review): a config was found, but the profile it named
# does not resolve (profile is null while profile_requested still names
# what was asked for, and is neither null nor the deliberate "none") — tell
# the operator why the vocabulary above is empty rather than leaving them
# to guess. Never fires for "none" (a deliberate no-profile config) or for
# no-config-at-all (profile_requested itself null then, contract C-7).
if [ -n "$config_path" ] && [ -z "$profile" ] && [ -n "$profile_requested" ] && [ "$profile_requested" != "none" ]; then
	CONTEXT="${CONTEXT}

Profile \"${profile_requested}\" is unknown; no vocabulary was loaded. Check bundle.profile in the okfit config."
fi

# C-6.9 (M-29): the default state, since neither DEFAULTS nor
# software-project sets actors.agent.
if [ -z "$actors_agent" ]; then
	CONTEXT="${CONTEXT}

Note: actors.agent is not set in this project's config. Set actors.agent = \"okfit/claude-code\" so this plugin's agent can stamp generated.by."
fi

hook_context "$CONTEXT"
