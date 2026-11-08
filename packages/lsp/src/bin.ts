#!/usr/bin/env node

/**
 * LSP server entry point for okfit.
 *
 * @packageDocumentation
 */

// Linked workspace source needs tsx. A pnpm script loads it through nodeOptions, but a direct
// run of node_modules/.bin (a git hook, an MCP loader, an editor) does not, so a source bin
// registers it here before anything resolves a sibling's source. A built .js bin never takes
// this branch. The specifier is computed so the bundler cannot inline it.
if (import.meta.url.endsWith(".ts")) {
	const tsx = ["tsx", "esm", "api"].join("/");
	const { register } = (await import(tsx)) as { readonly register: () => void };
	register();
}

const { main } = await import("./main.js");

await main();
