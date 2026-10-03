import { describe, expect, it, vi } from "vitest";
import type { SaveableDocument } from "../src/save-after-apply.js";
import { finishEditCommand, saveAfterApply } from "../src/save-after-apply.js";

const documentWith = (isDirty: boolean, saved = true): SaveableDocument & { save: ReturnType<typeof vi.fn> } => ({
	isDirty,
	save: vi.fn(async () => saved),
});

describe("saveAfterApply", () => {
	it("saves a dirty document once the server's edit was applied", async () => {
		const document = documentWith(true);
		const open = vi.fn(async () => document);
		expect(await saveAfterApply({ applied: true }, "file:///a.md", open)).toBe("saved");
		expect(open).toHaveBeenCalledWith("file:///a.md");
		expect(document.save).toHaveBeenCalledOnce();
	});

	it("touches nothing when the client refused the edit", async () => {
		const open = vi.fn(async () => documentWith(true));
		expect(await saveAfterApply({ applied: false }, "file:///a.md", open)).toBe("skipped");
		expect(open).not.toHaveBeenCalled();
	});

	it("does not save a document that is not dirty", async () => {
		const document = documentWith(false);
		expect(await saveAfterApply({ applied: true }, "file:///a.md", async () => document)).toBe("skipped");
		expect(document.save).not.toHaveBeenCalled();
	});

	it("reports a save the editor declined", async () => {
		const document = documentWith(true, false);
		expect(await saveAfterApply({ applied: true }, "file:///a.md", async () => document)).toBe("failed");
	});

	it("reports a thrown open as failed instead of throwing", async () => {
		const open = vi.fn(async (): Promise<SaveableDocument> => {
			throw new Error("gone");
		});
		expect(await saveAfterApply({ applied: true }, "file:///a.md", open)).toBe("failed");
	});
});

describe("finishEditCommand", () => {
	const deps = (document: SaveableDocument) => ({
		open: vi.fn(async () => document),
		showError: vi.fn(),
		showWarning: vi.fn(),
	});

	it("opens the string URI and saves the opened document", async () => {
		const document = documentWith(true);
		const d = deps(document);
		await finishEditCommand({ applied: true }, ["file:///a.md", "stable"], "fallback", d);
		expect(d.open).toHaveBeenCalledWith("file:///a.md");
		expect(document.save).toHaveBeenCalledOnce();
		expect(d.showError).not.toHaveBeenCalled();
		expect(d.showWarning).not.toHaveBeenCalled();
	});

	it("saves nothing when the first argument is not a string", async () => {
		const document = documentWith(true);
		const d = deps(document);
		await finishEditCommand({ applied: true }, [{ uri: "file:///a.md" }], "fallback", d);
		expect(d.open).not.toHaveBeenCalled();
		expect(document.save).not.toHaveBeenCalled();
	});

	it("warns when the save fails", async () => {
		const d = deps(documentWith(true, false));
		await finishEditCommand({ applied: true }, ["file:///a.md"], "fallback", d);
		expect(d.showWarning).toHaveBeenCalledOnce();
	});

	it("reports the failure reason and does not save when the edit was not applied", async () => {
		const document = documentWith(true);
		const d = deps(document);
		await finishEditCommand({ applied: false, failureReason: "nope" }, ["file:///a.md"], "fallback", d);
		expect(d.showError).toHaveBeenCalledWith("nope");
		expect(d.open).not.toHaveBeenCalled();
		expect(document.save).not.toHaveBeenCalled();
	});

	it("falls back to the fallback message when no reason is given", async () => {
		const d = deps(documentWith(true));
		await finishEditCommand({ applied: false }, ["file:///a.md"], "fallback", d);
		expect(d.showError).toHaveBeenCalledWith("fallback");
	});
});
