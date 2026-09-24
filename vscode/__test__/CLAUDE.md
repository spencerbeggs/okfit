# Test Directory

This project uses `@vitest-agent/plugin` for test discovery. Tests live here in
`__test__/`, not co-located in `src/` or `server/`.

## Directory Structure

```text
__test__/
  assert-version.test.ts  # lib/assert-version.sh's tag-vs-package.json version check
  debounce.test.ts        # createDebouncer's trailing-edge coalescing, with fake timers
  manifest.test.ts        # Marketplace-manifest field and packaging assertions
  next-candidate.test.ts  # nextCandidate's keep/try-next decision
  resolve-server.test.ts  # resolveServer's candidate-list priority order, including the
                           # minServerVersion gate on workspace candidates, and outdatedNotice
  serial-queue.test.ts    # createSerialQueue's run/dispose serialization
  server-version.test.ts  # readWorkspaceServerVersion's pnpm-layout reader paths (direct,
                           # @okfit/plugin nested, .pnpm sibling, unresolvable bin, malformed json)
  status-model.test.ts    # statusFor's Language Status item text/detail/severity
  status-picks.test.ts    # statusPicks and conceptUriFrom
  tree-model.test.ts      # tree node shape helpers for the OKF Concepts view
```

## Rules

- **Classification is by filename, not location.** `*.e2e.test.ts` would be
  e2e regardless of which directory it sits in; none exist yet.
- **Never put test files in `src/` or `server/`.** All tests belong in
  `__test__/`.
- **Never inline large test data in test files.** Extract it to a
  `fixtures/` directory once one is needed.
