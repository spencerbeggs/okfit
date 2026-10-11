---
name: okf-authoring
description: "Nineteen imperative rules for writing and editing OKF concept files under a config: what is required, what to never touch, the actor and timestamp conventions, and where core's leniency differs from the spec's prose. Use when creating, editing, or reviewing a concept file's frontmatter or body inside an okf/ bundle. Trigger phrases -- \"write a new concept\", \"add frontmatter to this file\", \"should I set verified\", \"can I edit index.md\", \"what actor string do I use\", \"is generated.at required\"."
allowed-tools:
  - read
  - grep
---

# OKF Authoring

## Never write verified or integrity

Stated first, because it is the single highest-consequence rule: `verified`
records third-party or human confirmation, never authorship (spec §5.2), and
`integrity.verified` binds that confirmation to a digest of the concept as
the human saw it. An authoring agent that writes either is asserting a
confirmation it did not perform. This is the boundary `okfit:okf-docs`
restates in its own "What this agent does NOT do" section, and the one this
plugin's own `CLAUDE.md` already carries.

Editing a verified or stable concept is fine and expected: keep the facts
true. The edit shows up as the `verified-drift` lint (a signal at `warn`,
not a gate), and only a human re-verifies. Do not avoid editing, and do not
try to repair the drift yourself. `okfit query list --drifted` lists the drifted
concepts, and the MCP `get_concept` reports each one's `integrity`
(`current`, `drifted` or `none`) and, when drifted, why. Drift never changes
the concept's trust tier; it is a signal beside it. The whole `integrity` family is okfit's:
never hand-edit any key of it, because `okfit sync` writes
`integrity.generated` and `okfit verify` writes `integrity.verified`.

`okfit verify` is the one legitimate way these fields are ever written: a
human runs it directly, from their own shell. Never run it yourself, even
when asked, and never treat its existence as a loophole in this rule. When a
human has reviewed a draft and wants it settled, `okfit verify <id> --stable`
attests and promotes it in one write; that too is theirs to run. On a
drifted concept it shows the git diff since the last verification before it
asks to confirm, and `okfit verify --revoke <id>` removes the human's own
entries; both are theirs. The same holds for `okfit stale --verify`, which
re-attests stale concepts and rolls their `stale_after` forward: it exits 64
for an agent, so suggest the human run it instead of attempting it.

## The nineteen rules

1. Only `type` is required; never invent required fields beyond what the
   active profile and config declare (`concepts.required` --
   `PROFILES/SoftwareProject.ts:16` sets `["title", "description"]`).
2. Never add or edit `verified` or any `integrity` key; editing a verified
   concept is fine, and the edit surfaces as `verified-drift` for a human.
3. Stamp `generated.by` on meaningful changes; never the legacy
   `timestamp`. `okfit sync` writes `generated.at` and
   `integrity.generated.body`; never type either by hand.
4. `generated.by` uses the actor convention (`okf-spec`'s actor-convention
   section).
5. Every timestamp needs an explicit UTC offset (`CORE/Timestamp.ts:6`).
   That includes a concept's `stale_after`: on a concept it is an absolute
   ISO 8601 instant (`2026-12-11T00:00:00Z`), never the `90d` duration
   shorthand that the config's `[lifecycle].default_stale_after` takes.
   The two fields share a name and not a value type; `90d` on a concept
   fails `family-invalid`. Compute the instant from today plus the window.
6. Attribute a claim with a `[^id]` footnote keyed to `sources[].id`, never
   a `# Citations` list. The label must equal the id verbatim: a shortened
   `[^schema-org]` against `id: schema-org-package-json` fails
   `footnote-source-unknown` and `footnote-undefined` as a pair. A
   footnote is two halves and both are required: the inline `[^id]` use
   *and* a `[^id]: <resource>` definition line at the end of the body.
   An inline use with no definition fails `footnote-undefined`; a
   definition with no inline use is an orphan okfit does not lint but
   markdownlint's MD053 rejects. Every listed `sources[]` entry therefore
   either gets both halves or neither -- never a bare definition for a
   source the body does not cite.
7. `sources[].resource` is required per entry, and it is not only a path
   in this repository. Four forms are legal and none trips `broken-links`:
   a relative path (`../../packages/core/src/index.ts`); an absolute URL
   (`https://github.com/org/.github/blob/main/.github/workflows/release.yml`);
   a URI with any scheme for something addressable but not fetchable, such
   as a package (`npm:@savvy-web/silk/commitlint`) or a platform setting
   (`github:settings/security_analysis`); or a plain scope descriptor for
   a fact with no artifact at all. For a fact the owner stated, cite it
   as provenance rather than leaving `sources` empty: `resource:
   conversation with the repository owner`, `author: human:<id>`, and
   `last_modified` set to the date it was said. A concept with no
   `sources` block is indistinguishable from one nobody bothered to cite.
