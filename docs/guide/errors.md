# Errors and Validation

protoarray throws three error classes, all `TypeError`s with a `code`.

| Class | When | Properties |
| --- | --- | --- |
| `SchemaDefinitionError` | the definition or the options are wrong, when the schema is built | `code`, `schema` (the name), `field` (`address.city`) |
| `EncodeError` | `encode` gets a value that is not an object | `code: 'object'`, `path` |
| `DecodeError` | the wire does not match the schema, or `parse` gets text that is not JSON | `code`, `path`, `cause` |

## Decode errors

| Code | Meaning | Example message |
| --- | --- | --- |
| `structure` | not an array where one is expected, a wrong tuple or `flat` length, a bad sparse mask | `Field "address" is not an array` |
| `required` | a required field is `null` or missing | `Field "email" is required` |
| `type` | a value of the wrong type, or a `null` element where the item is required | `Field "orders[1].qty" is not of expected type: number` |
| `enum` | an index outside the enum | `Field "role" is not of enum: admin, editor` |
| `extra` | elements beyond the schema, with `{ strict: true }` | `Value has extra elements` |
| `json` | `parse` got text that is not JSON; `cause` is the `SyntaxError` | `Value is not valid JSON` |

`path` names the slot: `''` for the value itself, keys joined with dots, indexes in brackets:
`orders[1].qty`, `[2].name` in a collection. Paths cost nothing until an error is thrown.

```js
try {
  User.decode([1, 'Alex', 7]);
} catch (error) {
  error instanceof DecodeError; // true
  error.code;                   // 'enum'
  error.path;                   // 'role'
  error.message;                // 'Field "role" is not of enum: admin, editor, viewer'
}
```

## What is validated

With the default `validate: true`, decoding checks the array structure, the type of every scalar,
required fields, enum ranges, tuple lengths and `flat`/`columns` shapes. It costs a few percent
of the decode time. `{ validate: false }` skips the type and required checks and trusts the wire,
but still checks the array structure, so a bad payload fails with `structure` rather than an
accidental `TypeError` from inside the decoder.

Encoding does not validate in this version: it reads the fields the schema names and trusts their
types. To validate values before sending them, run the same definition through
[`@alexify/metaschema`](https://metaschema.vercel.app/guide/validation)'s `check`.

## Definition errors

| Code | Cause |
| --- | --- |
| `ERR_INVALID_DEFINITION` | not a definition, an empty struct or tuple, a duplicate key, a bad default, a non-scalar tuple element |
| `ERR_UNKNOWN_TYPE` | an unknown type name, a metaschema shorthand protoarray does not support, or a struct starting with a type name |
| `ERR_INVALID_ENUM`, `ERR_INVALID_FLAGS` | an empty list, duplicates, wrong value types, more than 31 flags |
| `ERR_UNKNOWN_REFERENCE` | a capitalised name that is neither the schema's own name nor in `options.schemas` |
| `ERR_RESERVED_KEY` | `__proto__` as a key |
| `ERR_INTEGER_KEY` | a key like `'1'`, which JavaScript would order first |
| `ERR_INVALID_OPTIONS` | an unknown option, a wrong type, `sparse` on a non-struct or on more than 31 fields, a layout on a non-collection |
| `ERR_CODEGEN_UNAVAILABLE` | `{ codegen: true }` where `new Function` is blocked |
| `ERR_SCHEMA_EXPECTED` | `encode(schema, …)` and friends called with something that is not a `Schema` |

Messages say where: `Unknown type "float" at "price"`.
