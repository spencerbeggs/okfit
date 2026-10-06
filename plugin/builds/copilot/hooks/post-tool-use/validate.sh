#!/usr/bin/env bash
# hooks/post-tool-use/validate.sh — PostToolUse hook on Write|Edit (M-20,
# contract section 6.2). Fires AFTER the write has landed on disk
# (DOCS/hook-events.md:539), so this hook validates the real bytes rather
# than trusting tool_response, which it never reads.
#
# This hook keeps exactly two jobs now that the registered language server
# delivers core.lint and profile findings with precise ranges directly in
# the editor (LSP phase 4, decision 8): it runs one cheap
# `okfit context --format json` call to learn bundle_root and project_root,
# then — only when the edited file is under bundle_root — one whole-bundle
# `okfit validate <project_root> --format json` call, filtering
# diagnostics[] down to this one file by its bundle-relative posix path
# (D-32, CLI/render/sort.ts:8-10). A core.conformance hit on that file
# blocks (decision: "block", top-level per DOCS/hooks.md:416); everything
# else `okfit validate` reports for the file is silent here, since the LSP
# already surfaced it with a range. The second job reads the written file
# itself: a concept the agent wrote without generated.by blocks on Write
# and warns on Edit (okfit #74, see below).
#
# IMPORTANT: nothing in this script may write to stdout except the single
# hook_noop / hook_context / okfit_stop call that ends each branch.

set -euo pipefail

# The pluginfinity hook library: reads the event, writes each host's
# response shape, and fails open (logged) on any non-zero exit. It needs jq
# and is a silent no-op without it.
# shellcheck source=/dev/null
. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
# shellcheck source=../lib/okfit/okfit-cli.sh
. "$(dirname "$0")/../lib/okfit/okfit-cli.sh"

# Kill switches (C-1.1, C-1.3, M-18).
case "${OKFIT_HOOKS:-}" in off) hook_noop; exit 0 ;; esac
case "${OKFIT_VALIDATE_HOOK:-}" in off) hook_noop; exit 0 ;; esac

export NO_COLOR=1

# The two input fields this hook reads. tool_input.file_path also reads
# Copilot's `path`. .tool_response is deliberately never read.
tool_name=$(hook_input tool_name)
file_path=$(hook_input tool_input.file_path)

# okfit_stop reason — a stop-and-fix signal. A top-level PostToolUse block
# where the host honours one (Claude Code); Copilot honours no PostToolUse
# block, so there the same reason goes in as additionalContext instead of
# being dropped.
okfit_stop() {
	if hook_supports block; then
		hook_block "$1"
	else
		hook_context "$1"
	fi
}

# Defence in depth: the config's matcher already restricts to Write|Edit,
# but a hand-crafted or future dispatch is cheap to guard against too
# (VA/hooks/pre-tool-use/test-location.sh:41-45 does the same re-check).
case "$tool_name" in
	Write | Edit) ;;
	*)
		hook_noop
		exit 0
		;;
esac

if [ -z "$file_path" ]; then
	hook_noop
	exit 0
fi

# CLAUDE_PROJECT_DIR on Claude Code; on Copilot the closest .git above the
# input's cwd, else the cwd. CLI resolution (M-17) as in orientation.sh.
project_dir=$(hook_project_dir)

# Run the CLI from the project: `okfit context` resolves the project from
# its working directory, and Copilot runs hooks from the plugin root.
hook_cd_project || { hook_noop; exit 0; }

if ! cli_cmd=$(okfit_cli "$project_dir"); then
	hook_noop
	echo "okfit: CLI not found; validate hook allowing silently." >&2
	exit 0
fi

# Cheap call #1: learn bundle_root and project_root. Cached in shell
# variables for the rest of THIS invocation only — never across invocations
# (M-20's "cached per invocation, not across").
set +e
# shellcheck disable=SC2086
context_json=$($cli_cmd context --format json 2>/dev/null)
context_rc=$?
set -e

if [ "$context_rc" -ne 0 ] || ! printf '%s' "$context_json" | jq -e . >/dev/null 2>&1; then
	hook_noop
	echo "okfit: context exited $context_rc; validate hook allowing silently." >&2
	exit 0
fi

bundle_root=$(printf '%s' "$context_json" | jq -r '.bundle_root')
project_root=$(printf '%s' "$context_json" | jq -r '.project_root')
agent_actor=$(printf '%s' "$context_json" | jq -r '.actors.agent // ""')

