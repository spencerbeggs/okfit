import { basename } from "node:path";
import type { ConceptsResult } from "./tree/wire.js";

export interface StatusInput {
	readonly documentUri: string;
	readonly result: ConceptsResult;
	readonly diagnostics: ReadonlyArray<{ readonly uri: string; readonly severity: 0 | 1 | 2 | 3 }>;
}

export interface StatusView {
	readonly text: string;
	readonly detail: string;
	readonly severity: "error" | "warning" | "information";
}

const under = (rootUri: string, uri: string): boolean => uri === rootUri || uri.startsWith(`${rootUri}/`);

/** The Language Status view for `documentUri`, or undefined when no live bundle owns it. Pure. */
export const statusFor = (input: StatusInput): StatusView | undefined => {
	const bundle = input.result.bundles.find((b) => under(b.rootUri, input.documentUri));
	if (bundle === undefined) return undefined;
	const worst = Math.min(3, ...input.diagnostics.filter((d) => under(bundle.rootUri, d.uri)).map((d) => d.severity));
	const severity = worst === 0 ? "error" : worst === 1 ? "warning" : "information";
	const name = basename(bundle.root);
	return {
		text: bundle.profile === undefined ? `OKF: ${name}` : `OKF: ${name} (${bundle.profile})`,
		detail: bundle.root,
		severity,
	};
};
