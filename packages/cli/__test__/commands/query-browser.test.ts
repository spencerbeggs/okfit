import { assert, describe, it } from "@effect/vitest";
import { CliUi } from "@effected/cli-kit/ui";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import type { ConceptSummary } from "@okfit/engine";
import { Effect, Exit, Fiber, Option } from "effect";
import type { BrowserData, BrowserDetail } from "../../src/commands/query-browser-state.js";
import {
	bodyOf,
	browserInit,
	browserStep,
	cycle,
	detailHeader,
	filterRows,
	groupByType,
	visibleRows,
	wrapBody,
} from "../../src/commands/query-browser-state.js";

const summary = (id: string, type: string, extra: Partial<ConceptSummary> = {}): ConceptSummary => ({
	id,
	type,
	title: `Title ${id}`,
	description: null,
	status: "stable",
	raw_status: null,
	tags: [],
	path: `${id}.md`,
	tier: "unverified",
	integrity: "none",
	stale: false,
	staleness: "fresh",
	...extra,
});

const ROWS: ReadonlyArray<ConceptSummary> = [
	summary("decisions/a", "Decision", { tags: ["x"] }),
	summary("decisions/b", "Decision", { tags: ["y"] }),
	summary("modules/m", "Module", { tags: ["x", "y"] }),
];

const detail = (
	row: ConceptSummary,
	links: { out?: ReadonlyArray<string>; in?: ReadonlyArray<string> } = {},
	body = "body",
): BrowserDetail => ({
	summary: row,
	body,
	verified: [{ by: "human:ada", at: "2026-09-01T00:00:00Z" }],
	outgoing: (links.out ?? []).map((id) => ({ id, kind: "concept", title: `Title ${id}` })),
	incoming: (links.in ?? []).map((id) => ({ id, kind: "concept", title: `Title ${id}` })),
});

const DATA: BrowserData = {
	rows: ROWS,
	details: new Map([
		["decisions/a", detail(ROWS[0] as ConceptSummary, { out: ["modules/m"] })],
		["decisions/b", detail(ROWS[1] as ConceptSummary, { in: ["modules/m"] })],
		["modules/m", detail(ROWS[2] as ConceptSummary, { out: ["decisions/b"], in: ["decisions/a"] })],
	]),
};