# The outside-the-bundle fast path (branch 7): a lexical prefix test, run
# BEFORE the expensive `okfit validate` subprocess is ever spawned. Quoted
# throughout so a path containing a space still compares correctly.
case "$file_path" in
	"$bundle_root"/*) ;;
	*)
		hook_noop
		exit 0
		;;
esac

# Bundle-relative path computation (D-32): strip "<bundle_root>/" once. Both
# sides of every later comparison are this same posix, bundle-root-relative
# string — no further normalisation.
bundle_relative="${file_path#"$bundle_root"/}"

# Expensive call #2: the whole-bundle validate pass. The argument is the
# PROJECT root, never the bundle root (K-2) — okfit_cli's caller never
# reimplements resolveBundleRoot; it asks the CLI once and reuses the
# answer, which is what project_root (from the envelope, C-7) already is.
# --skip-provenance (S-31/F-3): this hook fires on every Write/Edit inside
# the bundle, so the generated-at-drift lint's git tier (a repoRoot + show
# HEAD + log --follow + N show subprocess burst per concept) would run on
# every single edit; the flag keeps this call git-free without touching the
# project's own `[lint]` table, which CI and `validate_bundle` still honor.
set +e
# shellcheck disable=SC2086
validate_json=$($cli_cmd validate "$project_root" --format json --skip-provenance 2>/dev/null)
validate_rc=$?
set -e

validate_parses=0
if printf '%s' "$validate_json" | jq -e . >/dev/null 2>&1; then
	validate_parses=1
fi

is_error_envelope=0
if [ "$validate_parses" -eq 1 ] && printf '%s' "$validate_json" | jq -e '.error != null' >/dev/null 2>&1; then
	is_error_envelope=1
fi

# Branch 8 (C-6.10, judge note A-10): a JsonErrorEnvelope (.error present —
# the only shape exit_code: 3 can ever carry, CLI/render/json.ts:52-59), an
# exit code of 3/64/130, or stdout that fails to parse at all are the same
# fact from this hook's point of view — okfit validate could not check this
# file this time — and all three produce the identical single warning,
# never a block (M-20's "Exit code 3 ... becomes a single warning"). When
# stdout does not parse (e.g. an interrupt with no output at all), there is
# no error.message to quote, so the fallback names the raw exit code instead
# — a defensive extension beyond C-6.10's literal template, which assumes a
# JsonErrorEnvelope is always present.
if [ "$is_error_envelope" -eq 1 ] || [ "$validate_rc" -eq 3 ] || [ "$validate_rc" -eq 64 ] || [ "$validate_rc" -eq 130 ] || [ "$validate_parses" -eq 0 ]; then
	if [ "$is_error_envelope" -eq 1 ]; then
		error_message=$(printf '%s' "$validate_json" | jq -r '.error.message')
	else
		error_message="exited ${validate_rc} with no parseable output"
	fi
	hook_context "okfit validate could not run for ${bundle_relative}: ${error_message}. The file was not checked this time."
	exit 0
fi

# Filter diagnostics[] to this one file's bundle-relative path. A
# bundle-level finding (.file == "") never matches a concrete file_path, so
# it is silently excluded by construction — it is not a fact about the file
# just written (contract section 6.2, "Edge cases").
conformance_hits=$(printf '%s' "$validate_json" | jq --arg f "$bundle_relative" \
	'[.diagnostics[] | select(.source == "core.conformance" and .file == $f)]')

conformance_count=$(printf '%s' "$conformance_hits" | jq 'length')

# The generated.by check (okfit #74). okf-authoring rule 3 asks the agent
# to stamp `generated.by: <actors.agent>` on every concept it writes, and
# under one twelve-agent brief 109 of 268 concepts carried it: the rule in
# the prompt is not enough. This hook is the one place that knows a write
# came from the agent, so it reads the bytes on disk and checks the
# frontmatter block for a `generated:` mapping with a `by:` key. Only when
# the config sets actors.agent (an unset agent means the repo has not asked
# for attribution), only for a concept file (index.md and log.md are
# reserved and never carry generated), and only when the file exists (the
# fixtures dispatch paths that were never written). The verdict joins the
# validate branches below: a Write authored the whole file and blocks
# until stamped; an Edit warns, since rule 3 says "meaningful changes" and
# a typo fix to a human-authored concept must not be force-attributed.
missing_generated_by=0
case "$bundle_relative" in
	index.md | */index.md | log.md | */log.md) ;;
	*.md)
		if [ -n "$agent_actor" ] && [ -f "$file_path" ]; then
			if ! awk '
				NR == 1 && $0 != "---" { exit 1 }
				NR > 1 && $0 == "---" { exit (found ? 0 : 1) }
				NR > 1 && /^generated:[[:space:]]*$/ { in_generated = 1; next }
				NR > 1 && in_generated && /^[[:space:]]+by:[[:space:]]*[^[:space:]]/ { found = 1 }
				NR > 1 && in_generated && /^[^[:space:]]/ { in_generated = 0 }
				END { if (NR == 0) exit 1 }
			' "$file_path"; then
				missing_generated_by=1
			fi
		fi
		;;
esac
generated_line="generated.by is missing: add \`generated:\` with \`by: ${agent_actor}\` to the frontmatter (okf-authoring rule 3); okfit sync fills in at and body_sha256 later"

# Branch 9: every core.conformance diagnostic is severity error by
# construction (D-33/D-34), so this collapses to "block on any
# core.conformance hit for this file". Top-level {decision, reason} — never
# wrapped in hookSpecificOutput (C-8).
if [ "$conformance_count" -gt 0 ]; then
	lines=$(printf '%s' "$conformance_hits" | jq -r '.[] | "  " + .code + ": " + .message')
	reason="${bundle_relative}: ${conformance_count} conformance error(s) — fix before continuing:
${lines}"
	if [ "$missing_generated_by" -eq 1 ]; then
		reason="${reason}
  ${generated_line}"
	fi
	okfit_stop "$reason"
	exit 0
fi

# Branch 9b (okfit #74): a Write that authored a whole concept without
# generated.by blocks on its own, with the exact line to add as the reason.
if [ "$missing_generated_by" -eq 1 ] && [ "$tool_name" = "Write" ]; then
	okfit_stop "${bundle_relative}: ${generated_line}"
	exit 0
fi

# Branch 10 (okfit #74): an Edit of a concept with no generated.by warns.
# core.lint and profile diagnostics for this file are never surfaced here —
# the registered language server already delivered them with a precise
# range (LSP phase 4, decision 8).
if [ "$missing_generated_by" -eq 1 ]; then
	hook_context "${bundle_relative}: ${generated_line}"
	exit 0
fi

# Branch 11: clean.
hook_noop
