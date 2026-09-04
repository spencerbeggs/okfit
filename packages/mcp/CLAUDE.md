# @okfit/mcp

The `okfit-mcp` bin. Phase 2 implements MCP tools over `@okfit/core`:
list concepts, get by ID, search by type or tag, graph neighbors, stale
report, and `describe_vocabulary`. Phase 1 ships only a stub bin so the
Claude Code plugin loader has a real target.

## Layout

```text
src/
  bin.ts      -- #!/usr/bin/env node entry; stub that exits 1
  index.ts    -- programmatic barrel
```

Tests live in `__test__/`. E2E tests spawn `dist/dev/pkg/bin/okfit-mcp.js`.
