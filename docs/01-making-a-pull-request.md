# Making a pull request

Follow these rules before you open a pull request against okfit. They cover where the work happens, how to write imports, where tests go, and how to write commits.

## Work on a branch

Never commit directly to `main`. Create a branch for each task and do the work there, so every change is reviewed before it merges into the branch other work builds on.

## Write imports the way okfit does

- End every relative import specifier in `.js`, even though the file on disk is `.ts`. ESM resolution needs the emitted extension.
- Prefix Node.js built-ins with `node:`.
- Put a type-only import in its own `import type` statement; never mix it into a value import.

```typescript
import { readFile } from "node:fs/promises";
import type { Concept } from "./concept.js";
import { load } from "./load.js";
```

Bare package specifiers such as `effect` are not affected. These rules apply to relative and built-in specifiers only.

## Put tests in `__test__/`

Every package keeps its tests under `__test__/`. Nothing under `src/` is a test file. This includes the Claude Code plugin, whose BATS suite lives in `plugins/claude-code/__test__/`. Reviewers enforce this rule; no tool checks it yet.

## Write the commit

- Start the subject in conventional-commit form: `type(scope): summary`. The type and scope decide which changelog section the commit lands in.
- End the message with a `Signed-off-by:` trailer. This is the DCO sign-off and is required on every commit.
- Write the message to a file and commit with `/silk:commit-create`'s contract rather than passing a raw message string.
