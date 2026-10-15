/**
 * Hand-written typings for @alexify/protoarray. The runtime is plain CommonJS;
 * this file is the only source of the public types.
 */

/** Scalar type names of the definition DSL. */
export type ScalarType =
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

/** A type name, optionally prefixed with `?`, or the capitalised name of a referenced schema. */
export type TypeName = ScalarType | `?${ScalarType}` | (string & {});

/**
 * The long form of a field: `{ type, required, default }`, the enum/flags lists, and the
 * collections as metaschema spells them (`{ type: 'map', key: 'string', value: 'number' }`).
 */
export interface LongForm {
  readonly type: string;
  /** The item of an array or a set, the value of a map or an object, the elements of a tuple. */
  readonly value?: FieldDefinition;
  /** The key type of a map (`'string'` or `'number'`) or an object (`'string'`). */
  readonly key?: 'string' | 'number';
  /** With `type: 'schema'`: the nested struct. */
  readonly schema?: FieldDefinition;
  /** Keys the field had in older versions, which `Schema.resolve` reads it from. */
  readonly aliases?: readonly string[];
  readonly required?: boolean;
  readonly default?: string | number | boolean | null;
  readonly enum?: readonly (string | number)[];
  readonly flags?: readonly string[];
  /** With `type: 'number'`: travel as an integer scaled by 10ⁿ, n from 0 to 15. */
  readonly decimals?: number;
  /** On a string: travel as an index into the message's string table (or opt out of it). */
  readonly intern?: boolean;
  /**
   * On an integer, a number, a date or decimals: travel as differences in a `columns`
   * collection; on an array of them (`{ type: 'array', value, delta: true }`), everywhere.
   */
  readonly delta?: true;
  readonly [option: string]: unknown;
}

/**
 * A tuple element: any definition, or a named one, `{ name: 'type' }` (the name does not
 * travel; `{ 'name?': 'type' }` makes the element optional).
 */
export type TupleElement = string | { readonly [name: string]: string };

/** Any Schema instance, whatever its definition: what a field or a registry accepts. */
export interface AnySchema {
  readonly name: string;
  readonly keys: readonly string[];
  readonly backend: Backend;
  readonly id: string;
  encode(value: any): unknown;
  decode(array: any, options?: DecodeOptions): unknown;
  check(value: unknown): EncodeError | null;
  toString(): string;
}

/** Anything a field can be declared as. */
export type FieldDefinition =
  | TypeName
  | AnySchema
  | readonly TupleElement[]
  | {
      readonly array: FieldDefinition;
      readonly required?: boolean;
      readonly aliases?: readonly string[];
      /** A list of integers, dates or decimals that travels as differences. */
      readonly delta?: true;
    }
  | { readonly set: FieldDefinition; readonly required?: boolean; readonly aliases?: readonly string[] }
  | {
      readonly map:
        | { readonly string: FieldDefinition }
        | { readonly number: FieldDefinition };
      readonly required?: boolean;
      readonly aliases?: readonly string[];
    }
  | { readonly object: { readonly string: FieldDefinition }; readonly required?: boolean; readonly aliases?: readonly string[] }
  | { readonly tuple: readonly FieldDefinition[]; readonly required?: boolean; readonly aliases?: readonly string[] }
  | { readonly schema: FieldDefinition; readonly required?: boolean; readonly aliases?: readonly string[] }
  | {
      readonly enum: readonly (string | number)[];
      readonly required?: boolean;
      readonly default?: string | number;
    }
  | { readonly flags: readonly string[]; readonly required?: boolean; readonly aliases?: readonly string[] }
  | {
      readonly union: readonly (StructDefinition | AnySchema | string)[];
      readonly discriminator: string;
      readonly required?: boolean;
      readonly aliases?: readonly string[];
    }
  | LongForm
  | StructDefinition
  | ((...args: any[]) => unknown);

/** A struct: positions follow key order. A trailing `?` on a key makes the field optional. */
export interface StructDefinition {
  readonly [key: string]: FieldDefinition;
}

/** A schema definition: a struct, a collection, a tuple, a scalar or another schema. */
export type Definition = FieldDefinition;

