/**
 * Hand-written typings for @alexify/protoarray. The runtime is plain CommonJS;
 * this file is the only source of the public types.
 *
 * Schemas are defined in @alexify/metaschema. protoarray imports nothing of
 * it, in its runtime or in its types: the type of a schema's values comes
 * from the Standard Schema props a metaschema Schema has (`~standard.types`),
 * read by their shape.
 */

/** The wire types a custom type of metaschema with a check of its own may travel as. */
export type WireType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'bigint'
  | 'date'
  | 'bytes'
  | 'json'
  | 'any'
  | 'unknown'
  | 'null';

/**
 * metaschema's snapshot (format 1): what `schema.toSnapshot()` and `model.toJSON()` write, plain
 * JSON. protoarray reads the schema it holds and needs nothing of metaschema to do so.
 */
export interface Snapshot {
  readonly format: 1;
  /** The entity a snapshot of one schema is about. */
  readonly root?: string;
  readonly types?: Readonly<Record<string, object>>;
  readonly entities: Readonly<Record<string, object>>;
}

/** Anything with typed Standard Schema props, as a metaschema Schema: what types a schema. */
export interface Typed<Input = unknown, Output = unknown> {
  readonly '~standard': {
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/**
 * A metaschema Model, by what protoarray reads of it. The runtime tells one by metaschema's
 * brand (`Symbol.for('alexify.metaschema.brand')`), not by its shape: an object of this shape
 * without the brand is no Model.
 */
export interface ModelLike {
  readonly entities: ReadonlyMap<string, unknown>;
  toJSON(): object;
}

/** What `{ metaschema }` injects: metaschema itself, or its `./definition` entry. */
export interface MetaschemaModule {
  readonly Schema: new (name: string, definition: any) => { toSnapshot(): object };
}

type TypesOf<S> = S extends { readonly '~standard': { readonly types?: infer T } }
  ? NonNullable<T>
  : never;

/** What a typed source's schema accepts to encode: metaschema's input type. */
export type InputOf<S> = TypesOf<S> extends { readonly input: infer I } ? I : unknown;

/** What a typed source's schema decodes to: metaschema's output type, as decode gives it. */
export type OutputOf<S> = TypesOf<S> extends { readonly output: infer O } ? Decoded<O> : unknown;

type Atom =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | Uint8Array
  | RegExp
  | ((...args: never[]) => unknown);

/**
 * A value as decode gives it: every key of a record present, the ones that were missing on the
 * wire `null` (or their default), the elements of a tuple too.
 */
export type Decoded<T> = T extends Atom
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? Map<K, Decoded<V>>
    : T extends ReadonlySet<infer V>
      ? Set<Decoded<V>>
      : T extends object
        ? {
            -readonly [K in keyof T]-?: undefined extends T[K]
              ? Decoded<Exclude<T[K], undefined>> | null
              : Decoded<T[K]>;
          }
        : T;

/** Any Schema instance, whatever it holds: what a registry or a free function accepts. */
export interface AnySchema {
  readonly name: string;
  readonly keys: readonly string[];
  readonly backend: Backend;
  readonly id: string;
  encode(value: any): unknown;
  decode(array: any, options?: DecodeOptions): unknown;
  toString(): string;
}

export type Backend = 'codegen' | 'closures' | 'standalone';

export type Layout = 'rows' | 'flat' | 'columns';

/** What a codec does, generated or composed. */
export interface Codec {
  encode(value: unknown): unknown;
  decode(wire: unknown, strict?: boolean): unknown;
  stringify?(value: unknown): string;
}

/** A codec of the binary wire (see `@alexify/protoarray/binary`), generated or composed. */
export interface BinaryCodec {
  write(writer: object, value: unknown): void;
  read(reader: object): unknown;
}

/** A schema's codec as a generated module passes it (see `@alexify/protoarray/standalone`). */
export interface CompiledCodec {
  readonly canonical: string;
  readonly id?: string;
  readonly codec: Codec;
  /** The codec of one record of a rows collection, for the stream helpers. */
  readonly items?: Codec;
  /** The codec of the binary wire, where the module carries one (`binary: true`). */
  readonly binary?: BinaryCodec;
}

/**
 * Options. A place of the schema is named by its path, as the errors name it: `address.city`,
 * `orders[].sku` (an item), `scores{}` (a dictionary's value), `pair[1]` (a tuple's element),
 * `''` the root.
 */
export interface SchemaOptions {
  /** `true` to require code generation, `false` to force closures; by default the runtime decides. */
  readonly codegen?: boolean;
  /**
   * `true` (the default) checks the wire on decode: structure, types, required fields, enum
   * ranges; `false` trusts it (the array structure is still checked). The values given to encode
   * are trusted: check them with metaschema (`check`, `parse`) first.
   */
  readonly validate?: boolean;
  /** Encode the root struct (`true`) or the structs at these paths as `[mask, ...present values]`. */
  readonly sparse?: boolean | readonly string[];
  /** The layout of the root collection of records, or of the collections at these paths. */
  readonly layout?: Layout | Readonly<Record<string, Layout>>;
  /**
   * Intern every string (`true`) or the strings at these paths: one table of the message's
   * strings travels first, `[table, body]`, and each string as its index.
   */
  readonly intern?: boolean | readonly string[];
  /**
   * The integers, numbers, dates or decimals at these paths travel as differences: a column of a
   * `columns` collection, or a list of them anywhere.
   */
  readonly delta?: readonly string[];
  /**
   * How `stringify` writes the text: `'auto'` (the default) has generated code write it by hand
   * for records of booleans, enums, flags, dates, integers and decimals, where that is faster
   * than `JSON.stringify` of the wire on every engine; `'builder'` does it for any schema;
   * `'native'` always uses `JSON.stringify`. The text is the same either way.
   */
  readonly stringify?: 'auto' | 'builder' | 'native';
  /**
   * Computes `id` from the schema's signature: its canonical form (`toString()`), then
   * `;Name=<canonical form>` for every other entity it references, by name. The default is a
   * 32-bit FNV-1a hash as eight hex digits. It must be synchronous and deterministic.
   */
  readonly fingerprint?: (signature: string) => string;
  /**
   * The levels of a recursion one payload may nest, a positive integer: deeper is `DecodeError`
   * `structure` or `EncodeError` `depth`, at the same level on either backend and in generated
   * modules. By default (`Infinity`) nothing is counted and the call stack is the limit, which
   * differs between backends and engines. 512 is a depth both backends reach everywhere.
   */
  readonly maxDepth?: number;
  /**
   * How a reference to an entity travels, as metaschema's check reads it: `'kind'` (the default)
   * as the field's `embed` says, else by the kind of the entity (a stored kind's id, a memory
   * kind's record); `'embed'` always the record; `'id'` always the id.
   */
  readonly references?: 'kind' | 'embed' | 'id';
  /** The wire type of each custom type of metaschema that checks its values on its own. */
  readonly types?: Readonly<Record<string, WireType>>;
  /** The entity of a snapshot or of a Model to build (by default, the snapshot's `root`). */
  readonly entity?: string;
  /** The options of the entities a reference reaches, by name (each must be one of the snapshot). */
  readonly entities?: Readonly<Record<string, EntityOptions>>;
  /** metaschema, injected to read a definition: `{ metaschema: require('@alexify/metaschema') }`. */
  readonly metaschema?: MetaschemaModule;
  /** The codec of a generated module. */
  readonly compiled?: CompiledCodec;
}

/** An entity's own options: its name is its key, its snapshot the one of the schema around it. */
export type EntityOptions = Omit<SchemaOptions, 'entity' | 'entities' | 'metaschema'>;

/** The options of `Schema.fromModel`: the ones of every entity, and each one's own. */
export type ModelOptions = Omit<
  SchemaOptions,
  'sparse' | 'layout' | 'intern' | 'delta' | 'entity' | 'compiled' | 'metaschema'
>;

export interface DecodeOptions {
  /** Fail on elements beyond the schema instead of ignoring them. */
  readonly strict?: boolean;
}

/** What a schema is built from, besides a metaschema Schema. */
export type SchemaSource = Snapshot | ModelLike | AnySchema | object;

export class Schema<Output = unknown, Input = Output> {
  constructor(source: SchemaSource, options?: SchemaOptions);
  constructor(name: string, source: SchemaSource, options?: SchemaOptions);

  /**
   * The schema of a metaschema Schema (typed by it), of a snapshot, of a Model's entity
   * (`entity`), of a protoarray schema with other options, or of a definition with
   * `{ metaschema }`.
   */
  static from<S extends Typed>(source: S, options?: SchemaOptions): Schema<OutputOf<S>, InputOf<S>>;
  static from<O, I>(source: Schema<O, I>, options?: SchemaOptions): Schema<O, I>;
  static from<O = unknown, I = O>(source: SchemaSource, options?: SchemaOptions): Schema<O, I>;

  /** Every entity of a metaschema Model or of its snapshot, by name, in its order. */
  static fromModel(
    source: ModelLike | Snapshot,
    options?: ModelOptions,
  ): Readonly<Record<string, Schema>>;

  readonly name: string;
  /** The snapshot the schema was read from (`null` for a list or a resolved schema). */
  readonly snapshot: Snapshot | null;
  /** The metaschema Schema it was built from, or `null`: its `check` and `parse` validate values. */
  readonly source: unknown;
  /** Field keys in wire order (empty for anything but a struct). */
  readonly keys: readonly string[];
  readonly backend: Backend;
  readonly layout: 'dense' | 'sparse' | Layout;
  /** Fingerprint of the canonical form, for handshakes. */
  readonly id: string;
  /** The same records as rows: `[[...], [...]]`. */
  readonly list: Collection<Output, Input>;

  encode(value: Input): unknown;
  decode(array: unknown, options?: DecodeOptions): Output;
  stringify(value: Input): string;
  parse(text: string, options?: DecodeOptions): Output;
  /**
   * One wire value per value of an iterable, lazily; an async iterable gives an async
   * generator. An error names the index of its value (`[3].name`).
   */
  encodeEach(values: AsyncIterable<Input>): AsyncGenerator<unknown, void, undefined>;
  encodeEach(values: Iterable<Input>): Generator<unknown, void, undefined>;
  decodeEach(
    arrays: AsyncIterable<unknown>,
    options?: DecodeOptions,
  ): AsyncGenerator<Output, void, undefined>;
  decodeEach(arrays: Iterable<unknown>, options?: DecodeOptions): Generator<Output, void, undefined>;
  /** The canonical form: every position with its type. */
  toString(): string;
}

/** The rows collection of a schema (`schema.list`). */
export interface Collection<Output = unknown, Input = Output> {
  readonly name: string;
  readonly keys: readonly string[];
  readonly backend: Backend;
  readonly layout: Layout;
  readonly id: string;
  encode(value: readonly Input[]): unknown;
  decode(array: unknown, options?: DecodeOptions): Output[];
  stringify(value: readonly Input[]): string;
  parse(text: string, options?: DecodeOptions): Output[];
  toString(): string;
}

/**
 * The functional entry points take any schema, a collection (`schema.list`) included, and
 * type the value and the result after the schema's own methods.
 */
export function encode<S extends AnySchema>(
  schema: S,
  value: Parameters<S['encode']>[0],
): ReturnType<S['encode']>;

export function decode<S extends AnySchema>(
  schema: S,
  array: Parameters<S['decode']>[0],
  options?: DecodeOptions,
): ReturnType<S['decode']>;

export function stringify<S extends AnySchema & { stringify(value: never): string }>(
  schema: S,
  value: Parameters<S['stringify']>[0],
): string;

export function parse<S extends AnySchema & { parse(text: string, options?: DecodeOptions): unknown }>(
  schema: S,
  text: string,
  options?: DecodeOptions,
): ReturnType<S['parse']>;

export function encodeEach<S extends AnySchema>(
  schema: S,
  values: AsyncIterable<Parameters<S['encode']>[0]>,
): AsyncGenerator<ReturnType<S['encode']>, void, undefined>;
export function encodeEach<S extends AnySchema>(
  schema: S,
  values: Iterable<Parameters<S['encode']>[0]>,
): Generator<ReturnType<S['encode']>, void, undefined>;

export function decodeEach<S extends AnySchema>(
  schema: S,
  arrays: AsyncIterable<unknown>,
  options?: DecodeOptions,
): AsyncGenerator<ReturnType<S['decode']>, void, undefined>;
export function decodeEach<S extends AnySchema>(
  schema: S,
  arrays: Iterable<unknown>,
  options?: DecodeOptions,
): Generator<ReturnType<S['decode']>, void, undefined>;

export type SchemaErrorCode =
  | 'ERR_INVALID_SNAPSHOT'
  | 'ERR_INVALID_DEFINITION'
  | 'ERR_UNKNOWN_TYPE'
  | 'ERR_INVALID_ENUM'
  | 'ERR_INVALID_FLAGS'
  | 'ERR_INVALID_UNION'
  | 'ERR_UNKNOWN_REFERENCE'
  | 'ERR_RESERVED_KEY'
  | 'ERR_INTEGER_KEY'
  | 'ERR_INVALID_OPTIONS'
  | 'ERR_CODEGEN_UNAVAILABLE'
  | 'ERR_COMPILED_MISMATCH'
  | 'ERR_SCHEMA_EXPECTED'
  | 'ERR_INCOMPATIBLE'
  | 'ERR_ID_COLLISION'
  | 'ERR_UNKNOWN_SCHEMA';

/**
 * `object`/`array`/`set`/`map`/`iterable`: what the value is not; `depth`: a cyclic value or
 * one nested deeper than the call stack; `union`: a discriminator outside the union; `type`: a
 * value a list of differences cannot hold (only integers have exact differences).
 */
export type EncodeErrorCode =
  | 'object'
  | 'array'
  | 'set'
  | 'map'
  | 'iterable'
  | 'depth'
  | 'type'
  | 'union';

export type DecodeErrorCode =
  | 'structure'
  | 'required'
  | 'type'
  | 'enum'
  | 'union'
  | 'extra'
  | 'json'
  | 'schema';

/** A snapshot protoarray cannot read, or invalid options; thrown while a schema is built. */
export class SchemaDefinitionError extends TypeError {
  constructor(
    code: SchemaErrorCode,
    message: string,
    schema?: string,
    field?: string,
    cause?: unknown,
  );
  readonly code: SchemaErrorCode;
  /** The name of the schema being built, or `''`. */
  readonly schema: string;
  /** The field the problem is at, as `address.city`, or `''`. */
  readonly field: string;
  /** What broke the reader where no check of its own did, or the method of a source. */
  readonly cause?: unknown;
}

/** A value that cannot be encoded: the wrong shape, or a value with no wire form. */
export class EncodeError extends TypeError {
  constructor(code: EncodeErrorCode, path?: string, detail?: string);
  readonly code: EncodeErrorCode;
  /** Where the problem is, as `orders[1]`, or `''` for the value itself. */
  readonly path: string;
  /** The name of the schema whose `encode` threw, or `''`. */
  readonly schema: string;
}

/** A wire array that does not match the schema, or text that is not JSON. */
export class DecodeError extends TypeError {
  constructor(code: DecodeErrorCode, path: string, detail?: string, cause?: unknown);
  readonly code: DecodeErrorCode;
  /** Where the problem is, as `orders[1].sku`, or `''` for the value itself. */
  readonly path: string;
  /** The name of the schema whose `decode` or `parse` threw, or `''`. */
  readonly schema: string;
  /**
   * The `SyntaxError` behind a `json` error, the `SchemaDefinitionError` behind a `schema`
   * one. It may quote the payload; the message never does.
   */
  readonly cause?: unknown;
  /** The id an envelope names, on a `schema` error: the payload's, kept out of the message. */
  readonly id?: string;
}
