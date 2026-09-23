import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { makeServeHarness, notify, request } from "./utils/harness.js";

const BROKEN = (text: string) => text.replace("See [Beta](beta.md).", "See [Gamma](gamma.md).");
const readFixture = (root: string, relative: string) =>
	Effect.promise(() => import("node:fs/promises").then((fs) => fs.readFile(`${root}/${relative}`, "utf8")));

describe("serve", () => {
	it.live("initialize advertises full sync, save, and workspace folders, and names the server", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			const result = yield* h.initialize;
			assert.deepStrictEqual(result.capabilities.textDocumentSync, { openClose: true, change: 1, save: true });
			assert.deepStrictEqual(result.capabilities.workspace?.workspaceFolders, {
				supported: true,
				changeNotifications: true,
			});
			assert.strictEqual(result.serverInfo?.name, "okfit-lsp");
		}).pipe(Effect.scoped),
	);

	it.live(
		"opening a clean concept publishes nothing; breaking its link publishes one broken-links warning with a range",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness;
				yield* h.initialize;
				yield* h.open("okf/modules/alpha.md");
				assert.deepStrictEqual(yield* h.drainPublished, []);
				const text = yield* readFixture(h.root, "okf/modules/alpha.md");
				yield* h.change("okf/modules/alpha.md", BROKEN(text), 2);
				const published = yield* h.nextPublish();
				assert.strictEqual(published.uri, h.uriOf("okf/modules/alpha.md"));
				assert.strictEqual(published.diagnostics.length, 1);
				assert.strictEqual(published.diagnostics[0].code, "broken-links");
				assert.strictEqual(published.diagnostics[0].severity, 2);
				assert.strictEqual(published.diagnostics[0].source, "okfit");
				assert.isTrue(published.diagnostics[0].range.start.line > 0);
			}).pipe(Effect.scoped),
	);

	it.live("fixing the link publishes an empty list for the file", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			yield* h.initialize;
			const text = yield* readFixture(h.root, "okf/modules/alpha.md");
			yield* h.open("okf/modules/alpha.md", BROKEN(text));
			yield* h.nextPublish();
			yield* h.change("okf/modules/alpha.md", text, 2);
			const fixed = yield* h.nextPublish();
			assert.deepStrictEqual(fixed, { uri: h.uriOf("okf/modules/alpha.md"), diagnostics: [] });
		}).pipe(Effect.scoped),
	);

	it.live("a burst of changes publishes once", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			yield* h.initialize;
			const text = yield* readFixture(h.root, "okf/modules/alpha.md");
			yield* h.open("okf/modules/alpha.md");
			yield* h.change("okf/modules/alpha.md", BROKEN(text), 2);
			yield* h.change("okf/modules/alpha.md", BROKEN(text).replace("gamma", "delta"), 3);
			yield* h.change("okf/modules/alpha.md", BROKEN(text), 4);
			yield* h.nextPublish();
			yield* Effect.sleep("100 millis");
			assert.deepStrictEqual(yield* h.drainPublished, []);
		}).pipe(Effect.scoped),
	);

	it.live("editing beta so alpha's link breaks publishes against alpha, a file that is not open (cross-file)", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			yield* h.initialize;
			// alpha links beta.md#beta; renaming beta's only heading leaves that anchor dangling.
			const beta = yield* readFixture(h.root, "okf/modules/beta.md");
			yield* h.open("okf/modules/beta.md", beta.replace("# Beta\n", "# Renamed\n"));
			const published = yield* h.drainUntil((p) => p.uri === h.uriOf("okf/modules/alpha.md"));
			assert.ok(published.diagnostics.some((d) => d.code === "broken-links"));
		}).pipe(Effect.scoped),
	);

	it.live("closing an unsaved broken document reverts its diagnostics to the disk state", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			yield* h.initialize;
			const text = yield* readFixture(h.root, "okf/modules/alpha.md");
			yield* h.open("okf/modules/alpha.md", BROKEN(text));
			yield* h.nextPublish();
			yield* h.close("okf/modules/alpha.md");
			const reverted = yield* h.nextPublish();
			assert.deepStrictEqual(reverted, { uri: h.uriOf("okf/modules/alpha.md"), diagnostics: [] });
		}).pipe(Effect.scoped),
	);

	it.live(
		"a markdown file outside the bundle publishes nothing, while the same edit inside the bundle publishes (control)",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness;
				yield* h.initialize;
				yield* h.open("README.md", "# Not a concept\n\nSee [nowhere](nowhere.md).\n");
				yield* h.change("README.md", "# Not a concept\n\nSee [elsewhere](elsewhere.md).\n", 2);
				yield* Effect.sleep("100 millis");
				assert.deepStrictEqual(yield* h.drainPublished, []);
				yield* h.open(
					"okf/modules/beta.md",
					"---\ntype: Module\ntitle: Beta\nresource: beta.md\nkind: package\n---\n\n# Beta\n\nSee [nowhere](nowhere.md).\n",
				);
				const published = yield* h.drainUntil((p) => p.uri === h.uriOf("okf/modules/beta.md"));
				assert.ok(published.diagnostics.some((d) => d.code === "broken-links"));
			}).pipe(Effect.scoped),
	);

	it.live("a non-file URI is ignored and the server keeps answering", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			yield* h.initialize;
			yield* notify(h.client, "textDocument/didOpen", {
				textDocument: { uri: "untitled:Untitled-1", languageId: "markdown", version: 1, text: "# x" },
			});
			yield* Effect.sleep("50 millis");
			assert.deepStrictEqual(yield* h.drainPublished, []);
			yield* request(h.client, "shutdown", null);
			yield* notify(h.client, "exit", null);
			assert.deepStrictEqual(yield* Fiber.join(h.listening), { reason: "exit", shutdownReceived: true });
		}).pipe(Effect.scoped),
	);

	it.live("a workspace folder added at runtime is served; one removed stops being served", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			// initialize with NO folders, then add the fixture root.
			yield* request(h.client, "initialize", {
				processId: null,
				rootUri: null,
				capabilities: {},
				workspaceFolders: [],
			});
			yield* notify(h.client, "initialized", {});
			const text = yield* readFixture(h.root, "okf/modules/alpha.md");
			yield* h.open("okf/modules/alpha.md", BROKEN(text));
			yield* Effect.sleep("100 millis");
			assert.deepStrictEqual(yield* h.drainPublished, []);
			yield* notify(h.client, "workspace/didChangeWorkspaceFolders", {
				event: { added: [{ uri: h.uriOf(""), name: "project" }], removed: [] },
			});
			yield* h.change("okf/modules/alpha.md", BROKEN(text), 2);
			const published = yield* h.nextPublish();
			assert.strictEqual(published.diagnostics[0].code, "broken-links");
			// The publish above is the positive control: once the folder is removed, the same kind of edit publishes nothing.
			yield* notify(h.client, "workspace/didChangeWorkspaceFolders", {
				event: { added: [], removed: [{ uri: h.uriOf(""), name: "project" }] },
			});
			yield* h.change("okf/modules/alpha.md", BROKEN(text).replace("gamma", "delta"), 3);
			yield* Effect.sleep("100 millis");
			assert.deepStrictEqual(yield* h.drainPublished, []);
		}).pipe(Effect.scoped),
	);

	it.live(
		"shutdown drains queued document work: a publish for an edit sent just before shutdown precedes the response",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness;
				yield* h.initialize;
				const text = yield* readFixture(h.root, "okf/modules/alpha.md");
				yield* h.open("okf/modules/alpha.md", BROKEN(text));
				yield* request(h.client, "shutdown", null);
				// Taken without waiting: only publishes that arrived before the shutdown response count.
				const before = yield* h.pollPublished;
				assert.ok(
					before.some(
						(p) => p.uri === h.uriOf("okf/modules/alpha.md") && p.diagnostics.some((d) => d.code === "broken-links"),
					),
				);
				yield* notify(h.client, "exit", null);
				assert.deepStrictEqual(yield* Fiber.join(h.listening), { reason: "exit", shutdownReceived: true });
			}).pipe(Effect.scoped),
	);

	it.live("a bundle-level diagnostic publishes against the bundle's index.md", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness;
			yield* h.initialize;
			// Remove the Project concept from the overlay: software-project's "exactly one Project" is bundle-level.
			yield* h.open(
				"okf/project.md",
				"---\ntype: Module\ntitle: Was Project\nresource: project.md\nkind: package\n---\n\n# Was Project\n",
			);
			const published = yield* h.drainUntil((p) => p.uri === h.uriOf("okf/index.md"));
			assert.ok(published.diagnostics.length > 0);
		}).pipe(Effect.scoped),
	);
});