type Scalars = {
  string: string;
  number: number;
  integer: number;
  boolean: boolean;
  bigint: bigint;
  date: Date;
  bytes: Uint8Array;
  json: unknown;
  any: unknown;
  unknown: unknown;
  null: null;
};

/** The scalars that hold null as a value: never required. */
type Nullable = 'json' | 'any' | 'unknown' | 'null';

type Mode = 'in' | 'out';

type Calculated = (...args: any[]) => unknown;

type TypeOf<T extends string> = T extends keyof Scalars ? Scalars[T] : unknown;

type Shorthand =
  | { readonly array: unknown }
  | { readonly set: unknown }
  | { readonly map: unknown }
  | { readonly object: unknown }
  | { readonly tuple: unknown }
  | { readonly schema: unknown }
  | { readonly enum: unknown }
  | { readonly flags: unknown }
  | { readonly union: readonly unknown[] }
  | { readonly type: unknown };

/** Whether a slot may be nullish on the wire. */
type Optional<K, F> = K extends `${string}?`
  ? true
  : F extends `?${string}`
    ? true
    : F extends Nullable | { readonly type: Nullable }
      ? true
      : F extends { readonly required: false }
        ? true
        : F extends { readonly default: unknown }
          ? true
          : false;

type Flatten<T> = { [K in keyof T]: T[K] } & {};

type Strip<K> = K extends `${infer Name}?` ? Name : K;

/**
 * A capitalised key holding plain metadata is the struct's kind, as in
 * `{ Struct: {}, type: … }`: it has no position. metaschema reads only the
 * first key that way, which types cannot see.
 */
type IsKind<K, F> = K extends Uncapitalize<K & string>
  ? false
  : F extends Calculated | string | readonly unknown[] | Shorthand | { readonly backend: Backend }
    ? false
    : true;

type FieldKeys<D> = {
  [K in keyof D]: D[K] extends Calculated ? never : IsKind<K, D[K]> extends true ? never : K;
}[keyof D] &
  string;

type RequiredKeys<D> = { [K in FieldKeys<D>]: Optional<K, D[K]> extends true ? never : K }[FieldKeys<D>];

type OptionalKeys<D> = Exclude<FieldKeys<D>, RequiredKeys<D>>;

type UnionToIntersection<U> = (U extends unknown ? (key: U) => void : never) extends (
  key: infer I,
) => void
  ? I
  : never;

/** Whether a union of keys is exactly one key. */
type IsSingle<K> = [K] extends [never] ? false : [K] extends [UnionToIntersection<K>] ? true : false;

/** The names metaschema reads as a definition, never as the name of a tuple element. */
type Keyword =
  | 'type'
  | 'array'
  | 'set'
  | 'map'
  | 'object'
  | 'tuple'
  | 'schema'
  | 'enum'
  | 'flags'
  | 'union'
  | 'one'
  | 'many'
  | ScalarType;

/** The name of a named tuple element (`{ x: 'number' }`), or never. */
type ElementName<E> = E extends { readonly [name: string]: string }
  ? IsSingle<keyof E> extends true
    ? keyof E extends infer N extends string
      ? Strip<N> extends Keyword
        ? never
        : Strip<N> extends Uncapitalize<Strip<N>>
          ? N
          : never
      : never
    : never
  : never;

type TupleItem<E, M extends Mode> = [ElementName<E>] extends [never]
  ? Element<E, M>
  : ElementName<E> extends `${string}?`
    ? Value<E[ElementName<E> & keyof E], M> | null
    : Element<E[ElementName<E> & keyof E], M>;

type TupleOf<T, M extends Mode> = { -readonly [I in keyof T]: TupleItem<T[I], M> };

type MapKey<K> = K extends 'number' ? number : string;

type SetOf<T, M extends Mode> = M extends 'out' ? Set<T> : ReadonlySet<T> | readonly T[];

type MapOf<K, V, M extends Mode> = M extends 'out' ? Map<K, V> : ReadonlyMap<K, V>;

type Element<F, M extends Mode> = Optional<'', F> extends true ? Value<F, M> | null : Value<F, M>;

