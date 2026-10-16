/**
 * Hand-written typings for @alexify/protoarray/resolve: reading what another version of a schema
 * wrote, and writing for it.
 */

import type { AnySchema } from './index.js';

export interface ResolveOptions {
  /**
   * The writer's keys of reader fields, by the reader's path as the errors spell it
   * (`address.city`, `orders[].sku`): what the reader's own `aliases` do not say.
   */
  readonly aliases?: Readonly<Record<string, string | readonly string[]>>;
}

/**
 * What `writer` wrote, read as `reader` objects, and `reader` objects written as `writer` writes
 * them: the writer's wire, id and layout under the reader's keys, types and defaults. Fields
 * match by key, by the reader's `aliases` (metaschema's) or by the `aliases` option. Throws
 * `ERR_INCOMPATIBLE` for what cannot be read.
 */
export function resolve<S extends AnySchema>(
  writer: AnySchema,
  reader: S,
  options?: ResolveOptions,
): S;

/** Installs `Schema.resolve`. Once per process. */
export function register(): void;

declare module './index.js' {
  namespace Schema {
    /** `resolve` of `@alexify/protoarray/resolve`, once its `register()` has run. */
    function resolve<S extends AnySchema>(
      writer: AnySchema,
      reader: S,
      options?: ResolveOptions,
    ): S;
  }
}
