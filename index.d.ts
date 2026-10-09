/**
 * Hand-written typings for @alexify/protoarray. The runtime is plain CommonJS;
 * this file is the only source of the public types.
 */

/** Scalar type names of the definition DSL. */
export type ScalarType = 'string' | 'number' | 'boolean' | 'bigint' | 'date' | 'json';

/** A type name, optionally prefixed with `?`, or the capitalised name of a referenced schema. */
export type TypeName = ScalarType | `?${ScalarType}` | (string & {});

/** The long form of a field: `{ type, required, default }` and the enum/flags lists. */
export interface LongForm {
  readonly type: string;
  readonly required?: boolean;
  readonly default?: string | number | boolean | null;
  readonly enum?: readonly (string | number)[];
  readonly flags?: readonly string[];
  readonly [option: string]: unknown;
}

/** A tuple element: a scalar type name, or `{ name: type }`. */
export type TupleElement = string | { readonly [name: string]: string };

/** Any Schema instance, whatever its definition: what a field or a registry accepts. */
export interface AnySchema {
  readonly name: string;
  readonly keys: readonly string[];
  readonly backend: Backend;
  readonly id: string;
  encode(value: any): unknown;
  decode(array: any, options?: DecodeOptions): unknown;
  toString(): string;
}

/** Anything a field can be declared as. */
export type FieldDefinition =
  | TypeName
  | AnySchema
  | readonly TupleElement[]
  | { readonly array: FieldDefinition; readonly required?: boolean }
  | {
      readonly enum: readonly (string | number)[];
      readonly required?: boolean;
      readonly default?: string | number;
    }
  | { readonly flags: readonly string[]; readonly required?: boolean }
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
  boolean: boolean;
  bigint: bigint;
  date: Date;
  json: unknown;
};

type Mode = 'in' | 'out';

type Calculated = (...args: any[]) => unknown;

type TypeOf<T extends string> = T extends keyof Scalars ? Scalars[T] : unknown;

type Shorthand =
  | { readonly array: unknown }
  | { readonly enum: unknown }
  | { readonly flags: unknown }
  | { readonly type: unknown };

/** Whether a slot may be nullish on the wire. */
type Optional<K, F> = K extends `${string}?`
  ? true
  : F extends `?${string}`
    ? true
    : F extends 'json' | { readonly type: 'json' }
      ? true
      : F extends { readonly required: false }
        ? true
        : F extends { readonly default: unknown }
          ? true
          : false;

type Flatten<T> = { [K in keyof T]: T[K] } & {};

type Strip<K> = K extends `${infer Name}?` ? Name : K;

type FieldKeys<D> = { [K in keyof D]: D[K] extends Calculated ? never : K }[keyof D] & string;

type RequiredKeys<D> = { [K in FieldKeys<D>]: Optional<K, D[K]> extends true ? never : K }[FieldKeys<D>];

type OptionalKeys<D> = Exclude<FieldKeys<D>, RequiredKeys<D>>;

type TupleOf<T, M extends Mode> = {
  -readonly [I in keyof T]: T[I] extends `?${infer U}`
    ? TypeOf<U> | null
    : T[I] extends string
      ? TypeOf<T[I]>
      : T[I] extends { readonly [name: string]: infer U extends string }
        ? Value<U, M>
        : unknown;
};

type Element<F, M extends Mode> = Optional<'', F> extends true ? Value<F, M> | null : Value<F, M>;

/** The value of one field. */
type Value<F, M extends Mode> = F extends Schema<infer X>
  ? Shape<X, M>
  : F extends `?${infer T}`
    ? TypeOf<T>
    : F extends string
      ? TypeOf<F>
      : F extends readonly TupleElement[]
        ? TupleOf<F, M>
        : F extends { readonly array: infer Item }
          ? Element<Item, M>[]
          : F extends { readonly enum: readonly (infer E)[] }
            ? E
            : F extends { readonly flags: readonly (infer N extends string)[] }
              ? M extends 'out'
                ? { [K in N]: boolean }
                : { [K in N]?: boolean }
              : F extends { readonly type: infer T extends string }
                ? TypeOf<T>
                : F extends object
                  ? Shape<F, M>
                  : unknown;

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

type Shape<D, M extends Mode> = D extends Schema<infer X>
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
  /** Check the wire on decode (default `true`). */
  readonly validate?: boolean;
  /** Encode a struct as `[mask, ...present values]` (up to 31 fields). */
  readonly sparse?: boolean;
  /** Layout of a collection of records (default `'rows'`). */
  readonly layout?: Layout;
  /** Schemas that fields may reference by name. */
  readonly schemas?: Readonly<Record<string, AnySchema>>;
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
  toString(): string;
}

export function encode<D extends Definition>(schema: Schema<D>, value: Input<D>): Encoded<D>;
export function encode<D extends Definition>(
  schema: Collection<D>,
  value: readonly Input<D>[],
): unknown[];

export function decode<D extends Definition>(
  schema: Schema<D>,
  array: Encoded<D>,
  options?: DecodeOptions,
): Infer<D>;
export function decode<D extends Definition>(
  schema: Collection<D>,
  array: readonly unknown[],
  options?: DecodeOptions,
): Infer<D>[];

export function stringify<D extends Definition>(schema: Schema<D>, value: Input<D>): string;
export function stringify<D extends Definition>(
  schema: Collection<D>,
  value: readonly Input<D>[],
): string;

export function parse<D extends Definition>(
  schema: Schema<D>,
  text: string,
  options?: DecodeOptions,
): Infer<D>;
export function parse<D extends Definition>(
  schema: Collection<D>,
  text: string,
  options?: DecodeOptions,
): Infer<D>[];

export type SchemaErrorCode =
  | 'ERR_INVALID_DEFINITION'
  | 'ERR_UNKNOWN_TYPE'
  | 'ERR_INVALID_ENUM'
  | 'ERR_INVALID_FLAGS'
  | 'ERR_UNKNOWN_REFERENCE'
  | 'ERR_RESERVED_KEY'
  | 'ERR_INTEGER_KEY'
  | 'ERR_INVALID_OPTIONS'
  | 'ERR_CODEGEN_UNAVAILABLE'
  | 'ERR_SCHEMA_EXPECTED';

export type EncodeErrorCode = 'object';

export type DecodeErrorCode = 'structure' | 'required' | 'type' | 'enum' | 'extra' | 'json';

/** A broken definition or invalid options; thrown while a schema is built. */
export class SchemaDefinitionError extends TypeError {
  readonly code: SchemaErrorCode;
  /** The name of the schema being built, or `''`. */
  readonly schema: string;
  /** The field the problem is at, as `address.city`, or `''`. */
  readonly field: string;
}

/** A value that cannot be encoded. */
export class EncodeError extends TypeError {
  readonly code: EncodeErrorCode;
  readonly path: string;
}

/** A wire array that does not match the schema, or text that is not JSON. */
export class DecodeError extends TypeError {
  readonly code: DecodeErrorCode;
  /** Where the problem is, as `orders[1].sku`, or `''` for the value itself. */
  readonly path: string;
  /** The `SyntaxError` behind an `'json'` error. */
  readonly cause?: unknown;
}