/**
 * A schema used as a field, told by its shape rather than by the class: relating two
 * `Schema` types makes TypeScript measure the variance of the definition through every
 * recursive type below, which gives up ("excessively deep") once collections nest.
 */
type SchemaOf<X> = { readonly definition: X; readonly backend: Backend };

/** Which collection a definition spells, if any: a cheap test that keeps `Value` shallow. */
type CollectionKind<F> = F extends { readonly array: unknown }
  ? 'array'
  : F extends { readonly set: unknown }
    ? 'set'
    : F extends { readonly map: unknown }
      ? 'map'
      : F extends { readonly object: unknown }
        ? 'object'
        : F extends { readonly tuple: unknown }
          ? 'tuple'
          : F extends { readonly schema: unknown }
            ? 'schema'
            : F extends { readonly type: infer T extends CollectionName; readonly value: unknown }
              ? T
              : F extends { readonly type: 'schema'; readonly schema: unknown }
                ? 'schema'
                : never;

type CollectionName = 'array' | 'set' | 'map' | 'object' | 'tuple' | 'schema';

/** The item, value, elements or struct a collection holds, in either spelling. */
type Inner<F, K extends CollectionName> = F extends { readonly [P in K]: infer I } ? I : F extends { readonly value: infer V } ? V : F extends { readonly schema: infer S } ? S : never;

/** The value of a map or an object: the one property of the shorthand, or `value`. */
type Entry<F, K extends CollectionName> = F extends { readonly [P in K]: infer P }
  ? P[keyof P]
  : F extends { readonly value: infer V }
    ? V
    : never;

type EntryKey<F> = F extends { readonly map: infer P }
  ? MapKey<keyof P>
  : F extends { readonly key: 'number' }
    ? number
    : string;

/**
 * The value of each collection; only the property a definition picks is
 * instantiated, so the recursion into its items stays one level deep.
 */
type Collections<F, M extends Mode> = {
  array: Element<Inner<F, 'array'>, M>[];
  set: SetOf<Element<Inner<F, 'set'>, M>, M>;
  map: MapOf<EntryKey<F>, Element<Entry<F, 'map'>, M>, M>;
  object: Record<string, Element<Entry<F, 'object'>, M>>;
  tuple: TupleOf<Inner<F, 'tuple'>, M>;
  schema: Shape<Inner<F, 'schema'>, M>;
};

/** The value of one field. */
type Value<F, M extends Mode> = F extends SchemaOf<infer X>
  ? Shape<X, M>
  : F extends `?${infer T}`
    ? TypeOf<T>
    : F extends string
      ? TypeOf<F>
      : F extends readonly TupleElement[]
        ? TupleOf<F, M>
        : [CollectionKind<F>] extends [never]
          ? F extends { readonly enum: readonly (infer E)[] }
            ? E
            : F extends { readonly flags: readonly (infer N extends string)[] }
              ? M extends 'out'
                ? { [K in N]: boolean }
                : { [K in N]?: boolean }
              : F extends { readonly union: readonly (infer B)[] }
                ? Shape<B, M>
                : F extends { readonly type: infer T extends string }
                  ? TypeOf<T>
                  : F extends object
                    ? Struct<F, M>
                    : unknown
          : Collections<F, M>[CollectionKind<F>];

type Struct<D, M extends Mode> = M extends 'out'
  ? Flatten<
      { [K in RequiredKeys<D> as Strip<K>]: Value<D[K], M> } & {
        [K in OptionalKeys<D> as Strip<K>]: Value<D[K], M> | null;
      }
    >
  : Flatten<
      { [K in RequiredKeys<D> as Strip<K>]: Value<D[K], M> } & {
        [K in OptionalKeys<D> as Strip<K>]?: Value<D[K], M> | null;
      }
    >;

type Shape<D, M extends Mode> = D extends SchemaOf<infer X>
  ? Shape<X, M>
  : D extends `?${string}`
    ? Value<D, M> | null
    : D extends string
      ? Value<D, M>
      : D extends readonly TupleElement[]
        ? TupleOf<D, M>
        : D extends Shorthand
          ? Value<D, M>
          : D extends object
            ? Struct<D, M>
            : unknown;

