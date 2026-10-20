# Errors and Validation

protoarray throws three error classes, all `TypeError`s with a `code` and the name of the schema
involved (`schema`, `''` for a nameless one), so a log line says which contract was broken.

| Class | When | Properties |
| --- | --- | --- |
| `SchemaDefinitionError` | a snapshot protoarray cannot read, or wrong options, when the schema is built | `code`, `schema` (the name), `field` (`address.city`) |
| `EncodeError` | `encode` gets a value with no wire: the wrong shape, a cycle, a union value outside the union | `code`, `path`, `schema` |
| `DecodeError` | the wire does not match the schema, or `parse` gets text that is not JSON | `code`, `path`, `schema`, `cause`, `id` (an envelope's) |

A definition is metaschema's to read, so a definition metaschema refuses throws metaschema's own
`SchemaDefinitionError` (`ERR_UNKNOWN_TYPE`, `ERR_INVALID_DEFINITION`, …): another class with the
same `code`, `schema` and `field`, which `instanceof` protoarray's class does not match. Tell the
two by `name` and `code`, or catch both.

## Decode errors

| Code | Meaning | Example message |
| --- | --- | --- |
| `structure` | not an array where one is expected, a wrong tuple, `flat` or map length, a bad sparse mask, an interned payload that is not `[table, body]`, an envelope that is not `[id, payload]`, a payload nested deeper than the call stack (or than `maxDepth` levels of a recursion), a streamed line or item longer than `maxLength` | `Field "address" is not an array`, `Field "next.next…" is nested too deeply`, `Field "[3]" is longer than maxLength allows` |
| `required` | a required field is `null` or missing | `Field "email" is required` |
| `type` | a value of the wrong type, or a `null` element where the item is required | `Field "orders[1].qty" is not of expected type: number` |
| `enum` | an index outside the enum (a long enum names its first 16 values) | `Field "role" is not of enum: admin, editor` |
| `union` | a union's tag is not one of its indexes (always checked) | `Field "type" is not of union: call, event` |
| `extra` | elements beyond the schema, with `{ strict: true }` | `Value has extra elements` |
| `json` | `parse` got text that is not JSON (an NDJSON line, an item of a streamed array); `cause` is the `SyntaxError` | `Value is not valid JSON` |
| `schema` | an envelope's id is not in the registry, or names a version the reader cannot resolve (`cause` is its `ERR_INCOMPATIBLE`); the id is `error.id` | `Value is not of a schema this reader can read` |

`path` names the slot: `''` for the value itself, keys joined with dots, indexes in brackets:
`orders[1].qty`, `[2].name` in a collection, `[].price` for a column of a `columns` collection. A
key that holds a dot, brackets or braces, begins with a quote or is empty is a quoted JSON string
in brackets (`["a.b"].c`), and so is a dictionary's key that is not a plain name, cut to 64
characters (`scores["a b"]`): the payload gives it. A path keeps 64 levels at most, both ends.
Paths cost nothing until an error is thrown. `message`, `path` and `code` never carry a line
break or an escape sequence from the payload, so they are safe to log; `cause` may quote it.

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

`encode` trusts its values and throws only for what has no wire at all:

| Code | Meaning | Example message |
| --- | --- | --- |
| `object`, `array`, `set`, `map` | a record that is not an object, a collection or tuple that is not an array, a set that is neither a `Set` nor an array, a map that is not a `Map` (told by its brand, not a tag it claims) | `Field "orders[1]" is not an object` |
| `iterable` | `encodeEach` and the stream helpers got something that is not iterable | `Value is not iterable` |
| `depth` | a cyclic value, or one nested deeper than the call stack (or than `maxDepth` levels of a recursion) | `Field "next.next…" is nested too deeply` |
| `union` | a union's discriminator is not one of its values | `Field "type" is not of union: call, event` |
| `type` | a value a `delta` list or column cannot hold (only integers have exact differences), a `decimals` number that scales past the safe integers | `Field "ids" is not of expected type: [integer]` |

## What is validated

The two sides of a codec are checked by the two libraries:

| Side | Checked by | How |
| --- | --- | --- |
| The values given to `encode` | metaschema | `schema.source.check(value)`, or `parse` |
| The wire given to `decode` | protoarray | `validate: true`, the default |

**Decoding** with validation checks the array structure, the type of every scalar, required
fields, enum ranges, tuple lengths and `flat`/`columns` shapes. It costs a few percent of the
decode time, and it is the only error path: whatever the input, `decode` and `parse` throw
`DecodeError` and nothing else. `{ validate: false }` trusts the wire: it skips the type and
required checks, but still checks the array structure, a sparse mask and a union tag, so a bad
payload fails with `structure` or `union` rather than an accidental `TypeError` from inside the
decoder. A value that has no wire form of its type (a non-digit string in a `bigint` slot, a
string in an `enum` slot) is then left as it is: not converted, not rejected.

**Encoding** trusts the values, as protoarray 1.0 did: an unknown enum value travels as `null`, a
value of the wrong type travels as it is, a missing required field as `null`. Keys the schema does
not have and tuple elements past its length are ignored: a schema is a projection. The values are
metaschema's to check, against every rule of the definition (types, required fields, enums, and
the rules the wire knows nothing of: `length`, `min`, `pattern`, `format`, `validate`). A schema
built from a metaschema `Schema` keeps it as `source`:

