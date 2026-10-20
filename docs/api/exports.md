# Exports

```js
const {
  Schema,
  encode, decode, stringify, parse, encodeEach, decodeEach,
  SchemaDefinitionError, EncodeError, DecodeError,
} = require('@alexify/protoarray');
```

Five subpaths carry what the core does not need, so a program that does not use them does not
bundle them:

| Subpath | Exports | Page |
| --- | --- | --- |
| `@alexify/protoarray/resolve` | `resolve`, `register` | [Migrations and the Registry](/guide/resolve) |
| `@alexify/protoarray/registry` | `SchemaRegistry` | [Migrations and the Registry](/guide/resolve#the-registry) |
| `@alexify/protoarray/stream` | `stringifyLines`, `parseLines`, `stringifyStream`, `parseStream`, `stringifyItems`, `parseItems`, `register` | [Streaming](/guide/streaming) |
| `@alexify/protoarray/standalone` | `toSource`, `runtime`, `register` | [Standalone Modules](/guide/standalone) |
| `@alexify/protoarray/evolve` | `compatible`, `baseline`, `restore`, `register` | [Schema Evolution](/guide/evolution#checking-it-in-ci) |
| `@alexify/protoarray/binary` | `toBinary`, `fromBinary`, `register` | [The Binary Wire](/guide/binary) |

The package also installs a `protoarray` command: `protoarray compile <module>` (see
[Standalone Modules](/guide/standalone#protoarray-compile)), `protoarray snapshot <module>` and
`protoarray check <module> --against <baseline.json>` (see
[Checking it in CI](/guide/evolution#checking-it-in-ci)). None of it requires
`@alexify/metaschema`; schemas are built from what metaschema writes (see
[Defining a Schema](/guide/schema)).

```ts
import { Schema, type Decoded, type Snapshot, type SchemaOptions } from '@alexify/protoarray';
```

## `Schema`

```ts
class Schema<Output = unknown, Input = Output> {
  constructor(source: SchemaSource, options?: SchemaOptions);
  constructor(name: string, source: SchemaSource, options?: SchemaOptions);

  static from<S extends Typed>(source: S, options?: SchemaOptions): Schema<OutputOf<S>, InputOf<S>>;
  static from<O, I>(source: Schema<O, I>, options?: SchemaOptions): Schema<O, I>;
  static from<O = unknown, I = O>(source: SchemaSource, options?: SchemaOptions): Schema<O, I>;
  static fromModel(source: ModelLike | Snapshot, options?: ModelOptions): Readonly<Record<string, Schema>>;

  readonly name: string;
  readonly snapshot: Snapshot | null;   // what the schema was read from
  readonly source: unknown;             // the metaschema Schema it was built from, or null
  readonly keys: readonly string[];
  readonly backend: 'codegen' | 'closures' | 'standalone';
  readonly layout: 'dense' | 'sparse' | 'rows' | 'flat' | 'columns';
  readonly id: string;
  readonly list: Collection<Output, Input>;

  encode(value: Input): unknown;
  decode(array: unknown, options?: DecodeOptions): Output;
  stringify(value: Input): string;
  parse(text: string, options?: DecodeOptions): Output;
  encodeEach(values: Iterable<Input>): Generator<unknown>;            // AsyncIterable → AsyncGenerator
  decodeEach(arrays: Iterable<unknown>, options?: DecodeOptions): Generator<Output>;
  toString(): string;
}
```

Reads a schema once and carries its codec. A source is a metaschema `Schema` (typed by its
Standard Schema props), a snapshot (`schema.toSnapshot()`, `model.toJSON()`, plain JSON), a
protoarray schema to build again with other options, or a definition with `{ metaschema }`;
`Schema.fromModel` builds every entity of a metaschema `Model` or of its snapshot (see
[Defining a Schema](/guide/schema#sources)). `encode` throws `EncodeError` for a value with no wire
(the wrong shape, a cycle, a union value outside the union); `decode` and `parse` throw
`DecodeError` (see [Errors](/guide/errors)); a snapshot or an option protoarray cannot read throws
`SchemaDefinitionError` when the schema is built, and a definition metaschema cannot read throws
metaschema's.

```ts
interface SchemaOptions {
  codegen?: boolean;   // true: require generated code; false: closures; default: what the runtime allows
  validate?: boolean;  // true (default): the wire is checked on decode; the values given to encode never are
  sparse?: boolean | readonly string[];               // the root struct, or the structs at these paths
  layout?: Layout | Readonly<Record<string, Layout>>; // the root collection, or the collections at these paths
  intern?: boolean | readonly string[];               // every string, or the strings at these paths: [table, body]
  delta?: readonly string[];                          // integer, number, date or decimals lists and columns
  stringify?: 'auto' | 'builder' | 'native';          // how stringify writes the text
  fingerprint?: 'fnv1a32' | 'fnv1a64' | ((signature: string) => string);  // what `id` is of the signature: FNV-1a, 8 or 16 hex digits, or a function
  maxDepth?: number;                                  // levels of a recursion a payload may nest; default: the stack
  references?: 'kind' | 'embed' | 'id';               // how references travel; 'kind' as metaschema's check reads them
  types?: Readonly<Record<string, WireType>>;         // the wire type of a custom type with a check of its own
  entity?: string;                                    // the entity of a snapshot to build
  entities?: Readonly<Record<string, SchemaOptions>>; // options of the entities references reach, by name
  metaschema?: MetaschemaModule;                      // require('@alexify/metaschema') or its ./definition
  compiled?: { canonical: string; id?: string; codec: object; binary?: object };  // from a standalone module
}

type ModelOptions = Omit<SchemaOptions, 'sparse' | 'layout' | 'intern' | 'delta' | 'entity' | 'compiled' | 'metaschema'>;

interface DecodeOptions {
  strict?: boolean;    // reject elements beyond the schema
}
```

Paths are spelled as error paths: `address.city`, `orders[].sku`, `scores{}`, `pair[1]`, `''` for
the root (see [Paths](/guide/schema#paths)).

## `encode(schema, value)`

```ts
function encode<S extends AnySchema>(schema: S, value: Parameters<S['encode']>[0]): ReturnType<S['encode']>;
```

`schema.encode(value)` as a function, for any schema or collection. Throws
`SchemaDefinitionError` with code `ERR_SCHEMA_EXPECTED` when `schema` is not a `Schema`.

## `decode(schema, array, options?)`

```ts
function decode<S extends AnySchema>(schema: S, array: Parameters<S['decode']>[0], options?: DecodeOptions): ReturnType<S['decode']>;
```

## `stringify(schema, value)`

`schema.stringify(value)`: the text `JSON.stringify` of the wire would be.

## `parse(schema, text, options?)`

`schema.parse(text, options)`: `schema.decode(JSON.parse(text), options)`; text that is not JSON
throws `DecodeError` with code `json` and the `SyntaxError` as `cause`.

## `encodeEach(schema, values)`, `decodeEach(schema, arrays, options?)`

`schema.encodeEach` and `schema.decodeEach` as functions: lazy, a generator over an iterable and an
async generator over an async one (see [Streaming](/guide/streaming)).

## `resolve(writer, reader, options?)`

```ts
import { resolve, register } from '@alexify/protoarray/resolve';

function resolve<S extends AnySchema>(writer: AnySchema, reader: S, options?: ResolveOptions): S;
function register(): void; // installs Schema.resolve

interface ResolveOptions {
  aliases?: Readonly<Record<string, string | readonly string[]>>;  // reader path → the writer's keys
}
```

A schema that reads what `writer` wrote as `reader` objects and writes them back as `writer` does
(see [Migrations](/guide/resolve)).

## `compatible(previous, next, options?)`

```ts
import { compatible, baseline, restore, register } from '@alexify/protoarray/evolve';

function compatible(previous: AnySchema, next: AnySchema, options?: CompatibleOptions): Compatibility;
function baseline(schemas: Readonly<Record<string, AnySchema>>): Baseline;
function restore(baseline: Baseline): Readonly<Record<string, Schema>>;
function register(): void; // installs Schema.compatible

interface CompatibleOptions { strict?: boolean }  // a warning fails the check too
interface Compatibility { ok: boolean; problems: readonly Problem[] }
interface Problem {
  path: string;        // as the errors spell it: 'address.city', 'orders[].sku', '' for the root
  rule: Rule;          // 'inserted' | 'moved' | 'removed' | 'renamed' | 'required' | 'retired' | 'type'
                       // | 'optional' | 'appended' | 'wire' | 'flat' | 'default'
  severity: Severity;  // 'error' | 'warning' | 'info'
  message: string;
  previous?: string;   // the canonical form of the node in `previous`, where there is one
  next?: string;       // the same in `next`
}
interface Baseline { format: 1; snapshots: readonly Snapshot[]; schemas: Readonly<Record<string, BaselineEntry>> }
interface BaselineEntry { snapshot: number; entity: string; options: BaselineOptions; canonical: string; id: string }
```

Whether `next` reads what `previous` writes by position, with every rule a change breaks;
`baseline` writes schemas as JSON and `restore` builds them again (see
[Checking it in CI](/guide/evolution#checking-it-in-ci)).

## Errors

```ts
class SchemaDefinitionError extends TypeError { code: SchemaErrorCode; schema: string; field: string }
class EncodeError extends TypeError { code: EncodeErrorCode; path: string; schema: string }
class DecodeError extends TypeError { code: DecodeErrorCode; path: string; schema: string; cause?: unknown }
```

## Types

| Type | Meaning |
| --- | --- |
| `Decoded<T>` | a value as decode gives it: every key present, the optional ones `\| null` |
| `InputOf<S>`, `OutputOf<S>` | the input and output types of a metaschema schema |
| `Typed` | anything with typed Standard Schema props, as a metaschema `Schema` |
| `Snapshot`, `ModelLike`, `MetaschemaModule`, `SchemaSource` | what a schema is built from |
| `AnySchema` | any `Schema` instance, what the functions and the registry accept |
| `Collection<Output, Input>` | the type of `schema.list` |
| `SchemaOptions`, `ModelOptions`, `EntityOptions`, `DecodeOptions`, `Backend`, `Layout`, `WireType`, `CompiledCodec`, `Codec` | options and their values |
| `Compatibility`, `Problem`, `Rule`, `Severity`, `CompatibleOptions`, `Baseline`, `BaselineEntry`, `BaselineOptions` | what `@alexify/protoarray/evolve` gives and takes |
| `SchemaErrorCode`, `EncodeErrorCode`, `DecodeErrorCode` | the `code` unions |

See [TypeScript](/guide/typescript) for how a schema takes its types from metaschema.

## Removed in 2.0

| 1.x | 2.0 |
| --- | --- |
| a plain object as a definition | a metaschema `Schema`, a snapshot, or `{ metaschema }` |
| `options.schemas` | `Schema.fromModel`, entities of a metaschema `Model` |
| `Schema.keys(keys)` | a definition of `any` fields |
| `schema.check(value)`, `check(schema, value)`, `validate: 'encode' \| 'both' \| 'decode'` | metaschema's `check` and `parse`; `validate` is a boolean |
| `schema.definition` | `schema.snapshot`, `schema.source` |
| `Infer`, `Input`, `Encoded`, `Definition` and the other definition types | `Schema<Output, Input>`, `Decoded`, `InputOf`, `OutputOf` |

See [Migrating from 1.x](/guide/migrating-from-1).

## `toBinary(schema, value)`, `fromBinary(schema, bytes)`

```ts
import { toBinary, fromBinary, register } from '@alexify/protoarray/binary';

function toBinary<S extends AnySchema>(schema: S, value: Parameters<S['encode']>[0]): Uint8Array;
function fromBinary<S extends AnySchema>(schema: S, bytes: Uint8Array): ReturnType<S['decode']>;
function register(): void;   // installs schema.toBinary(value) and schema.fromBinary(bytes)
```

The same schema on the [binary wire](/guide/binary): `toBinary` gives a `Uint8Array` of the value,
`fromBinary` the value back, for a schema or a collection (`schema.list`). The codec is compiled
from the schema's plan on first use and kept on the schema, by the backend the schema runs, and
checks the wire on decode as the schema's `validate` says. Throws `EncodeError` for a value with
no form (`null` at the root, the wrong shape, a union value outside the union, a decimal past the
safe integers, a string or `bytes` slot of another type), `DecodeError` for a message that is not
of the schema (truncated, an index out of range, a required field missing; anything but a
`Uint8Array` is `structure`), and `SchemaDefinitionError` `ERR_NO_BINARY_FORM` for a schema with
interned strings, lists of differences, a `flat` or `columns` layout, or one from `resolve`. Both
sides need the same schema.
