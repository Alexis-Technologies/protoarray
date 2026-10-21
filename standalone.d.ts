/**
 * Hand-written typings for @alexify/protoarray/standalone: a schema's codec as module source,
 * for runtimes that forbid compiling source text.
 */

import type { AnySchema } from './index.js';

export interface SourceOptions {
  /**
   * `'import'` (the default): the module imports this package and exports Schema instances built
   * from their snapshots with `{ compiled }`. `'inline'`: the module carries its own runtime and
   * imports nothing. Neither needs metaschema.
   */
  readonly runtime?: 'import' | 'inline';
  /** `'cjs'` (the default) or `'esm'`. */
  readonly format?: 'cjs' | 'esm';
  /**
   * `true` writes each schema's codec of the binary wire (`@alexify/protoarray/binary`) next to
   * its text codec: an import module's schemas carry it for `toBinary` and `fromBinary`, an inline
   * module's get the two as methods. A schema with no binary form is refused
   * (`SchemaDefinitionError` `ERR_NO_BINARY_FORM`). `false` by default: the module carries no
   * bytes.
   */
  readonly binary?: boolean;
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
  toString(): string;
  /** The bytes of a value on the binary wire; only in a module written with `binary: true`. */
  toBinary?(value: unknown): Uint8Array;
  /** The value of the bytes `toBinary` gave; only in a module written with `binary: true`. */
  fromBinary?(bytes: Uint8Array): unknown;
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
  nested(spec: object): unknown;
};

/** Installs `schema.toSource(options)`. Once per process. */
export function register(): void;

declare module './index.js' {
  interface Schema<Output, Input> {
    toSource(options?: SourceOptions): string;
  }
}
