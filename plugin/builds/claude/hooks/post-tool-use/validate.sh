#!/usr/bin/env bash
# hooks/post-tool-use/validate.sh — PostToolUse hook on Write|Edit|Bash (M-20,
# contract section 6.2). Fires AFTER the write has landed on disk
# (DOCS/hook-events.md:539), so this hook validates the real bytes rather
# than trusting tool_response, which it never reads.
#
# This hook keeps exactly two jobs now that the registered language server
# delivers core.lint and profile findings with precise ranges directly in
# the editor (LSP phase 4, decision 8): it runs one cheap
# `okfit context --format json` call to learn bundle_root and project_root,
# then — only when the edited file is under bundle_root — one whole-bundle
# `okfit validate --root <project_root> <file> --format json` call: the bundle
# still loads whole, but the edited file as a target scopes the reported
# diagnostics to it; the bundle-relative posix path filter below is kept
# (D-32, CLI/render/sort.ts:8-10). A core.conformance hit on that file
# blocks (decision: "block", top-level per DOCS/hooks.md:416); everything
# else `okfit validate` reports for the file is silent here, since the LSP
# already surfaced it with a range, except non-concept-unlisted (okfit #476):
# a typeless .md the config does not list blocks a Write and warns an Edit.
# The second job reads the written file
# itself: a concept the agent wrote without generated.by blocks on Write
# and warns on Edit (okfit #74, see below).
#
# A Bash call gets that second job only (okfit #223): a heredoc or tee that
# writes a bundle concept would otherwise dodge the check and leave one
# bundle with two shapes. The command text is scanned heuristically for
# write targets (see bash_write_targets), BEFORE `okfit context` is spawned,
# so a command with no .md write target costs nothing. Exotic writes slip
# through, which is acceptable because `okfit sync` backfills `generated`
# from actors.agent. The conformance pass does not run for Bash; a typeless
# authoring write gets one scoped validate for the non-concept-unlisted lint
# (okfit #476), and edit-like writes are never validated. #74's split
# carries over: authoring writes (>, >|, tee, cp/install destination) block;
# edit-like writes (>>, tee -a, sed -i, mv destination) only warn, so a
# human concept touched by sed -i is never force-attributed.
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

# The input fields this hook reads. tool_input.file_path also reads
# Copilot's `path`. .tool_response is deliberately never read.
tool_name=$(hook_input tool_name)
file_path=$(hook_input tool_input.file_path)
bash_command=""
bash_targets=""

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

# has_generated_by file — succeeds when the file's frontmatter block holds a
# `generated:` mapping with a `by:` key (okfit #74). Shared by the Write/Edit
# branch and the Bash branch. Both awk helpers run under LC_ALL=C and strip a
# trailing CR from every record and a UTF-8 BOM (passed in as bytes from the
# shell, never an awk escape, for mawk) from record 1, so CRLF and BOM
# frontmatter reads like LF (okfit #483).
has_generated_by() {
	LC_ALL=C awk -v bom="$(printf '\357\273\277')" '
		{ sub(/\r$/, "") }
		NR == 1 && index($0, bom) == 1 { $0 = substr($0, 4) }
		NR == 1 && $0 != "---" { exit 1 }
		NR > 1 && $0 == "---" { exit (found ? 0 : 1) }
		NR > 1 && /^generated:[[:space:]]*$/ { in_generated = 1; next }
		NR > 1 && in_generated && /^[[:space:]]+by:[[:space:]]*[^[:space:]]/ { found = 1 }
		NR > 1 && in_generated && /^[^[:space:]]/ { in_generated = 0 }
		END { if (NR == 0) exit 1 }
	' "$1"
}

# has_type file — succeeds when the file opens with a frontmatter block that
# holds a top-level `type:` key (a concept, OKF 0.3 section 3.2). A file with
# no frontmatter, or none with a type, is not a concept (okfit #476).
has_type() {
	LC_ALL=C awk -v bom="$(printf '\357\273\277')" '
		{ sub(/\r$/, "") }
		NR == 1 && index($0, bom) == 1 { $0 = substr($0, 4) }
		NR == 1 && $0 != "---" { exit 1 }
		NR > 1 && $0 == "---" { exit (found ? 0 : 1) }
		NR > 1 && /^type:[[:space:]]*[^[:space:]]/ { found = 1 }
		END { if (NR == 0) exit 1 }
	' "$1"
}

# physical_dir dir — prints the directory's physical form (`cd … && pwd -P`
# in a subshell), or the argument unchanged when it does not exist (okfit #486).
physical_dir() {
	local d
	if d=$(CDPATH= cd -- "$1" >/dev/null 2>&1 && pwd -P); then
		printf '%s' "$d"
	else
		printf '%s' "$1"
	fi
}

