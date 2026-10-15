/**
 * Hand-written typings for @alexify/protoarray/standalone: a schema's codec as module source,
 * for runtimes that forbid compiling source text.
 */

import type { AnySchema, Definition, EncodeError } from './index.js';

export interface SourceOptions {
  /**
   * `'import'` (the default): the module imports this package and exports Schema instances built
   * with `{ compiled }`. `'inline'`: the module carries its own runtime and imports nothing.
   */
  readonly runtime?: 'import' | 'inline';
  /** `'cjs'` (the default) or `'esm'`. */
  readonly format?: 'cjs' | 'esm';
}

/** What an inline module exports for each schema. */
export interface StandaloneSchema {
  readonly name: string;
  readonly id: string;
  readonly keys: readonly string[];
  readonly layout: string;
  readonly backend: 'standalone';
  encode(value: unknown): unknown;
  decode(array: unknown, options?: { readonly strict?: boolean }): unknown;
  stringify(value: unknown): string;
  parse(text: string, options?: { readonly strict?: boolean }): unknown;
  check(value: unknown): EncodeError | null;
  toString(): string;
}

/**
 * The source of a module with the generated code of the schemas given and every schema they
 * reach: one schema as the default export, or a record of them as named exports.
 */
export function toSource(
  schemas: AnySchema | Readonly<Record<string, AnySchema>>,
  options?: SourceOptions,
): string;

/** What modules of the `import` runtime use. Not for direct use. */
export const runtime: {
  readonly types: unknown;
  readonly fail: unknown;
  readonly nest: unknown;
  readonly refuse: unknown;
  slot(target: () => AnySchema): unknown;
};

/** Installs `schema.toSource(options)`. Once per process. */
export function register(): void;

declare module './index.js' {
  interface Schema<D extends Definition> {
    toSource(options?: SourceOptions): string;
  }
}
