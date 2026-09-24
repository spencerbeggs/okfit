import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { makeServeHarness, notify, request } from "./utils/harness.js";

const BROKEN = (text: string) => text.replace("See [Beta](beta.md).", "See [Gamma](gamma.md).");
const readFixture = (root: string, relative: string) =>
	Effect.promise(() => import("node:fs/promises").then((fs) => fs.readFile(`${root}/${relative}`, "utf8")));
const writeFixture = (root: string, relative: string, text: string) =>
	Effect.promise(() => import("node:fs/promises").then((fs) => fs.writeFile(`${root}/${relative}`, text, "utf8")));
const BROKEN_CONFIG = "[lint\nbroken = ";

describe("serve", () => {
	it.live("initialize advertises full sync, save, and workspace folders, and names the server", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness();
			const result = yield* h.initialize;
			assert.deepStrictEqual(result.capabilities.textDocumentSync, { openClose: true, change: 1, save: true });
			assert.deepStrictEqual(result.capabilities.workspace?.workspaceFolders, {
				supported: true,
				changeNotifications: true,
			});
			assert.deepStrictEqual(result.capabilities.codeActionProvider, {
				codeActionKinds: ["quickfix", "okfit.status", "okfit.verify"],
			});
			assert.deepStrictEqual(result.capabilities.executeCommandProvider, {
				commands: ["okfit.lsp.setStatus", "okfit.lsp.markVerified", "okfit.lsp.revalidate"],
			});
			assert.strictEqual(result.capabilities.inlayHintProvider, true);
			assert.strictEqual(result.serverInfo?.name, "okfit-lsp");
		}).pipe(Effect.scoped),
	);

	it.live("the harness answers a server-to-client applyEdit request by default, and a test can override it", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness();
			yield* h.initialize;
			const edit = { changes: {} };
			const defaultResult = yield* h.transport.sendRequest<unknown, { applied: boolean }>("workspace/applyEdit", {
				edit,
			});
			assert.deepStrictEqual(defaultResult, { applied: true });
			assert.deepStrictEqual(h.serverRequests, [{ method: "workspace/applyEdit", params: { edit } }]);

			h.onServerRequest<unknown, { applied: boolean; failureReason: string }>("workspace/applyEdit", () => ({
				applied: false,
				failureReason: "rejected",
			}));
			const overriddenResult = yield* h.transport.sendRequest<unknown, { applied: boolean; failureReason: string }>(
				"workspace/applyEdit",
				{ edit },
			);
			assert.deepStrictEqual(overriddenResult, { applied: false, failureReason: "rejected" });
			assert.deepStrictEqual(h.serverRequests, [
				{ method: "workspace/applyEdit", params: { edit } },
				{ method: "workspace/applyEdit", params: { edit } },
			]);
		}).pipe(Effect.scoped),
	);

	it.live(
		"opening a clean concept publishes nothing; breaking its link publishes one broken-links warning with a range",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness();
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
			const h = yield* makeServeHarness();
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
			// A debounce wide enough that a scheduling gap under load cannot split the three changes into two runs.
			const h = yield* makeServeHarness({ delay: "250 millis" });
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
			const h = yield* makeServeHarness();
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
			const h = yield* makeServeHarness();
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
				const h = yield* makeServeHarness();
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
			const h = yield* makeServeHarness();
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
			const h = yield* makeServeHarness();
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
			// Removing the folder clears what it had published (task 4's dispose behaviour): drain that
			// before asserting the later edit, now unserved, publishes nothing further.
			const cleared = yield* h.nextPublish();
			assert.deepStrictEqual(cleared, { uri: h.uriOf("okf/modules/alpha.md"), diagnostics: [] });
			yield* h.change("okf/modules/alpha.md", BROKEN(text).replace("gamma", "delta"), 3);
			yield* Effect.sleep("100 millis");
			assert.deepStrictEqual(yield* h.drainPublished, []);
		}).pipe(Effect.scoped),
	);

	it.live(
		"shutdown drains queued document work: a publish for an edit sent just before shutdown precedes the response",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness();
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

	it.live(
		"a folder whose config failed recovers on save once the config is fixed: nothing publishes while broken, the save publishes",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness();
				const config = yield* readFixture(h.root, ".okfit.toml");
				const alpha = yield* readFixture(h.root, "okf/modules/alpha.md");
				yield* writeFixture(h.root, ".okfit.toml", BROKEN_CONFIG);
				yield* h.initialize;
				// alpha is broken on disk and in the editor: a healthy folder would publish a broken-links warning for it.
				yield* writeFixture(h.root, "okf/modules/alpha.md", BROKEN(alpha));
				yield* h.open("okf/modules/alpha.md");
				yield* Effect.sleep("100 millis");
				assert.deepStrictEqual(yield* h.drainPublished, []);
				yield* writeFixture(h.root, ".okfit.toml", config);
				yield* h.save("okf/modules/alpha.md");
				const published = yield* h.drainUntil((p) => p.uri === h.uriOf("okf/modules/alpha.md"), "2 seconds");
				assert.ok(published.diagnostics.some((d) => d.code === "broken-links"));
			}).pipe(Effect.scoped),
	);

	it.live("a folder whose config failed recovers on a watched-file change under it once the config is fixed", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness();
			const config = yield* readFixture(h.root, ".okfit.toml");
			const alpha = yield* readFixture(h.root, "okf/modules/alpha.md");
			yield* writeFixture(h.root, ".okfit.toml", BROKEN_CONFIG);
			yield* h.initialize;
			yield* writeFixture(h.root, "okf/modules/alpha.md", BROKEN(alpha));
			yield* h.open("okf/modules/alpha.md");
			yield* Effect.sleep("100 millis");
			assert.deepStrictEqual(yield* h.drainPublished, []);
			yield* writeFixture(h.root, ".okfit.toml", config);
			yield* notify(h.client, "workspace/didChangeWatchedFiles", {
				changes: [{ uri: h.uriOf(".okfit.toml"), type: 2 }],
			});
			const published = yield* h.drainUntil((p) => p.uri === h.uriOf("okf/modules/alpha.md"), "2 seconds");
			assert.ok(published.diagnostics.some((d) => d.code === "broken-links"));
		}).pipe(Effect.scoped),
	);

	it.live(
		"okfit/bundleChanged notifies after a revalidate publishes, and again with reason dropped once the folder is removed",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness();
				yield* h.initialize;
				const text = yield* readFixture(h.root, "okf/modules/alpha.md");
				yield* h.open("okf/modules/alpha.md", BROKEN(text));
				const published = yield* h.nextPublish();
				assert.strictEqual(published.uri, h.uriOf("okf/modules/alpha.md"));
				const revalidated = yield* h.nextNotification((n) => n.method === "okfit/bundleChanged");
				assert.deepStrictEqual(revalidated.params, { rootUri: h.uriOf("okf"), reason: "revalidated" });

				yield* notify(h.client, "workspace/didChangeWorkspaceFolders", {
					event: { added: [], removed: [{ uri: h.uriOf(""), name: "project" }] },
				});
				// Dropping the session's last folder clears what it had published (task 4's dispose behaviour).
				yield* h.nextPublish();
				const dropped = yield* h.nextNotification((n) => n.method === "okfit/bundleChanged");
				assert.deepStrictEqual(dropped.params, { rootUri: h.uriOf("okf"), reason: "dropped" });
			}).pipe(Effect.scoped),
	);

	it.live("a bundle-level diagnostic publishes against the bundle's index.md", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness();
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

	it.live("okfit/concepts warms up the bundle when no document has been opened yet", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness();
			yield* h.initialize;
			// No didOpen: the folder's session has never been resolved before this request.
			const result = yield* request<{ readonly bundles: ReadonlyArray<{ readonly root: string }> }>(
				h.client,
				"okfit/concepts",
				{},
			);
			assert.isTrue(result.bundles.length > 0);
			const revalidated = yield* h.nextNotification((n) => n.method === "okfit/bundleChanged");
			assert.deepStrictEqual(revalidated.params, { rootUri: h.uriOf("okf"), reason: "revalidated" });
		}).pipe(Effect.scoped),
	);

	it.live(
		"okfit/concepts re-warms a bundle root after a config-change rebuild forgets it (production forgetWarmup wiring)",
		() =>
			Effect.gen(function* () {
				// Proves server.ts's own conceptsBox wiring -- registerConcepts's forgetWarmup threaded into
				// the registry's onDispose -- not just the test fixture's copy of it (concepts.test.ts).
				const h = yield* makeServeHarness();
				yield* h.initialize;

				// Warm the root once via okfit/concepts (no document ever opened).
				const first = yield* request<{ readonly bundles: ReadonlyArray<{ readonly root: string }> }>(
					h.client,
					"okfit/concepts",
					{},
				);
				assert.isTrue(first.bundles.length > 0);
				yield* h.nextNotification((n) => n.method === "okfit/bundleChanged");

				// Break the bundle root on disk, then touch the config to force a rebuild (configChanged is
				// true for any change to a config file, regardless of content). registry.rebuild disposes the
				// warmed session -- forgetWarmup runs here, if server.ts wired it -- and installs a fresh one;
				// diagnostics.ts's onWatchedFiles schedules a full revalidate on that fresh session directly
				// (independent of registerConcepts's own warm-up guard), and it fails, since the bundle root
				// is now gone. Drain that notification: it is not the evidence this test needs.
				yield* Effect.promise(() =>
					import("node:fs/promises").then((fs) => fs.rm(`${h.root}/okf`, { recursive: true })),
				);
				const config = yield* readFixture(h.root, ".okfit.toml");
				yield* writeFixture(h.root, ".okfit.toml", `${config}\n`);
				yield* notify(h.client, "workspace/didChangeWatchedFiles", {
					changes: [{ uri: h.uriOf(".okfit.toml"), type: 2 }],
				});
				yield* h.nextNotification((n) => n.method === "okfit/bundleChanged", "2 seconds");

				// A second okfit/concepts request. With forgetWarmup wired, the rebuild above forgot this
				// root, so this request treats it as unwarmed and schedules its own revalidate attempt -- a
				// second "revalidated" notification beyond the rebuild's own. Without that wiring the root
				// would still read as warmed from the very first request, and this would time out.
				yield* request(h.client, "okfit/concepts", {});
				const rewarmed = yield* h.nextNotification((n) => n.method === "okfit/bundleChanged", "2 seconds");
				assert.deepStrictEqual(rewarmed.params, { rootUri: h.uriOf("okf"), reason: "revalidated" });
			}).pipe(Effect.scoped),
	);
});