# physical_path path — prints <physical dir>/<basename> for an absolute path,
# or the path unchanged when its directory does not exist (okfit #486). The
# file itself is never resolved: a symlinked file is the symlink-escape lint's
# business. Parameter expansion only, so no subprocess beyond the subshell.
physical_path() {
	local dir="${1%/*}"
	[ -n "$dir" ] || dir="/"
	if [ ! -d "$dir" ]; then
		printf '%s' "$1"
		return 0
	fi
	dir=$(physical_dir "$dir")
	case "$dir" in
		/) printf '/%s' "${1##*/}" ;;
		*) printf '%s/%s' "$dir" "${1##*/}" ;;
	esac
}

# unlisted_line rel message — the one line the agent sees for a file the
# non-concept-unlisted lint flagged. The glob list comes from the lint's own
# message (`... matches no [bundle] non_concepts glob (<globs>); add ...`), so
# the hook never parses the config.
unlisted_line() {
	local globs globs_text
	globs=$(printf '%s' "$2" | sed -n 's/.*non_concepts glob (\(.*\)); add frontmatter.*/\1/p')
	if [ -z "$globs" ]; then
		globs_text="allows it"
	else
		globs_text="says ($globs)"
	fi
	printf '%s: not a concept: it has no frontmatter type, and this bundle allows non-concept Markdown only where [bundle] non_concepts %s. Give it frontmatter with a type (okf-authoring), move it out of the bundle, or ask the human to add it to non_concepts.' "$1" "$globs_text"
}

# bash_write_targets command — prints candidate write targets ending in .md,
# one per line as `write<TAB>path` (authoring) or `edit<TAB>path` (edit-like),
# quotes stripped, unresolved. A heuristic over the command
# text, not a shell parser: redirections (> >> >|), tee args, the last arg of
# cp/mv/install, and the .md args of sed/perl in-place edits. Heredoc bodies
# are scanned like commands, so a body line can add a false candidate; that
# only costs a generated.by check on a real bundle file.
bash_write_targets() {
	local cmd="$1" seg word first="" rest kind

	# Redirections.
	printf '%s\n' "$cmd" | grep -oE '>>?\|?[[:space:]]*[^[:space:];&|<>()]+' |
		awk '{ kind = ($0 ~ /^>>/) ? "edit" : "write"; sub(/^>>?\|?[[:space:]]*/, ""); print kind "\t" $0 }' || true

	# Word-based commands, one pipeline/list segment at a time.
	printf '%s\n' "$cmd" | tr ';&|()' '\n\n\n\n\n' | while IFS= read -r seg; do
		# shellcheck disable=SC2086
		set -f
		# shellcheck disable=SC2086
		set -- $seg
		set +f
		first=""
		for word in "$@"; do
			case "$word" in
				[A-Za-z_]*=*) continue ;;
			esac
			first="${word##*/}"
			break
		done
		case "$first" in
			tee)
				kind=write
				for word in "$@"; do
					case "$word" in -a | --append | -[a-zA-Z]*a*) kind=edit ;; esac
				done
				for word in "$@"; do
					case "$word" in -* | tee | */tee) ;; *) printf '%s\t%s\n' "$kind" "$word" ;; esac
				done
				;;
			cp | mv | install)
				kind=write
				[ "$first" = mv ] && kind=edit
				rest=""
				for word in "$@"; do
					case "$word" in -*) ;; *) rest="$word" ;; esac
				done
				[ -n "$rest" ] && printf '%s\t%s\n' "$kind" "$rest"
				;;
			sed | perl)
				case " $seg " in
					*" -i"* | *" -pi"* | *" -ni"* | *" --in-place"*)
						for word in "$@"; do
							case "$word" in -*) ;; *) printf 'edit\t%s\n' "$word" ;; esac
						done
						;;
				esac
				;;
		esac
	done | awk -F'\t' -v OFS='\t' '{ gsub(/^["'"'"']|["'"'"']$/, "", $2); print }' | grep -E '\.md$' || true
}

