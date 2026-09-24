import { defineConfig } from "tsdown";
import lspPkg from "../packages/lsp/package.json" with { type: "json" };
import pkg from "./package.json" with { type: "json" };

export default defineConfig([
	{
		entry: { extension: "src/extension.ts" },
		format: "esm",
		platform: "node",
		target: "node22",
		outDir: "dist",
		external: ["vscode"],
		sourcemap: true,
		clean: true,
		dts: false,
		// package.json is "type": "module", so a plain .js extension is unambiguous;
		// tsdown's platform:"node" default (fixedExtension: true) would otherwise force
		// .mjs regardless, which does not match the "main": "./dist/extension.js" manifest.
		fixedExtension: false,
		define: {
			"process.env.__OKFIT_LSP_VERSION__": JSON.stringify(lspPkg.version),
		},
	},
	{
		entry: { server: "server/main.ts" },
		format: "esm",
		platform: "node",
		target: "node22",
		outDir: "dist",
		// Bundle everything, Effect included: the .vsix ships no node_modules.
		noExternal: [/.*/],
		sourcemap: true,
		clean: false,
		dts: false,
		fixedExtension: false,
		// @okfit/lsp's main.ts uses dynamic import() on purpose (crash guards installed
		// before the server graph loads), which would otherwise split the bundle into
		// sibling chunk files; .vscodeignore only allow-lists dist/server.js itself.
		outputOptions: { codeSplitting: false },
		define: {
			"process.env.__PACKAGE_VERSION__": JSON.stringify(lspPkg.version),
			"process.env.__EXTENSION_VERSION__": JSON.stringify(pkg.version),
		},
	},
]);