/**
 * The object a schema decodes to: every field is present, optional ones are
 * `null` when they were missing on the wire.
 */
export type Infer<D extends Definition> = Shape<D, 'out'>;

/** What a schema accepts to encode: optional fields may be left out or set to null. */
export type Input<D extends Definition> = Shape<D, 'in'>;

/** The wire form: a JSON array for structs, collections and tuples; the value itself for a scalar. */
export type Encoded<D extends Definition> = D extends string ? unknown : unknown[];

export type Backend = 'codegen' | 'closures';

export type Layout = 'rows' | 'flat' | 'columns';

export interface SchemaOptions {
  /** `true` to require code generation, `false` to force closures; by default the runtime decides. */
  readonly codegen?: boolean;
  /**
   * What is validated: `true` (the default) or `'decode'` checks the wire on
   * decode and trusts the values given to encode, as 1.0 did; `'both'` also
   * checks those values (types, required fields, enum values, with a path);
   * `'encode'` checks only them; `false` trusts both sides. The shape of a
   * value, a union's discriminator and the array structure of the wire are
   * always checked. `check()` validates a value whatever this says.
   */
  readonly validate?: boolean | 'decode' | 'encode' | 'both';
  /** Encode a struct as `[mask, ...present values]`, one such segment per 31 fields. */
  readonly sparse?: boolean;
  /**
   * Intern every string of the definition: one table of the message's strings travels first,
   * `[table, body]`, and each string as its index. `intern: false` on a field opts it out.
   */
  readonly intern?: boolean;
  /**
   * How `stringify` writes the text: `'auto'` (the default) has generated code write it by hand
   * for records of booleans, enums, flags, dates, integers and decimals, where that is faster
   * than `JSON.stringify` of the wire on every engine; `'builder'` does it for any schema (faster
   * on older engines such as Node.js 20, slower on string-heavy records since Node.js 22);
   * `'native'` always uses `JSON.stringify`. The text is the same either way.
   */
  readonly stringify?: 'auto' | 'builder' | 'native';
  /** Layout of a collection of records (default `'rows'`). */
  readonly layout?: Layout;
  /** Schemas that fields may reference by name. */
  readonly schemas?: Readonly<Record<string, AnySchema>>;
  /**
   * Computes `id` from the canonical form (`toString()`); the default is a
   * 32-bit FNV-1a hash as eight hex digits. It must be synchronous and
   * deterministic: both sides of a handshake compute it on their own.
   */
  readonly fingerprint?: (canonical: string) => string;
}

/** Options of `Schema.resolve`. */
export interface ResolveOptions {
  /**
   * The writer's keys of reader fields, by the reader's path as definition errors spell it
   * (`address.city`, `orders[].sku`): the aliases an inline struct cannot declare itself.
   */
  readonly aliases?: Readonly<Record<string, string | readonly string[]>>;
}

export interface DecodeOptions {
  /** Fail on elements beyond the schema instead of ignoring them. */
  readonly strict?: boolean;
}

export class Schema<const D extends Definition = Definition> {
  constructor(name: string, definition: D, options?: SchemaOptions);
  constructor(definition: D, options?: SchemaOptions);

  /** Compiles a definition into a nameless schema. */
  static from<const D extends Definition>(definition: D, options?: SchemaOptions): Schema<D>;

  /**
   * What `writer` wrote, read as `reader` objects, and `reader` objects written as `writer`
   * writes them: the writer's wire, id and layout under the reader's keys, types and defaults.
   * Fields match by key, by the reader's `aliases` or by the `aliases` option. Throws
   * `ERR_INCOMPATIBLE` for what cannot be read.
   */
  static resolve<const R extends Definition>(
    writer: AnySchema,
    reader: Schema<R>,
    options?: ResolveOptions,
  ): Schema<R>;

  /** Keys only: every field is `json`, values travel as they are. */
  static keys<const K extends readonly string[]>(
    keys: K,
    options?: SchemaOptions,
  ): Schema<{ readonly [P in K[number]]: 'json' }>;

