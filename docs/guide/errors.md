# Errors and Validation

protoarray throws three error classes, all `TypeError`s with a `code` and the name of the schema
involved (`schema`, `''` for a nameless one), so a log line says which contract was broken.

| Class | When | Properties |
| --- | --- | --- |
| `SchemaDefinitionError` | the definition or the options are wrong, when the schema is built | `code`, `schema` (the name), `field` (`address.city`) |
| `EncodeError` | `encode` gets a value of the wrong shape, or one validation rejects | `code`, `path`, `schema` |
| `DecodeError` | the wire does not match the schema, or `parse` gets text that is not JSON | `code`, `path`, `schema`, `cause` |

## Decode errors

| Code | Meaning | Example message |
| --- | --- | --- |
| `structure` | not an array where one is expected, a wrong tuple or `flat` length, a bad sparse mask, a recursive schema's payload nested deeper than the call stack | `Field "address" is not an array`, `Value is nested too deeply` |
| `required` | a required field is `null` or missing | `Field "email" is required` |
| `type` | a value of the wrong type, or a `null` element where the item is required | `Field "orders[1].qty" is not of expected type: number` |
| `enum` | an index outside the enum | `Field "role" is not of enum: admin, editor` |
| `union` | a union's tag is not one of its indexes (always checked) | `Field "type" is not of union: call, event` |
| `extra` | elements beyond the schema, with `{ strict: true }` | `Value has extra elements` |
| `json` | `parse` got text that is not JSON; `cause` is the `SyntaxError` | `Value is not valid JSON` |

`path` names the slot: `''` for the value itself, keys joined with dots, indexes in brackets:
`orders[1].qty`, `[2].name` in a collection. Paths cost nothing until an error is thrown. Messages
name the path and the expected type, never a value from the payload, so they are safe to log.

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

## Encode errors

| Code | Meaning | Example message |
| --- | --- | --- |
| `object`, `array` | a record that is not an object, a collection or tuple that is not an array (always checked) | `Field "orders[1]" is not an object` |
| `depth` | a cyclic value, or one nested deeper than the call stack (always) | `Value is nested too deeply` |
| `required` | a required field or tuple element is `null` or missing | `Field "address.city" is required` |
| `type` | a value of the wrong type (`NaN` and the infinities are not numbers here), or a `null` element where the item is required | `Field "tags[1]" is not of expected type: string` |
| `enum` | a value outside the enum | `Field "role" is not of enum: admin, editor` |
| `union` | a union's discriminator is not one of its values (always checked) | `Field "type" is not of union: call, event` |

## What is validated

`validate` picks the direction that is checked:

| `validate` | Values given to `encode` | The wire, on `decode` |
| --- | --- | --- |
| `true` (default) or `'decode'` | trusted, as in 1.0 | checked |
| `'both'` | checked | checked |
| `'encode'` | checked | trusted |
| `false` | trusted | trusted |

Decoding with validation checks the array structure, the type of every scalar, required fields,
enum ranges, tuple lengths and `flat`/`columns` shapes. It costs a few percent of the decode time,
and it is the only error path: whatever the input, `decode` and `parse` throw `DecodeError` and
nothing else. Trusting the wire (`'encode'` or `false`) skips the type and required checks, but
still checks the array structure, a sparse mask and a union tag, so a bad payload fails with
`structure` or `union` rather than an accidental `TypeError` from inside the decoder. A value that
has no wire form of its type (a non-digit string in a `bigint` slot, a string in an `enum` slot)
is then left as it is: not converted, not rejected.

Checking the values on encode (`'both'` or `'encode'`) makes a producer's bug fail at the producer
instead of as a `DecodeError` on the other side: every scalar is checked against its type, required
fields and tuple elements must be present, enum values must be in the list (an exact match: `'20'`
is not `20`), and `NaN`, the infinities and invalid dates are rejected, since JSON would turn them
into `null`. A `date` takes a `Date` or a timestamp, a `bigint` a BigInt, a safe integer or a
string of digits. Keys the schema does not have and tuple elements past its length are ignored: a
schema is a projection. The checks are compiled into the codec, so they cost a few percent of
`stringify` with generated code and about a tenth with closures; a codec that does not ask for
them carries none. By default encoding trusts its input as 1.0 did: an unknown enum value travels
as `null` and a value of the wrong type travels as it is. The shape checks (`object`, `array`,
and an array is not a record), a union's discriminator and `depth` stay on in every mode.

A schema used inside another one keeps its own `validate`, in both directions.

## Checking without encoding

`schema.check(value)` returns the `EncodeError` that encoding the value with validation would
throw, or `null`, and never throws over the data, so it fits a form or an API boundary:

```js
const error = User.check(input);
if (error !== null) reply(400, { code: error.code, path: error.path, message: error.message });
```

It runs every check even when the schema, or a schema it embeds, was built with
`validate: false`; that codec is compiled once, on the first call. A cyclic value is the error
`depth`. `check(schema, value)` is the same as a function.

## Definition errors

| Code | Cause |
| --- | --- |
| `ERR_INVALID_DEFINITION` | not a definition, an empty struct or tuple, a duplicate key, a bad default, a non-scalar tuple element, a `decimals` outside 0–15 or on anything but a number |
| `ERR_UNKNOWN_TYPE` | an unknown type name, a metaschema shorthand protoarray does not support (a `union` without a `discriminator` too), or a struct starting with a type name |
| `ERR_INVALID_UNION` | an empty union, a branch that is not a dense struct with the discriminator as a required enum without a default, the same value in two branches |
| `ERR_INVALID_ENUM`, `ERR_INVALID_FLAGS` | an empty list, duplicates, wrong value types (neither has a size limit) |
| `ERR_UNKNOWN_REFERENCE` | a capitalised name that is neither the schema's own name nor in `options.schemas` |
| `ERR_RESERVED_KEY` | `__proto__` as a key |
| `ERR_INTEGER_KEY` | a key like `'1'`, which JavaScript would order first |
| `ERR_INVALID_OPTIONS` | an unknown option, a wrong type, `sparse` on a non-struct, a layout on a non-collection |
| `ERR_CODEGEN_UNAVAILABLE` | `{ codegen: true }` where `new Function` is blocked |
| `ERR_SCHEMA_EXPECTED` | `encode(schema, …)` and friends called with something that is not a `Schema` |

Messages say where: `Unknown type "float" at "price"`.
