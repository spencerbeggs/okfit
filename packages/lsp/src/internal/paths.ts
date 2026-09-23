/**
 * Shared path-prefix helper for `session/documents.ts` and
 * `session/registry.ts`. Not part of the public surface.
 *
 * @internal
 */

/**
 * Whether `path` is `root` itself or under it.
 *
 * @internal
 */
export const isUnder = (root: string, path: string): boolean => path === root || path.startsWith(`${root}/`);
