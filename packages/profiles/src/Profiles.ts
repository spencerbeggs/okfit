import { Option } from "effect";
import type { Profile } from "./Profile.js";
import { softwareProject } from "./SoftwareProject.js";

const REGISTRY: ReadonlyMap<string, Profile> = new Map([[softwareProject.name, softwareProject]]);

/**
 * The profile registry (P-38). No third-party registration in phase 1; the
 * `DEFAULTS < profile < file` merge is the CLI's (D-28).
 *
 * @public
 */
export class Profiles {
	private constructor() {}

	/** The `software-project` profile (spec 5). */
	static readonly softwareProject: Profile = softwareProject;

	/**
	 * `Option.none` for `"none"`, unknown names and anything not in
	 * `PROFILE_NAMES`; the CLI decides what that means (P-38). Exact match only.
	 */
	static readonly get = (name: string): Option.Option<Profile> => {
		const found = REGISTRY.get(name);
		return found === undefined ? Option.none() : Option.some(found);
	};
}
