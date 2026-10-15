/**
 * Hand-written typings for @alexify/protoarray/metaschema: one definition for protoarray and
 * @alexify/metaschema. The metaschema types are not imported: the package does not depend on it.
 */

import type { AnySchema, SchemaOptions } from './index.js';
import type { SchemaRegistry } from './registry.js';

/** A metaschema custom type, in the form `new Model(types, entities)` takes. */
export interface CustomType {
  readonly kind: 'scalar';
  construct(definition: object): void;
  checkType(value: unknown): null | false;
}

/** The protoarray schema of a metaschema Schema: the same fields, positions and types. */
export function fromMetaschema(schema: object, options?: SchemaOptions): AnySchema;

/** The schemas of every entity of a metaschema Model, by name and by id. */
export function fromModel(model: object, options?: SchemaOptions): SchemaRegistry;

/** The types metaschema lacks for protoarray's `bytes` and `flags`, to register in a Model. */
export const types: { readonly bytes: CustomType; readonly flags: CustomType };

/**
 * Lets `Schema.from(metaschemaSchema)`, a metaschema Schema as a field and
 * `SchemaRegistry.from(model)` work. Once per process.
 */
export function register(): void;
