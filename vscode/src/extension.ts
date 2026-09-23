import { defineExtension, defineLogger, useDisposable, watch } from "reactive-vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { startClient } from "./client.js";
import { config } from "./config.js";
import { createSerialQueue } from "./serial-queue.js";

// reactive-vscode@1.0.2 ships defineLogger, not the useLogger name the extension
// used before it: defineLogger(name) builds a LogOutputChannel-backed logger,
// usable before activation, and is what the F5 probe (Task 1 Step 8) reads.
const logger = defineLogger("okfit");

const stopQuietly = async (client: LanguageClient | undefined): Promise<void> => {
	try {
		await client?.stop();
	} catch (error) {
		// Best-effort cleanup: a `stop()` failure (e.g. the process already
		// died) is not worth a user-facing dialog, only a log line.
		logger.error(error instanceof Error ? error : String(error));
	}
};

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
			show: logger.show,
		});
	};
	await start();
	// `watch`'s callback is not itself serialized against overlapping
	// invocations -- two rapid `okfit.lsp.serverPath` edits would otherwise
	// both call `stop()`/`start()` concurrently and leak a client. Every
	// restart (and the final stop on deactivation) goes through one
	// `SerialQueue` so at most one is ever in flight.
	const queue = createSerialQueue();
	useDisposable({ dispose: () => void queue.run(() => stopQuietly(client)) });
	// `config.serverPath` is read through `defineConfig`'s reactive proxy, so a
	// getter (not the proxy itself) is what `watch` tracks: re-reading the
	// setting inside the getter establishes the `onDidChangeConfiguration`
	// dependency (see config.ts).
	watch(
		() => config.serverPath,
		() => {
			// `startClient` already logs and shows a dialog on its own failure
			// (client.ts); swallow the rejection here so it does not also
			// surface as an unhandled promise rejection -- the next setting
			// change is this extension's only retry path, never automatic.
			void queue
				.run(async () => {
					await stopQuietly(client);
					await start();
				})
				.catch(() => undefined);
		},
	);
});