describe("browser state", () => {
	it("filterRows applies type and tag together", () => {
		const ids = (type: string | null, tag: string | null) => filterRows(ROWS, { type, tag }).map((r) => r.id);
		assert.deepStrictEqual(ids(null, null), ["decisions/a", "decisions/b", "modules/m"]);
		assert.deepStrictEqual(ids("Decision", null), ["decisions/a", "decisions/b"]);
		assert.deepStrictEqual(ids(null, "y"), ["decisions/b", "modules/m"]);
		assert.deepStrictEqual(ids("Decision", "y"), ["decisions/b"]);
	});

	it("groups by type in first-seen order", () => {
		const rows = [ROWS[0], ROWS[2], ROWS[1]] as ReadonlyArray<ConceptSummary>;
		assert.deepStrictEqual(
			groupByType(rows).map((g) => [g.type, g.rows.map((r) => r.id)]),
			[
				["Decision", ["decisions/a", "decisions/b"]],
				["Module", ["modules/m"]],
			],
		);
	});

	it("cycles through the options and back to no filter", () => {
		assert.strictEqual(cycle(null, ["a", "b"]), "a");
		assert.strictEqual(cycle("a", ["a", "b"]), "b");
		assert.strictEqual(cycle("b", ["a", "b"]), null);
		assert.strictEqual(cycle(null, []), null);
	});

	it("moves the selection through the visible rows, clamped", () => {
		let state = browserInit(DATA);
		assert.strictEqual(state.current, "decisions/a");
		state = browserStep(state, "up");
		assert.strictEqual(state.current, "decisions/a");
		state = browserStep(browserStep(state, "down"), "down");
		assert.strictEqual(state.current, "modules/m");
		state = browserStep(state, "down");
		assert.strictEqual(state.current, "modules/m");
		assert.strictEqual(browserStep(state, "home").current, "decisions/a");
		assert.strictEqual(browserStep(browserStep(state, "home"), "end").current, "modules/m");
	});

	it("a filter keeps a visible selection and otherwise takes the first match", () => {
		let state = browserStep(browserInit(DATA), "cycleType");
		assert.strictEqual(state.type, "Decision");
		assert.strictEqual(state.current, "decisions/a");
		state = browserStep(browserStep(state, "cycleType"), "end");
		assert.strictEqual(state.type, "Module");
		assert.strictEqual(state.current, "modules/m");
		// The tag x holds modules/m, so the selection stays; clearing restores everything.
		state = browserStep(state, "cycleTag");
		assert.strictEqual(state.tag, "x");
		assert.strictEqual(state.current, "modules/m");
		const cleared = browserStep(state, "clearFilters");
		assert.strictEqual(cleared.type, null);
		assert.strictEqual(cleared.tag, null);
		// Cycling past the last type returns to no type filter.
		assert.strictEqual(browserStep(state, "cycleType").type, null);
		// A filter nothing satisfies leaves no selection.
		const none = browserStep(browserInit(DATA), "cycleTag");
		assert.strictEqual(none.tag, "x");
		assert.strictEqual(visibleRows(DATA, { type: "Module", tag: "nope" }).length, 0);
	});

	it("follows a neighbour, clearing filters that hide it", () => {
		let state = browserStep(browserInit(DATA), "cycleType");
		assert.strictEqual(state.type, "Decision");
		// decisions/a -> modules/m, hidden by the Decision filter.
		state = browserStep(state, { _tag: "tab", tab: "neighbours" });
		state = browserStep(state, "follow");
		assert.strictEqual(state.current, "modules/m");
		assert.strictEqual(state.type, null);
		assert.strictEqual(state.tab, "neighbours");
		// modules/m: outgoing decisions/b first, then incoming decisions/a.
		state = browserStep(state, { _tag: "neighbour", by: 1 });
		assert.strictEqual(browserStep(state, "follow").current, "decisions/a");
		state = browserStep(state, { _tag: "neighbour", by: 5 });
		assert.strictEqual(state.neighbour, 1);
	});

	it("follow does nothing on the detail tab or for a target that is not a concept", () => {
		const state = browserInit(DATA);
		assert.strictEqual(browserStep(state, "follow"), state);
		const ghost: BrowserData = {
			rows: ROWS,
			details: new Map([
				[
					"decisions/a",
					{ ...detail(ROWS[0] as ConceptSummary), outgoing: [{ id: "ghost", kind: "missing", title: null }] },
				],
			]),
		};
		const onTab = browserStep(browserInit(ghost), { _tag: "tab", tab: "neighbours" });
		assert.strictEqual(browserStep(onTab, "follow"), onTab);
	});

	it("scrolls the body within its bounds", () => {
		let state = browserInit(DATA);
		state = browserStep(state, { _tag: "scroll", by: 3, max: 2 });
		assert.strictEqual(state.scroll, 2);
		assert.strictEqual(browserStep(state, { _tag: "scroll", by: -9, max: 2 }).scroll, 0);
		// Moving to another concept resets the scroll.
		assert.strictEqual(browserStep(state, "down").scroll, 0);
	});

	it("strips frontmatter and wraps the body", () => {
		assert.strictEqual(bodyOf("---\ntype: A\n---\n\n# Hi\n"), "# Hi\n");
		assert.strictEqual(bodyOf("no frontmatter"), "no frontmatter");
		assert.deepStrictEqual(wrapBody("aaa bbb ccc", 8), ["aaa bbb", "ccc"]);
		assert.deepStrictEqual(wrapBody("one\n\ntwo", 20), ["one", "", "two"]);
	});
});

const start = (data: BrowserData, size = { columns: 120, rows: 30 }) =>
	Effect.gen(function* () {
		const { browserScreen } = yield* Effect.promise(() => import("../../src/commands/query-browser.js"));
		const session = yield* CliUiTest.session(size);
		const fiber = yield* Effect.forkScoped(CliUi.prompt(browserScreen(data)).pipe(Effect.provide(session.layer)));
		const screen = yield* session.next({ contains: "type: all" });
		return { session, fiber, screen };
	});