8. Prefer bundle-relative links; a broken link is tolerated, never "fixed"
   by inventing a target. A `broken-links` anchor diagnostic ends with a
   hint (`did you mean "#slug"?`, or the target's headings), so repair a
   bad anchor from that hint rather than guessing.
9. Only `index.md` and `log.md` are reserved, at any depth.
10. `index.md` carries no frontmatter except an optional root-only
    `okf_version`.
11. `log.md` entries are `## YYYY-MM-DD`, newest first.
12. For an Attested Computation: never author or edit the computation body
    or file; only parameter values.
13. Write `runtime` on an Attested Computation anyway -- core only lints its
    absence (D-20); do not lean on that leniency.
14. Always write `status` explicitly, never leave it absent: `draft` when the
    concept is unreviewed, `stable` when it is settled. A Decision follows its
    verified rule instead: write a new one `draft` and leave settling it to
    the human, who runs `okfit verify <id> --stable`; never write `stable` on
    a Decision yourself. Editing an already-stable Decision is allowed (the
    edit voids its verification as `verified-drift`) and leaves its `status`
    as it is.
15. Never author `verified` or `integrity` at all (rule 2). If you must
    read or quote an existing `verified`, it is a list of `{by, at}`.
16. Never delete an unrecognised frontmatter key -- extensions are legal
    (`CORE/OkfitConfig.ts:186-213` partitions unknown top-level *config*
    keys into `extensions`; the same tolerance posture applies to concept
    frontmatter).
17. Quote any YAML scalar that contains a colon followed by a space or an
    embedded double quote. `description: Use the node: protocol for
    built-ins` and `description: switch from "key: value" to "? key"` each
    make the whole block `frontmatter-unparseable`; write
    `description: "Use the node: protocol for built-ins"` and, for a value
    that itself contains double quotes, single-quote it:
    `description: 'switch from "key: value" to "? key"'`. Protocol-style
    identifiers (`node:`, `file:`, `workspace:`, `catalog:`, `portal:`)
    are exactly the words a software project's descriptions reach for, so
    quote defensively whenever a value names one.
18. Write for the repository's markdownlint config, which usually runs at
    pre-commit with `fix: true` and rewrites prose rather than reporting.
    Four traps recur: wrap a path in a code span inside a footnote
    definition (`` [^t]: `__test__/foo.test.ts` ``), since a bare `__test__`
    is "emphasis" MD050 turns into `**test**`; never start a line with
    `#N` (an issue number) -- `#90.` becomes an ATX heading and a wrapped
    `#1, #2` list becomes `# 2`; write `#90` mid-sentence or as
    `issue 90`; re-indent code lifted from a tab-indented source tree
    with spaces before fencing it, since MD010 rejects hard tabs inside
    fences; and lint scoped to the files you wrote, because an autofix
    pass over the whole bundle deletes another writer's still-unreferenced
    footnote definitions (rule 6) mid-dispatch.
19. A historical delta -- "was 1481 lines, now 19", "`STATE_token`
    deleted, not moved", a table of old names to new -- has no home in
    OKF by design: `log.md` is derived history and a concept describes
    the present. Keep a delta only inside the Context of the Decision it
    justifies, in one sentence; drop the rest rather than inventing a
    type for it.

## generated.at and integrity

Core treats `generated.at` as optional (`CORE/Generated.ts:29`); this
skill instructs writers to leave it unset until `okfit sync` supplies the
value rather than typing a guess (rule 3). `generated.by` stays required
(`CORE/Generated.ts:28`) and is always hand-stamped.

`integrity` is okfit's own top-level extension family, not an OKF v0.2
field, and it holds every digest. `integrity.generated.body` is the first 16
hex characters of a sha256 of the concept's normalized body, written by
`okfit sync` beside `generated.at`. It is what lets the `generated-at-drift`
lint survive a squash or rebase merge -- drift means the body changed after
the stamp, never that a merge minted a new author date. It replaces the
legacy `generated.body_sha256`, which `okfit sync` migrates away.
`integrity.verified` (`{ by, at, content }`) is written by `okfit verify`:
`content` digests the body plus the authored frontmatter, so a later edit
yields `verified-drift`. Never hand-write or hand-edit any `integrity` key:
a digest that does not match reports as drift, and an edited-but-uncommitted
body reports immediately rather than waiting for a commit. `okfit sync` is
the command that writes `generated.at`, deriving it from git history -- never
type it by hand, and never invent `generated.by` on its behalf (sync
never writes that key: design §3 step 5). `okfit verify` is a different
command -- it stamps `verified` and `integrity.verified`, a separate,
spec-independent family (spec §5.2).

## Actor prefixes

Core's generalised-but-linted rule is the operative one (D-18): any
`<prefix>:<id>` or `<producer>/<version>` decodes; an unknown prefix on
`generated.by`/`verified[].by` is lint `actor-prefix-unknown` at `info`
(`CORE/OkfitConfig.ts:280`), never a rejection.

## Tags and types vocabulary

The two vocabulary shapes are asymmetric: a `types.<Name>` declaration
carries `description`, `guidance`, `required`, `require_verified`, and a
`fields` sub-map (`CORE/OkfitConfig.ts:102-108`); a `tags.<name>`
declaration carries `description` **only** (`CORE/OkfitConfig.ts:114`).
Never invent a tag `guidance` -- the field does not exist for tags.

```toml
[types.Module]
description = "A deployable unit of the repository."
guidance = "Set kind and resource; link the concepts it depends on."
required = ["title", "description"]

[tags.architecture]
description = "Concerns the system's structural shape."
```

## Pointers

`packages/core/__test__/fixtures/bad/` holds 22 ready-made non-conformant
examples an author can open by name instead of having every failure mode
re-described in prose.