```js
const result = User.source.check(input);
if (!result.valid) reply(400, { errors: result.errors });
else send(User.stringify(input));
```

`parse` does the same and applies metaschema's defaults and field codecs on the way (see
[metaschema's parse](https://metaschema.vercel.app/guide/parse)). A schema built from a snapshot
has no `source`; build the metaschema schema where the values are produced, from the same
definition. A decoded object passes metaschema's `check`: every key present, `null` for the
optional ones that were missing.

## Depth

A recursive schema (`Node` with `kids: { array: 'Node' }`, a linked list) goes as deep as the
call stack by default: past it, `decode` throws `DecodeError` `structure` and `encode`
`EncodeError` `depth`, `Value is nested too deeply`, with no path. Where that happens depends on
the backend and the engine: the closures backend uses more frames a level, so it reaches the end
of the stack sooner than generated code (on Node.js 24, about 1,800 levels of a linked list
against 3,500, and less inside a deep call). A server on generated code can then write a payload
that a client under a strict CSP cannot read.

`maxDepth` sets the limit instead: every entity a recursion goes through counts its levels, and
one past the limit is the same error, with its path, on either backend and in generated modules.

```js
const { Node } = Schema.fromModel(model, { maxDepth: 512 });
Node.decode(deeper); // DecodeError: Field "kids[0].kids[0]…" is nested too deeply
```

512 is a depth both backends reach on every engine. A schema without a recursion is never
counted; one with a limit encodes about 8% and decodes about 3.5% slower on deep trees, which is
why the limit is opt-in. The entities a reference reaches, `schema.list` and a resolved schema
(the reader's option) take it; `entities` gives one entity a limit of its own.

## Schema errors

A broken snapshot or option throws protoarray's `SchemaDefinitionError` when the schema is built.
Messages say where: `Unknown type "float" at "price"`.

| Code | Cause |
| --- | --- |
| `ERR_INVALID_SNAPSHOT` | not a snapshot of format 1, no entity of the name asked for, an entity that is not an object, a field without a type, a schema nested too deeply, a collection without its key or element, a tuple without elements, `decimals` outside 0–15, `aliases` that are not a list of keys, references that lead back to themselves with no record, a snapshot that breaks the reader unchecked (`cause`), a baseline of `@alexify/protoarray/evolve` that is not one of format 1 or does not rebuild to the canonical form it was written with |
| `ERR_UNKNOWN_TYPE` | an unknown type, a custom type with a check of its own and no wire type in `types` |
| `ERR_INVALID_ENUM`, `ERR_INVALID_FLAGS` | an empty list, duplicates, wrong value types, `__proto__` (neither has a size limit) |
| `ERR_INVALID_UNION` | a union without a `discriminator`, an empty union, a branch that is not a struct with the discriminator as a required enum without a default, the same value in two branches |
| `ERR_UNKNOWN_REFERENCE` | a reference to an entity the snapshot does not have (a reference by name needs a `Model`, or the schema's own name) |
| `ERR_RESERVED_KEY` | `__proto__` as a key |
| `ERR_INTEGER_KEY` | a key or a flag name like `'1'`, which JavaScript would order first |
| `ERR_INVALID_DEFINITION` | a struct without fields, an empty key |
| `ERR_INVALID_OPTIONS` | an unknown option, a wrong type, a path that names no place of the schema or a place of another kind (`sparse` on a non-struct, a layout on anything but a collection of records, `delta` on a string, `intern` on anything but a string), `layout: 'rows'` on anything but a collection, `sparse` on a union's branch, an option of one schema given to `Schema.fromModel` instead of `entities`, an `entities` key that names no entity of the snapshot or an entity's own `entity`, `entities` or `metaschema`, a snapshot of several entities without `entity`, `entity` other than a metaschema Schema's own, a `fingerprint` that gives no non-empty string, an `aliases` path of `resolve` that names no field of the reader, a `maxLength` that is not a positive integer or `Infinity` |
| `ERR_SCHEMA_EXPECTED` | `Schema.from` got neither a metaschema `Schema` or `Model`, a snapshot, a protoarray schema nor a definition with `{ metaschema }`; `encode(schema, …)` and friends got something that is not a `Schema`; `compatible` got a resolved schema, `baseline` a schema not read from a snapshot (`schema.list`, a resolved one) |
| `ERR_CODEGEN_UNAVAILABLE` | `{ codegen: true }` where `new Function` is blocked |
| `ERR_COMPILED_MISMATCH` | a generated module's codec is of another schema than the snapshot given with it, or the module was generated by another version of protoarray |
| `ERR_INCOMPATIBLE` | `resolve` cannot read the writer as the reader: a narrowing type change, a required reader field the writer lacks, a union split between branches, a chain of references too long for the stack (for `compatible` too) |
| `ERR_ID_COLLISION` | a registry got two schemas of different signatures with one id: the fingerprint is too narrow for it |
| `ERR_UNKNOWN_SCHEMA` | a registry's `encode` got `as` an id it does not know |
