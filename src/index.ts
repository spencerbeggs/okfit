/**
 * \@spencerbeggs/pnpm-module-template
 *
 * This is a template for creating a TypeScript module that can be published to npm.
 *
 * @packageDocumentation
 */

/**
 * A example interface demonstrating a simple structure with a numeric property.
 * @public
 */
export interface Foo {
	baz: number;
}

/**
 * A example class demonstrating a simple method that returns an object conforming to the Foo interface.
 * @public
 */
export class Bar {
	qux(): Foo {
		return { baz: 42 };
	}
}
