---
name: docs-humanize
description: Rewrites a docs file to remove AI-sounding prose (promotional phrasing, filler, -ing analyses, elegant variation, copula avoidance) without changing facts, code or links. Use when a README or docs page reads machine-written, or as the final pass after rendering a page. Trigger phrases -- "humanize this doc", "make this sound less like AI", "tighten the prose".
allowed-tools:
  - read
  - edit
---

# docs-humanize

A rewrite pass over one file. It changes voice and rhythm only.

## Never change

Facts, numbers, version ranges, code blocks, inline code, link targets, headings' meaning, and badge blocks. If a sentence cannot be improved without changing what it claims, leave it. The Surface body, when one applies, still overrides this skill's taste.

## Process

1. Read the file. Read `references/humanizer-pairs.md` for before/after exemplars.
2. First pass: list every tell, grouped as promotional phrasing, inflated significance, -ing analyses, filler, elegant variation, copula avoidance ("serves as" for "is"), knowledge-cutoff disclaimers, chatbot pleasantries, false ranges, rule-of-three forcing.
3. Second pass: rewrite each flagged passage to be direct and specific, with varied rhythm. Same word for the same thing.
4. Third pass: re-read and ask what still reads as machine-written; revise it.

## House style

- Em dashes are allowed and encouraged for parenthetical asides. Do not flag or remove them.
- A paragraph or list item is one source line; no hard wraps.
- Sentence-case headings; every code fence names a language.

Report the count of tells per category and a one-line summary of the voice changes.