# Defence in depth: the config's matcher already restricts to
# Write|Edit|Bash, but a hand-crafted or future dispatch is cheap to guard
# against too (VA/hooks/pre-tool-use/test-location.sh:41-45 does the same
# re-check). Copilot's own shell tool is `bash`; accept both spellings.
case "$tool_name" in
	Write | Edit)
		if [ -z "$file_path" ]; then
			hook_noop
			exit 0
		fi
		;;
	Bash | bash)
		bash_command=$(hook_input tool_input.command)
		# Cheap pre-filter BEFORE any subprocess: a command that never
		# mentions a .md file cannot write a concept.
		case "$bash_command" in
			*.md*) ;;
			*)
				hook_noop
				exit 0
				;;
		esac
		# Still before any subprocess: no .md write target, nothing to check
		# (`cat README.md`, `git log -- x.md`). write targets sort first so a
		# file both written and edited is reported once, as a write.
		bash_targets=$(bash_write_targets "$bash_command" | sort -r)
		if [ -z "$bash_targets" ]; then
			hook_noop
			exit 0
		fi
		;;
	*)
		hook_noop
		exit 0
		;;
esac

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
# Compare physical forms: the host may pass a symlinked path form while the
# context reports the other (okfit #486).
bundle_root=$(physical_dir "$bundle_root")
agent_actor=$(printf '%s' "$context_json" | jq -r '.actors.agent // ""')
generated_line="generated.by is missing: add \`generated:\` with \`by: ${agent_actor}\` to the frontmatter (okf-authoring rule 3); okfit sync fills in at and x-okfit-integrity.generated.body later"

# The Bash branch (okfit #223, #476): the generated.by check, plus one validate
# call for typeless authoring writes. Resolve each
# candidate against the project dir (the cwd after hook_cd_project), keep the
# existing concept files under bundle_root; authoring writes block like a
# Write, edit-like writes warn like an Edit.
if [ -n "$bash_command" ]; then
	gen_offenders=""
	typeless_targets=()
	typeless_rels=" "
	seen=" "
	while IFS=$'\t' read -r kind target; do
		[ -n "$target" ] || continue
		case "$target" in
			*[\$*?\[]*)
				# CLAUDE_PROJECT_DIR is the one variable resolved; anything
				# else dynamic is out of reach for a textual scan.
				case "$target" in
					'$CLAUDE_PROJECT_DIR/'*) target="$project_dir/${target#'$CLAUDE_PROJECT_DIR/'}" ;;
					'${CLAUDE_PROJECT_DIR}/'*) target="$project_dir/${target#'${CLAUDE_PROJECT_DIR}/'}" ;;
					*) continue ;;
				esac
				;;
		esac
		case "$target" in
			/*) ;;
			./*) target="$project_dir/${target#./}" ;;
			*) target="$project_dir/$target" ;;
		esac
		target=$(physical_path "$target")
		case "$target" in
			"$bundle_root"/*) ;;
			*) continue ;;
		esac
		rel="${target#"$bundle_root"/}"
		case "$rel" in
			index.md | */index.md | log.md | */log.md) continue ;;
		esac
		[ -f "$target" ] || continue
		case "$seen" in *" $rel "*) continue ;; esac
		seen="$seen$rel "
		# A typeless authoring write is validated below (okfit #476); an
		# edit-like write never is.
		if [ "$kind" = write ] && ! has_type "$target"; then
			typeless_targets+=("$target")
			typeless_rels="$typeless_rels$rel "
		fi
		# Only a concept (frontmatter with a top-level `type:`) carries generated.by;
		# a typeless file is judged by the non-concept-unlisted lint alone.
		if [ -n "$agent_actor" ] && has_type "$target" && ! has_generated_by "$target"; then
			gen_offenders="${gen_offenders}${kind}"$'\t'"${rel}"$'\n'
		fi
	done <<<"$bash_targets"

	# One validate call for every typeless authoring write; a hit on a
	# file blocks. A CLI without the lint, or any failure, yields no hit.
	unlisted_rels=" "
	unlisted_lines=""
	if [ "${#typeless_targets[@]}" -gt 0 ]; then
		set +e
		# shellcheck disable=SC2086
		bash_validate_json=$($cli_cmd validate --root "$project_root" "${typeless_targets[@]}" --format json --skip-provenance 2>/dev/null)
		set -e
		if printf '%s' "$bash_validate_json" | jq -e '.diagnostics | type == "array"' >/dev/null 2>&1; then
			while IFS=$'\t' read -r hit_file hit_message; do
				[ -n "$hit_file" ] || continue
				case "$typeless_rels" in *" $hit_file "*) ;; *) continue ;; esac
				case "$unlisted_rels" in *" $hit_file "*) continue ;; esac
				unlisted_rels="$unlisted_rels$hit_file "
				unlisted_lines="${unlisted_lines}$(unlisted_line "$hit_file" "$hit_message")"$'\n'
			done < <(printf '%s' "$bash_validate_json" | jq -r '.diagnostics[] | select(.source == "core.lint" and .code == "non-concept-unlisted") | [.file, .message] | @tsv')
		fi
	fi

	# Any authoring offender blocks, and the reason lists every offender. A
	# file the lint flagged is not a concept, so it carries no generated.by line.
	block_offenders="$unlisted_lines"
	warn_offenders=""
	while IFS=$'\t' read -r kind rel; do
		[ -n "$rel" ] || continue
		case "$unlisted_rels" in *" $rel "*) continue ;; esac
		if [ "$kind" = write ]; then
			block_offenders="${block_offenders}${rel}: ${generated_line}"$'\n'
		else
			warn_offenders="${warn_offenders}${rel}: ${generated_line}"$'\n'
		fi
	done <<<"$gen_offenders"
	all_offenders="${block_offenders}${warn_offenders}"
	if [ -n "$block_offenders" ]; then
		okfit_stop "${all_offenders%$'\n'}"
	elif [ -n "$warn_offenders" ]; then
		hook_context "${warn_offenders%$'\n'}"
	else
		hook_noop
	fi
	exit 0
