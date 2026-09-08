---
name: okf-authoring
description: >-
  Sixteen imperative rules for writing and editing OKF concept files under a
  config: what is required, what to never touch, the actor and timestamp
  conventions, and where core's leniency differs from the spec's prose. Use
  when creating, editing, or reviewing a concept file's frontmatter or body
  inside an okf/ bundle. Trigger phrases -- "write a new concept", "add
  frontmatter to this file", "should I set verified", "can I edit index.md",
  "what actor string do I use", "is generated.at required".
allowed-tools: Read, Grep
---

# OKF Authoring

## Never touch verified

Stated first, because it is the single highest-consequence rule: `verified`
records third-party or human confirmation, never authorship (spec §5.2). An
authoring agent that adds or edits `verified` is asserting a confirmation it
did not perform. This is the boundary `okf-docs` restates in its own "What
this agent does NOT do" section, and the one this plugin's own `CLAUDE.md`
already carries today.

`okfit verify` is the one legitimate way this field is ever written: a human
runs it directly, from their own shell. Never run it yourself, even when
asked, and never treat its existence as a loophole in this rule.

## The sixteen rules

1. Only `type` is required; never invent required fields beyond what the
   active profile and config declare (`concepts.required` --
   `PROFILES/SoftwareProject.ts:16` sets `["title", "description"]`).
2. Never add or edit `verified`.
3. Stamp `generated.by` on meaningful changes; never the legacy
   `timestamp`. `okfit sync` writes `generated.at`; never type it by hand.
4. `generated.by` uses the actor convention (`okf-spec`'s actor-convention
   section).
5. Every timestamp needs an explicit UTC offset (`CORE/Timestamp.ts:6`).
6. Attribute a claim with a `[^id]` footnote keyed to `sources[].id`, never
   a `# Citations` list.
7. `sources[].resource` is required per entry -- a path or a scope
   descriptor.
8. Prefer bundle-relative links; a broken link is tolerated, never "fixed"
   by inventing a target.
9. Only `index.md` and `log.md` are reserved, at any depth.
10. `index.md` carries no frontmatter except an optional root-only
    `okf_version`.
11. `log.md` entries are `## YYYY-MM-DD`, newest first.
12. For an Attested Computation: never author or edit the computation body
    or file; only parameter values.
13. Write `runtime` on an Attested Computation anyway -- core only lints its
    absence (D-20); do not lean on that leniency.
14. Absent `status` reads as `stable`; write `draft` only when genuinely
    unreviewed, never `stable` defensively.
15. When authoring new `verified` (rare -- rule 2 says don't), always emit
    list form.
16. Never delete an unrecognised frontmatter key -- extensions are legal
    (`CORE/OkfitConfig.ts:186-213` partitions unknown top-level *config*
    keys into `extensions`; the same tolerance posture applies to concept
    frontmatter).

## generated.at

Core treats `generated.at` as optional (`CORE/Generated.ts:11`); this
skill instructs writers to leave it unset until `okfit sync` supplies the
value rather than typing a guess (rule 3). `generated.by` stays required
(`CORE/Generated.ts:10`) and is always hand-stamped. `okfit sync` is the
command that writes `generated.at`, deriving it from git history -- never
type it by hand, and never invent `generated.by` on its behalf (sync
never writes that key: design §3 step 5). `okfit verify` is a different
command entirely -- it stamps only `verified`, a separate,
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
