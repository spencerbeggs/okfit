---
type: Surface
title: Contributor guides
description: Numbered markdown guides in docs/, read in place on the forge, for people changing okfit itself.
status: draft
kind: repo
audience: contributors
resource: ../../docs
links_to: readme-root.md
generated:
  by: okfit/claude-code
  at: 2026-10-03T00:23:03Z
  body_sha256: 097d873032e7ab2cf15ccbfc66ebe1a0396800fe7b14729efbbfae0fb812c10e
tags:
  - docs
---

# Contributor guides

## Who reads this

People who are about to change okfit: humans and agents opening their first pull request. They read the files on the forge, so each page must read well as plain markdown.

## Required structure

Name every page `{NN}-{slug}.md`: a two-digit zero-padded number and a kebab-case slug, such as `01-making-a-pull-request.md`. Each page starts with an H1 and a one-paragraph summary, then states the rules a contributor must follow as steps or short sections. Do not keep a `README.md` table of contents until there are several guides.

## Other surfaces

Install and usage for people who consume the packages belong in each package README and on the documentation site. Design rationale belongs in the `okf/` bundle; link to it instead of restating it. Anything under `docs/superpowers/` is private planning material and is never a guide.

## Prose rules

- Use sentence case for every heading: `## Making a pull request`, not `## Making A Pull Request`. Acronyms and proper nouns keep their case.
- Put every paragraph and list item on one source line; never hard-wrap prose.
- Give every code fence a language identifier.
- State rules as instructions to the contributor, not as descriptions of current behavior.
- Never invent output, paths, identifiers or messages; take them from the source concepts or a command you ran.
- Never write a specific version number in prose.
- Match the language of the surrounding source and docs, and avoid filler, hype and AI-sounding phrasing.
