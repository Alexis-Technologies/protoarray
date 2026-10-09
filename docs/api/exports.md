# Exports

```js
const {
  Schema,
  encode, decode, stringify, parse,
  SchemaDefinitionError, EncodeError, DecodeError,
} = require('@alexify/protoarray');
```

```ts
import { Schema, type Infer, type Input, type Definition } from '@alexify/protoarray';
```

## `Schema`

```ts
class Schema<const D extends Definition> {
  constructor(name: string, definition: D, options?: SchemaOptions);
  constructor(definition: D, options?: SchemaOptions);
  static from<const D extends Definition>(definition: D, options?: SchemaOptions): Schema<D>;
  static keys<const K extends readonly string[]>(keys: K, options?: SchemaOptions): Schema<…>;

  readonly name: string;
  readonly definition: D;
  readonly keys: readonly string[];
  readonly backend: 'codegen' | 'closures';
  readonly layout: 'dense' | 'sparse' | 'rows' | 'flat' | 'columns';
  readonly id: string;
  readonly list: Collection<D>;

  encode(value: Input<D>): Encoded<D>;
  decode(array: Encoded<D>, options?: DecodeOptions): Infer<D>;
  stringify(value: Input<D>): string;
  parse(text: string, options?: DecodeOptions): Infer<D>;
  toString(): string;
}
```

Compiles a definition once (see [Defining a Schema](/guide/schema)) and carries the codec.
`encode` throws `EncodeError` for a value that is not an object; `decode` and `parse` throw
`DecodeError` (see [Errors](/guide/errors)); a broken definition or option throws
`SchemaDefinitionError` from the constructor.

```ts
interface SchemaOptions {
  codegen?: boolean;   // true: require generated code; false: closures; default: what the runtime allows
  validate?: boolean;  // check the wire on decode (default true)
  sparse?: boolean;    // [mask, ...present values] for a struct of up to 31 fields
  layout?: 'rows' | 'flat' | 'columns';   // for a collection of records
  schemas?: Readonly<Record<string, AnySchema>>;   // referenced by name
}

interface DecodeOptions {
  strict?: boolean;    // reject elements beyond the schema
}
```

## `encode(schema, value)`

```ts
function encode<D>(schema: Schema<D>, value: Input<D>): Encoded<D>;
```

`schema.encode(value)` as a function. Throws `SchemaDefinitionError` with code
`ERR_SCHEMA_EXPECTED` when `schema` is not a `Schema`.

## `decode(schema, array, options?)`

```ts
function decode<D>(schema: Schema<D>, array: Encoded<D>, options?: DecodeOptions): Infer<D>;
```

## `stringify(schema, value)`

```ts
function stringify<D>(schema: Schema<D>, value: Input<D>): string;
```

`JSON.stringify(schema.encode(value))`.

## `parse(schema, text, options?)`

```ts
function parse<D>(schema: Schema<D>, text: string, options?: DecodeOptions): Infer<D>;
```

`schema.decode(JSON.parse(text), options)`; text that is not JSON throws `DecodeError` with code
`json` and the `SyntaxError` as `cause`.

## Errors

```ts
class SchemaDefinitionError extends TypeError { code: SchemaErrorCode; schema: string; field: string }
class EncodeError extends TypeError { code: 'object'; path: string }
class DecodeError extends TypeError { code: DecodeErrorCode; path: string; cause?: unknown }
```

## Types

| Type | Meaning |
| --- | --- |
| `Definition`, `FieldDefinition`, `StructDefinition`, `LongForm`, `TupleElement` | the definition DSL |
| `AnySchema` | any `Schema` instance, what a field or `options.schemas` accepts |
| `Infer<D>` | the decoded object type |
| `Input<D>` | the value `encode` accepts |
| `Encoded<D>` | the wire: `unknown[]`, or `unknown` for a scalar schema |
| `Collection<D>` | the type of `schema.list` |
| `SchemaOptions`, `DecodeOptions`, `Backend`, `Layout` | options and their values |
| `SchemaErrorCode`, `EncodeErrorCode`, `DecodeErrorCode` | the `code` unions |

See [TypeScript](/guide/typescript) for how `Infer` and `Input` map each form of the definition.
