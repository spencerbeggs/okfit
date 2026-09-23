import { defineExtension, defineLogger, useDisposable, watch } from "reactive-vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { startClient } from "./client.js";
import { config } from "./config.js";

// reactive-vscode@1.0.2 ships defineLogger, not the useLogger name the extension
// used before it: defineLogger(name) builds a LogOutputChannel-backed logger,
// usable before activation, and is what the F5 probe (Task 1 Step 8) reads.
const logger = defineLogger("okfit");

// `defineExtension`'s setup callback receives the ExtensionContext as its own
// parameter (verified against reactive-vscode@1.0.2's dist/index.d.ts) --
// simpler than reading the module-scoped `extensionContext` ref the task
// brief sketched, and accepts an async setup in this version, so `start()`
// is awaited directly rather than fired-and-forgotten.
export const { activate, deactivate } = defineExtension(async (context) => {
	logger.info(
		`okfit extension activated on Node ${process.versions.node}, Electron ${process.versions.electron ?? "n/a"}`,
	);
	let client: LanguageClient | undefined;
	const start = async () => {
		client = await startClient({
			extensionUri: context.extensionUri,
			settingPath: config.serverPath,
			log: logger.info,
		});
	};
	await start();
	useDisposable({ dispose: () => void client?.stop() });
	// `config.serverPath` is read through `defineConfig`'s reactive proxy, so a
	// getter (not the proxy itself) is what `watch` tracks: re-reading the
	// setting inside the getter establishes the `onDidChangeConfiguration`
	// dependency (see config.ts).
	watch(
		() => config.serverPath,
		async () => {
			await client?.stop();
			await start();
		},
	);
});
