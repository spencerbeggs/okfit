import { describe, expect, it, vi } from "vitest";
import type { SaveableDocument } from "../src/save-after-apply.js";
import { saveAfterApply } from "../src/save-after-apply.js";

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

	it("opens the document itself, so a concept that was not open in an editor is saved too", async () => {
		const document = documentWith(true);
		const open = vi.fn(async () => document);
		await saveAfterApply({ applied: true }, "file:///closed.md", open);
		expect(open).toHaveBeenCalledOnce();
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
