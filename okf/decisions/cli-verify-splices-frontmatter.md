---
type: Decision
title: okfit verify edits frontmatter by textual splice, never by re-serialisation
description: okfit verify edits a concept's verified list with one targeted byte-range splice into the original frontmatter text rather than decoding and re-emitting the whole document.
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-07T20:17:17Z
  body_sha256: 6cbbcdfb7291cafaa99c2653b3d1d3dee0d49085559bf5f0864919311abf0d47
status: stable
verified:
  - by: human:spencer
    at: 2026-09-07T20:49:06Z
---

# okfit verify edits frontmatter by textual splice, never by re-serialisation

## Context

`okfit verify` appends a `{ by, at }` entry to a hand-written concept's
`verified` list. Any whole-block re-serialisation through the YAML codec
reformats flow mappings, lists, and quoting, and core's `Concept` schema is
decode-only. The kit's `YamlFormat.modify` handles scalar leaves only and
renders a structured value as `"[object Object]"`.

## Decision

Parse the frontmatter with the kit's YAML document model, locate the
top-level `verified` pair or its absence, and apply exactly one
offset-range edit to the original bytes. Mirror the last entry's style,
convert a bare mapping to a one-entry list by re-indenting its own bytes,
and append a block-style key when `verified` is absent entirely. Detect the
document's newline convention, keep a byte-order mark when present, and
fail closed on aliases, anchors, merge keys, or any other shape the splice
does not recognise. Write via temp-and-rename beside the target file. The
splice modules are CLI-private.

## Alternatives rejected

Full re-serialisation via the `Concept` codec: it is decode-only and would
still reformat every other field on write. The kit's `YamlFormat.modify`:
it only rewrites scalar leaves and stringifies a structured `{ by, at }`
value as `"[object Object]"` rather than emitting a mapping.

## Consequences

Bytes outside the edited range are byte-for-byte identical to the input. A
bare-mapping `verified` becomes a list the first time `verify` touches it,
matching the `Verification` codec's always-a-list encode. The splice is
tested byte for byte against a fixture corpus covering CRLF, a BOM,
comments, and a real Decision copy. Two kit findings are recorded for the
`effected` repository.