fi

# An absolute path is compared in physical form (okfit #486); validate below
# gets the physical path too.
# A relative file_path is compared as given: it never matched the absolute
# bundle root, so it stays a no-op.
case "$file_path" in
	/*) file_path=$(physical_path "$file_path") ;;
esac

# The outside-the-bundle fast path (branch 7): a prefix test on physical forms, run
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

# Expensive call #2: the scoped validate pass. The bundle still loads whole
# (so link lints stay right); "$file_path" as a target scopes the reported
# diagnostics to the edited file. A target error (exit 64, e.g. the file
# vanished) falls into the "validate could not run" branch below. `--root` is the
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
validate_json=$($cli_cmd validate --root "$project_root" "$file_path" --format json --skip-provenance 2>/dev/null)
validate_rc=$?
# Version skew: a CLI from before `--root` (and file targets) rejects the call above with
# exit 64. Retry once with the pre-phase-4 form (the project root as the positional path,
# whole bundle); the bundle_relative filter below still scopes the findings to this file.
if [ "$validate_rc" -eq 64 ]; then
	validate_json=$($cli_cmd validate "$project_root" --format json --skip-provenance 2>/dev/null)
	validate_rc=$?
fi
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

# The non-concept-unlisted lint (okfit #476, R8): a typeless .md the config
# does not list. The lint's message carries the glob list.
unlisted_message=$(printf '%s' "$validate_json" | jq -r --arg f "$bundle_relative" \
	'[.diagnostics[] | select(.source == "core.lint" and .code == "non-concept-unlisted" and .file == $f)][0].message // ""')
unlisted_text=""
if [ -n "$unlisted_message" ]; then
	unlisted_text=$(unlisted_line "$bundle_relative" "$unlisted_message")
fi

# The generated.by check (okfit #74). okf-authoring rule 3 asks the agent
# to stamp `generated.by: <actors.agent>` on every concept it writes, and
# under one twelve-agent brief 109 of 268 concepts carried it: the rule in
# the prompt is not enough. This hook is the one place that knows a write
# came from the agent, so it reads the bytes on disk and checks the
# frontmatter block for a `generated:` mapping with a `by:` key. Only when
# the config sets actors.agent (an unset agent means the repo has not asked
# for attribution), only for a concept file (index.md and log.md are
# reserved and never carry generated; a file with no frontmatter `type:` is
# not a concept), and only when the file exists (the
# fixtures dispatch paths that were never written). The verdict joins the
# validate branches below: a Write authored the whole file and blocks
# until stamped; an Edit warns, since rule 3 says "meaningful changes" and
# a typo fix to a human-authored concept must not be force-attributed.
missing_generated_by=0
case "$bundle_relative" in
	index.md | */index.md | log.md | */log.md) ;;
	*.md)
		# A typeless file is not a concept (a listed README.md, an unlisted
		# stray): it is judged by the non-concept-unlisted lint, never here.
		if [ -n "$agent_actor" ] && [ -f "$file_path" ] && has_type "$file_path"; then
			if ! has_generated_by "$file_path"; then
				missing_generated_by=1
			fi
		fi
		;;
esac
# A file the lint flagged is not a concept: its line replaces generated.by.
if [ -n "$unlisted_text" ]; then
	missing_generated_by=0
fi

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
	if [ -n "$unlisted_text" ]; then
		reason="${reason}
  ${unlisted_text}"
	fi
	okfit_stop "$reason"
	exit 0
fi

# Branch 9a (okfit #476): a Write of a non-concept the config does not list
# blocks; an Edit warns.
if [ -n "$unlisted_text" ]; then
	if [ "$tool_name" = "Write" ]; then
		okfit_stop "$unlisted_text"
	else
		hook_context "$unlisted_text"
	fi
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
