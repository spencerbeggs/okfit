#!/usr/bin/env bats
# agent-skill-registration.bats — pins WHERE each skill is registered in
# okf-docs.md's YAML frontmatter, not merely that the name appears
# somewhere in it, and that every SKILL.md carries the frontmatter M-32
# requires.
#
# Adapted from
# effected/plugins/claude-code/__test__/agent-skill-registration.bats
# (_skills_block/_tools_block copied unchanged). This exists because a
# presence check cannot catch a key in the wrong array: a skill listed
# under tools: instead of skills: would satisfy `grep -q okf-spec` while
# never being preloaded by the agent (DOCS/subagents.md:184). The
# assertion has to discriminate the KEY, so these extractors pull the
# skills: block specifically and search only inside it.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
AGENTS="$PLUGIN_ROOT/agents"

# _skills_block agent_file — prints the list items under the top-level
# `skills:` key, stopping at the next top-level key. Anything under
# `tools:` (or any other key) is excluded by construction.
_skills_block() {
	awk '
		/^skills:[[:space:]]*$/ { inblock = 1; next }
		/^[A-Za-z_-]+:/         { inblock = 0 }
		inblock && /^[[:space:]]*-[[:space:]]+/ {
			sub(/^[[:space:]]*-[[:space:]]+/, "")
			print
		}
	' "$1"
}

# _tools_block agent_file — same, for the `tools:` key.
_tools_block() {
	awk '
		/^tools:[[:space:]]*$/ { inblock = 1; next }
		/^[A-Za-z_-]+:/        { inblock = 0 }
		inblock && /^[[:space:]]*-[[:space:]]+/ {
			sub(/^[[:space:]]*-[[:space:]]+/, "")
			print
		}
	' "$1"
}

# _frontmatter file — prints the lines strictly between the two `---`
# fences that open a SKILL.md or an agent .md.
_frontmatter() {
	awk 'BEGIN { fences = 0 } /^---[[:space:]]*$/ { fences++; next } fences == 1 { print }' "$1"
}

# _field_value file field — prints a single scalar frontmatter field's
# value, folding a `>-` block scalar's continuation lines onto one
# space-joined line. Empty when the field is absent or its value is
# blank, so callers can test with `[ -n "$(_field_value ...)" ]`.
_field_value() {
	local file="$1" field="$2"
	awk -v key="^${field}:" '
		$0 ~ key {
			active = 1
			line = $0
			sub(key "[[:space:]]*", "", line)
			buf = line
			next
		}
		/^[A-Za-z_-]+:/ { active = 0 }
		active && /^[[:space:]]+/ {
			line = $0
			sub(/^[[:space:]]+/, "", line)
			buf = buf " " line
		}
		END { gsub(/^[[:space:]]+|[[:space:]]+$/, "", buf); print buf }
	' < <(_frontmatter "$file")
}

@test "okf-docs.md declares a non-empty skills block" {
	run _skills_block "$AGENTS/okf-docs.md"
	[ "$status" -eq 0 ]
	[ -n "$output" ] || {
		echo "okf-docs.md has an empty or missing skills: block" >&2
		return 1
	}
}

@test "all six skill names are registered under skills:" {
	local expected="okf-spec okf-authoring okf-config okf-context okf-finalize npm-readme"
	for skill in $expected; do
		_skills_block "$AGENTS/okf-docs.md" | grep -qx -- "$skill" || {
			echo "okf-docs.md does not list $skill under skills:" >&2
			return 1
		}
	done
}

@test "no skill name leaks into okf-docs.md's tools: block" {
	# A skill in tools: is the exact bug this file exists to catch — it
	# would still satisfy a test that merely greps the file for the name.
	for skill in "$PLUGIN_ROOT"/skills/*/; do
		name="$(basename "$skill")"
		if _tools_block "$AGENTS/okf-docs.md" | grep -qx -- "$name"; then
			echo "okf-docs.md lists the skill '$name' under tools:" >&2
			return 1
		fi
	done
}

@test "every skill okf-docs.md names has a SKILL.md on disk" {
	local count=0
	while IFS= read -r name; do
		[ -n "$name" ] || continue
		count=$((count + 1))
		[ -f "$PLUGIN_ROOT/skills/$name/SKILL.md" ] || {
			echo "okf-docs.md names skill '$name', which has no SKILL.md" >&2
			return 1
		}
	done < <(_skills_block "$AGENTS/okf-docs.md")
	# Cross-checked against a fresh count so this assertion cannot pass
	# vacuously on an empty skills: block — that failure mode is already
	# caught above, but this test should fail for ITS OWN reason too.
	[ "$count" -gt 0 ] || {
		echo "okf-docs.md's skills: block yielded zero names" >&2
		return 1
	}
}

@test "the agent roster is exactly okf-docs" {
	local found
	found="$(cd "$AGENTS" && ls -1 *.md | sed 's/\.md$//' | sort | tr '\n' ' ')"
	[ "$found" = "okf-docs " ] || {
		echo "agent roster is '$found', expected 'okf-docs'" >&2
		return 1
	}
}

@test "every skills/*/SKILL.md has non-empty name and description frontmatter" {
	for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
		name="$(_field_value "$skill" name)"
		desc="$(_field_value "$skill" description)"
		[ -n "$name" ] || {
			echo "$skill has empty or missing name: frontmatter" >&2
			return 1
		}
		[ -n "$desc" ] || {
			echo "$skill has empty or missing description: frontmatter" >&2
			return 1
		}
	done
}

@test "every skill's frontmatter name equals its directory name" {
	for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
		dir="$(basename "$(dirname "$skill")")"
		name="$(_field_value "$skill" name)"
		[ "$name" = "$dir" ] || {
			echo "$skill: frontmatter name '$name' does not match directory '$dir'" >&2
			return 1
		}
	done
}
