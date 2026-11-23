import { Option } from "effect";
import type { LoadedBundle } from "./Bundle.js";

/** A parsed OKF version: the numeric `<major>.<minor>` pair (OKF 0.3 §12). @public */
export interface OkfVersionNumber {
	readonly major: number;
	readonly minor: number;
}

const VERSION = /^(\d+)\.(\d+)$/;

const LEGACY: OkfVersionNumber = { major: 0, minor: 2 };

/**
 * Reads and compares the OKF version a bundle declares. The declared version is the bundle-root
 * `index.md`'s `okf_version`; one gate, {@link OkfVersion.legacyFallbacks}, decides whether the v0.2
 * fallbacks apply. @public
 */
export class OkfVersion {
	private constructor() {}

	/** Parses exactly `<major>.<minor>` (no `v`, no patch, no whitespace); anything else is `None`. */
	static readonly parse = (raw: string): Option.Option<OkfVersionNumber> => {
		const match = VERSION.exec(raw);
		return match === null ? Option.none() : Option.some({ major: Number(match[1]), minor: Number(match[2]) });
	};

	/** Compares numerically, major first, so `0.10` sorts after `0.9`. */
	static readonly compare = (a: OkfVersionNumber, b: OkfVersionNumber): -1 | 0 | 1 =>
		a.major !== b.major ? (a.major < b.major ? -1 : 1) : a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1;

	/** The version the bundle-root `index.md` declares, as written; `None` when there is no root index or no `okf_version`. */
	static readonly declared = (bundle: LoadedBundle): Option.Option<string> =>
		Option.fromNullishOr(bundle.indexes.get("")?.okfVersion);

	/** True when nothing is declared or the declared version parses and is 0.2 or earlier; an unparsable version reads as current. */
	static readonly allowsLegacyFallbacks = (declared: Option.Option<string>): boolean =>
		Option.match(declared, {
			onNone: () => true,
			onSome: (raw) =>
				Option.match(OkfVersion.parse(raw), {
					onNone: () => false,
					onSome: (version) => OkfVersion.compare(version, LEGACY) <= 0,
				}),
		});

	/** Whether the v0.2 fallbacks apply to this bundle: `allowsLegacyFallbacks(declared(bundle))`. */
	static readonly legacyFallbacks = (bundle: LoadedBundle): boolean =>
		OkfVersion.allowsLegacyFallbacks(OkfVersion.declared(bundle));
}
