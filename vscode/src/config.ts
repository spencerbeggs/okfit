import { defineConfig } from "reactive-vscode";

// reactive-vscode@1.0.2 ships `defineConfig` (singular): a reactive proxy over
// one WorkspaceConfiguration section, not the schema-driven `defineConfigs`
// (plural) the task brief sketched -- that export does not exist in this
// version (verified against node_modules/.pnpm/reactive-vscode@1.0.2's
// dist/index.d.ts). Reading a property off the proxy inside a reactive scope
// (a `watch` getter, a `computed`) tracks `workspace.onDidChangeConfiguration`
// for this extension's own `okfit.lsp` section; only `serverPath` is read
// through it. `trace.server` is read by vscode-languageclient itself, since
// the client id is `okfit.lsp` (Task 3 brief, decision 3).
export const config: { serverPath: string } = defineConfig<{ serverPath: string }>("okfit.lsp");