describe("browser screen", () => {
	it.effect("lists concepts by type and shows the detail of the first", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const { fiber, screen } = yield* start(DATA);
				const frame = yield* screen.plainFrame;
				assert.include(frame, "Decision");
				assert.include(frame, "Module");
				assert.include(frame, "decisions/b");
				assert.include(frame, "Detail");
				assert.include(frame, "Neighbours");
				assert.include(frame, "verified: human:ada at 2026-09-01T00:00:00Z");
				assert.include(frame, "3 of 3");
				yield* screen.press({ char: "q" });
				yield* Fiber.join(fiber);
			}),
		),
	);

	it.effect("t filters by type, moving the selection", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const { fiber, screen } = yield* start(DATA);
				yield* screen.press({ char: "t" }, { char: "t" });
				const frame = yield* screen.plainFrame;
				assert.include(frame, "type: Module");
				assert.include(frame, "1 of 3");
				assert.notInclude(frame, "decisions/b");
				yield* screen.press("escape");
				yield* Fiber.join(fiber);
			}),
		),
	);

	it.effect("switches to the neighbours tab and follows a neighbour", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const { fiber, screen } = yield* start(DATA);
				yield* screen.press("right");
				const tab = yield* screen.plainFrame;
				assert.include(tab, "outgoing (1)");
				yield* screen.press("enter");
				const frame = yield* screen.plainFrame;
				// Now on modules/m: it links out to decisions/b and in from decisions/a.
				assert.include(frame, "outgoing (1)");
				assert.include(frame, "incoming (1)");
				assert.include(frame, "decisions/b  Title decisions/b");
				yield* screen.press({ char: "q" });
				yield* Fiber.join(fiber);
			}),
		),
	);

	it.effect("q and Esc each resolve; Ctrl-C cancels as an interrupt", () =>
		Effect.scoped(
			Effect.gen(function* () {
				for (const key of [{ char: "q" }, "escape"] as const) {
					const { fiber, screen } = yield* start(DATA);
					yield* screen.press(key);
					assert.isTrue(Exit.isSuccess(yield* Fiber.await(fiber)));
				}
				const { fiber, screen } = yield* start(DATA);
				yield* screen.press("ctrl+c");
				const exit = yield* Fiber.await(fiber);
				assert.isTrue(Exit.isFailure(exit));
				assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("interrupt"));
			}),
		),
	);

	it.effect("strips escape sequences from titles, bodies and verified actors", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const evil = summary("decisions/a", "Decision", { title: "Evil\u001b[31mRED\u001b]0;pwned\u0007Title" });
				const data: BrowserData = {
					rows: [evil],
					details: new Map([
						[
							"decisions/a",
							{ ...detail(evil, {}, "line\u001b[2Jwiped\nnext"), verified: [{ by: "human:\u001b[1mx", at: "2026" }] },
						],
					]),
				};
				const { fiber, screen } = yield* start(data);
				const frame = yield* screen.plainFrame;
				assert.notInclude(frame, "pwned");
				assert.notInclude(frame, "\u001b");
				assert.include(frame, "EvilREDTitle");
				assert.include(frame, "linewiped");
				yield* screen.press({ char: "q" });
				yield* Fiber.join(fiber);
			}),
		),
	);

	it.effect("a non-interactive session fails NotInteractive without mounting", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const { browserScreen } = yield* Effect.promise(() => import("../../src/commands/query-browser.js"));
				const session = yield* CliUiTest.session({ interactive: false });
				const exit = yield* Effect.exit(CliUi.prompt(browserScreen(DATA)).pipe(Effect.provide(session.layer)));
				assert.isTrue(Exit.isFailure(exit));
				assert.strictEqual(yield* session.mounts, 0);
			}),
		),
	);
});

describe("detailHeader status (OKF 0.3 5.4)", () => {
	const header = (extra: Partial<ConceptSummary>): string =>
		detailHeader({
			summary: summary("a", "Decision", extra),
			body: "",
			verified: [],
			outgoing: [],
			incoming: [],
		}).join("\n");

	it("shows unknown(<raw>) for a status outside the vocabulary, the plain status otherwise", () => {
		assert.include(header({ status: "unknown", raw_status: "archived" }), "status: unknown(archived)  tier:");
		assert.include(header({ status: "draft" }), "status: draft  tier:");
	});
});
