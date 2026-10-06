# Contributor guide

Load when: writing or re-rendering a task-shaped contributor page in `docs/`, such as `docs/01-making-a-pull-request.md`, a release walkthrough or a local-setup guide.

A contributor guide is a procedure, not an essay. The reader has a terminal open and follows it top to bottom. One guide covers one task. The Surface body still overrides this skeleton.

## Skeleton

````markdown
# <Task as a verb phrase>

<One sentence: what the guide gets the reader to.>

## Who this is for

<The reader and what they should already know.>

## Before you start

- <Prerequisite: a tool and the version the repo requires, access, a clean checkout, an issue to work from.>

## Steps

1. <Imperative step.>

   ```bash
   <exact command>
   ```

2. <Next step.>

## What success looks like

<The observable end state: the passing check, the open PR, the expected command output.>

## Rules this guide follows

- <A rule the steps restate, linked to the page or bundle concept that owns it.>
````

## Filling it

- Take every command from the repository's scripts, `package.json` and existing contributor docs, and run it or verify it against the source before writing it down. Show only output that a command really printed.
- Number only the procedure. Prerequisites and rules are bullets.
- Put one action in each step. Say what the reader should see after a step whose result is not obvious.
- State each rule once, in the last section, and link to the page that owns it instead of restating the reasoning. If a rule has no owning page, report that gap rather than inventing a link.
- Name the file `{NN}-{slug}.md` and add it to the `docs/README.md` table of contents with the docs TOC steps.
