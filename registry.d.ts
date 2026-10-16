/**
 * Hand-written typings for @alexify/protoarray/registry: schemas by id and the
 * `[id, payload]` envelope.
 */

import type { AnySchema, DecodeOptions, ModelLike, ModelOptions, Snapshot } from './index.js';

/** A payload with the id of the schema that wrote it: `[id, payload]`. */
export type Envelope = [id: string, payload: unknown];

export interface EnvelopeOptions {
  /** Write the payload for a peer that knows this id, read through `resolve`. */
  readonly as?: string;
}

/** Schemas by id; reads every registered version as any reader schema. */
export class SchemaRegistry implements Iterable<AnySchema> {
  constructor(schemas?: Iterable<AnySchema>);

  /** The schemas of the entities of a metaschema Model or of its snapshot (`Schema.fromModel`). */
  static from(source: ModelLike | Snapshot, options?: ModelOptions): SchemaRegistry;

  /** How many ids are known. */
  readonly size: number;

  /**
   * Adds a schema under its id (again for the same canonical form is a no-op); the latest one
   * added under a name is the one `find` returns. A different schema under a known id throws
   * `ERR_ID_COLLISION`.
   */
  add(schema: AnySchema): this;
  get(id: string): AnySchema | undefined;
  has(id: string): boolean;
  find(name: string): AnySchema | undefined;

  /** The schema that reads what the schema with this id wrote, as `reader` objects. */
  resolve<S extends AnySchema>(id: string, reader: S): S;

  encode<S extends AnySchema>(
    schema: S,
    value: Parameters<S['encode']>[0],
    options?: EnvelopeOptions,
  ): Envelope;
  /** Decodes as the writer wrote it, or as `reader` objects. */
  decode(envelope: unknown, reader?: null, options?: DecodeOptions): unknown;
  decode<S extends AnySchema>(
    envelope: unknown,
    reader: S,
    options?: DecodeOptions,
  ): ReturnType<S['decode']>;
  stringify<S extends AnySchema>(
    schema: S,
    value: Parameters<S['encode']>[0],
    options?: EnvelopeOptions,
  ): string;
  parse(text: string, reader?: null, options?: DecodeOptions): unknown;
  parse<S extends AnySchema>(
    text: string,
    reader: S,
    options?: DecodeOptions,
  ): ReturnType<S['decode']>;

  [Symbol.iterator](): Iterator<AnySchema>;
}
