#!/usr/bin/env bash
# hooks/post-tool-use/validate.sh — PostToolUse hook on Write|Edit (M-20,
# contract section 6.2). Fires AFTER the write has landed on disk
# (DOCS/hook-events.md:539), so this hook validates the real bytes rather
# than trusting tool_response, which it never reads.
#
# Runs one cheap `okfit context --format json` call to learn bundle_root and
# project_root, then — only when the edited file is under bundle_root — one
# whole-bundle `okfit validate <project_root> --format json` call, filtering
# diagnostics[] down to this one file by its bundle-relative posix path
# (D-32, CLI/render/sort.ts:8-10). A core.conformance hit on that file blocks
# (decision: "block", top-level per DOCS/hooks.md:416); a core.lint or
# profile hit warns via additionalContext; anything else is silent.
#
# IMPORTANT: nothing in this script may write to stdout except the single
# emit_noop / emit_context / emit_block call that ends each branch.

set -euo pipefail

# M-1: CLAUDE_PLUGIN_ROOT in production, self-relative walk under BATS.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Sourced before the kill switches for the same reason orientation.sh does:
# the kill switch calls emit_noop, which must already be defined.
# shellcheck source=../lib/hook-output.sh
. "$PLUGIN_ROOT/hooks/lib/hook-output.sh"
# shellcheck source=../lib/okfit-cli.sh
. "$PLUGIN_ROOT/hooks/lib/okfit-cli.sh"

# Kill switches (C-1.1, C-1.3, M-18), checked before stdin is read.
case "${OKFIT_HOOKS:-}" in off) emit_noop; exit 0 ;; esac
case "${OKFIT_VALIDATE_HOOK:-}" in off) emit_noop; exit 0 ;; esac

# jq probe (M-30). Fails open with one stderr line (C-6.4); stdout is still
# valid JSON via emit_noop, which needs no jq.
if ! command -v jq >/dev/null 2>&1; then
	emit_noop
	echo "okfit: jq not found; validate hook allowing silently." >&2
	exit 0
fi

export NO_COLOR=1

# The three envelope fields this hook reads, at the exact paths C-8 quotes.
# .tool_response is deliberately never read (see file header).
hook_json=$(cat)
tool_name=$(printf '%s' "$hook_json" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
file_path=$(printf '%s' "$hook_json" | jq -r '.tool_input.file_path // ""' 2>/dev/null || echo "")
cwd=$(printf '%s' "$hook_json" | jq -r '.cwd // ""' 2>/dev/null || echo "")

# Defence in depth: hooks.json's matcher already restricts to Write|Edit,
# but a hand-crafted or future dispatch is cheap to guard against too
# (VA/hooks/pre-tool-use/test-location.sh:41-45 does the same re-check).
case "$tool_name" in
	Write | Edit) ;;
	*)
		emit_noop
		exit 0
		;;
esac

if [ -z "$file_path" ]; then
	emit_noop
	exit 0
fi

# Project-dir chain and CLI resolution (M-17): identical to orientation.sh.
project_dir=$(okfit_project_dir "$cwd")

if ! cli_cmd=$(okfit_cli "$project_dir"); then
	emit_noop
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
	emit_noop
	echo "okfit: context exited $context_rc; validate hook allowing silently." >&2
	exit 0
fi

bundle_root=$(printf '%s' "$context_json" | jq -r '.bundle_root')
project_root=$(printf '%s' "$context_json" | jq -r '.project_root')

# The outside-the-bundle fast path (branch 7): a lexical prefix test, run
# BEFORE the expensive `okfit validate` subprocess is ever spawned. Quoted
# throughout so a path containing a space still compares correctly.
case "$file_path" in
	"$bundle_root"/*) ;;
	*)
		emit_noop
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
set +e
# shellcheck disable=SC2086
validate_json=$($cli_cmd validate "$project_root" --format json 2>/dev/null)
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
	emit_context "PostToolUse" "okfit validate could not run for ${bundle_relative}: ${error_message}. The file was not checked this time."
	exit 0
fi

# Filter diagnostics[] to this one file's bundle-relative path. A
# bundle-level finding (.file == "") never matches a concrete file_path, so
# it is silently excluded by construction — it is not a fact about the file
# just written (contract section 6.2, "Edge cases").
conformance_hits=$(printf '%s' "$validate_json" | jq --arg f "$bundle_relative" \
	'[.diagnostics[] | select(.source == "core.conformance" and .file == $f)]')
lint_hits=$(printf '%s' "$validate_json" | jq --arg f "$bundle_relative" \
	'[.diagnostics[] | select((.source == "core.lint" or .source == "profile") and .file == $f)]')

conformance_count=$(printf '%s' "$conformance_hits" | jq 'length')
lint_count=$(printf '%s' "$lint_hits" | jq 'length')

# Branch 9: every core.conformance diagnostic is severity error by
# construction (D-33/D-34), so this collapses to "block on any
# core.conformance hit for this file". Top-level {decision, reason} — never
# wrapped in hookSpecificOutput (C-8).
if [ "$conformance_count" -gt 0 ]; then
	lines=$(printf '%s' "$conformance_hits" | jq -r '.[] | "  " + .code + ": " + .message')
	reason="${bundle_relative}: ${conformance_count} conformance error(s) — fix before continuing:
${lines}"
	emit_block "$reason"
	exit 0
fi

# Branch 10: core.lint OR profile (interpretation B-7 — CLI/render/sort.ts:5
# defines three sources; M-20 names only core.lint as warn-worthy and is
# silent on profile, read as "not block-worthy" rather than "not handled").
if [ "$lint_count" -gt 0 ]; then
	lines=$(printf '%s' "$lint_hits" | jq -r '.[] | "  " + .code + ": " + .message')
	context="${bundle_relative}: ${lint_count} lint warning(s):
${lines}"
	emit_context "PostToolUse" "$context"
	exit 0
fi

# Branch 11: clean.
emit_noop