  readonly name: string;
  readonly definition: D;
  /** Field keys in wire order (empty for anything but a struct). */
  readonly keys: readonly string[];
  readonly backend: Backend;
  readonly layout: 'dense' | 'sparse' | Layout;
  /** Fingerprint of the canonical form, for handshakes. */
  readonly id: string;
  /** The same records as rows: `[[...], [...]]`. */
  readonly list: Collection<D>;

  encode(value: Input<D>): Encoded<D>;
  decode(array: Encoded<D>, options?: DecodeOptions): Infer<D>;
  stringify(value: Input<D>): string;
  parse(text: string, options?: DecodeOptions): Infer<D>;
  /**
   * One wire value per value of an iterable, lazily; an async iterable gives an async
   * generator. An error names the index of its value (`[3].name`).
   */
  encodeEach(values: AsyncIterable<Input<D>>): AsyncGenerator<Encoded<D>, void, undefined>;
  encodeEach(values: Iterable<Input<D>>): Generator<Encoded<D>, void, undefined>;
  decodeEach(
    arrays: AsyncIterable<unknown>,
    options?: DecodeOptions,
  ): AsyncGenerator<Infer<D>, void, undefined>;
  decodeEach(arrays: Iterable<unknown>, options?: DecodeOptions): Generator<Infer<D>, void, undefined>;
  /**
   * What encoding the value with validation would throw, as the error itself,
   * or `null`. It checks even where `validate: false` is set, here and in the
   * schemas this one embeds, and never throws over the data.
   */
  check(value: unknown): EncodeError | null;
  /** The canonical form: every position with its type. */
  toString(): string;
}

/**
 * The rows collection of a schema (`schema.list`): a schema of `{ array: schema }`
 * typed without the recursion that a generic `Schema` would need.
 */
export interface Collection<D extends Definition> {
  readonly name: string;
  readonly keys: readonly string[];
  readonly backend: Backend;
  readonly layout: Layout;
  readonly id: string;
  encode(value: readonly Input<D>[]): unknown[];
  decode(array: readonly unknown[], options?: DecodeOptions): Infer<D>[];
  stringify(value: readonly Input<D>[]): string;
  parse(text: string, options?: DecodeOptions): Infer<D>[];
  check(value: unknown): EncodeError | null;
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

export function check(schema: AnySchema | Collection<any>, value: unknown): EncodeError | null;

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
  | 'ERR_SCHEMA_EXPECTED'
  | 'ERR_INCOMPATIBLE';

/**
 * `object`/`array`: what the value is not; `depth`: a cyclic value or one nested
 * deeper than the call stack; `union`: a discriminator outside the union;
 * `required`, `type` and `enum`: what validation found.
 */
export type EncodeErrorCode =
  | 'object'
  | 'array'
  | 'set'
  | 'map'
  | 'iterable'
  | 'depth'
  | 'required'
  | 'type'
  | 'enum'
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

/** A broken definition or invalid options; thrown while a schema is built. */
export class SchemaDefinitionError extends TypeError {
  readonly code: SchemaErrorCode;
  /** The name of the schema being built, or `''`. */
  readonly schema: string;
  /** The field the problem is at, as `address.city`, or `''`. */
  readonly field: string;
}

/** A value that cannot be encoded: the wrong shape, or a value validation rejects. */
export class EncodeError extends TypeError {
  readonly code: EncodeErrorCode;
  /** Where the problem is, as `orders[1]`, or `''` for the value itself. */
  readonly path: string;
  /** The name of the schema whose `encode` threw, or `''`. */
  readonly schema: string;
}

/** A wire array that does not match the schema, or text that is not JSON. */
export class DecodeError extends TypeError {
  readonly code: DecodeErrorCode;
  /** Where the problem is, as `orders[1].sku`, or `''` for the value itself. */
  readonly path: string;
  /** The name of the schema whose `decode` or `parse` threw, or `''`. */
  readonly schema: string;
  /** The `SyntaxError` behind an `'json'` error. */
  readonly cause?: unknown;
}
