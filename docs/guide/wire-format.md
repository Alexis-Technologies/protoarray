# Wire Format

The normative rules. The test suite holds them as data (`tests/support/vectors.js`: a metaschema
definition, the options, a value, its wire and the object it decodes to), and the examples on
these pages come from there. The rules did not change in 2.0: a schema of the same shape has the
same wire and canonical form as in 1.x, and the same id unless it references another entity by
name (see [Canonical form](#canonical-form)).

## Values

| Construct | On the wire |
| --- | --- |
| Struct `{ a, b, c }` | `[a, b, c]` in declaration order |
| Missing, `undefined` or `null` | `null` |
| Trailing `null`s | trimmed: `['Alex', null, null]` ≡ `['Alex']`; all-null ≡ `[]` |
| Nested struct, a schema used as a field | a nested array; `null` when missing; `[]` when every field is missing |
| `{ array: scalar }`, `{ many }` of ids | the same array, by reference |
| `{ array: Record }` | an array of arrays, each row trimmed on its own |
| A reference held as the record | the referenced schema's own wire form, sparseness included |
| A reference held as the id | a string |
| A stored kind's id field (`<entity>Id`) | the last field, optional |
| A calculated field, a function | nothing: no position |
| Tuple `['number', { x: 'number' }]` | an array of fixed length, never trimmed; each element in its own wire form |
| `{ set: T }` | the array of its elements, in iteration order |
| `{ map: { K: V } }` | flat pairs `[k0, v0, k1, v1, …]`, in iteration order |
| `{ object: { string: V } }` | an object with the same keys, each value in its wire form |
| A list of `integer`, `number`, `date` or decimals at a `delta` path | the first value, then each value minus the one before it; `null`s in place, leaving the running value |
| `{ enum: [...] }` | the index, any number of values; an unknown value → `null` |
| `date` | epoch milliseconds; an invalid date → `null` |
| `bigint` | a decimal string |
| `bytes` | canonical base64, standard alphabet with padding (RFC 4648 §4): the text must encode back to itself; decoded as a plain `Uint8Array` |
| `{ type: 'number', decimals: n }` | `Math.round(value × 10ⁿ)`; decoded as a safe integer ÷ 10ⁿ |
| `{ flags: [...] }` | an integer; bit *i* is name *i*; past 31 names an array of 31-bit words (word *i* / 31, bit *i* % 31), still one integer while only the first word has bits set |
| `{ union: [...], discriminator }` | `[tag, ...the branch's other fields]`; the tag is the index of the discriminator value among the values of all branches; trailing optionals trimmed down to `[tag]` |
| `json`, `any`, `unknown` | the value, by reference; never required |
| `null` | `null` |
| `string`, `number`, `integer`, `boolean` | as is |
| An alias of a type | the type it names, down the chain |
| A custom type with a check of its own | the wire type of the `types` option |
| A string at an `intern` path | its index into the message's table; the payload of a schema that holds one is `[table, body]`, the table being the message's distinct interned strings in the order they first appear, one table for the whole message (the entities it reaches and the collections with a layout of their own included) |

## Layouts

| Layout | On the wire |
| --- | --- |
| Struct at a `sparse` path | `[mask, ...present values]`; the mask is a non-negative 31-bit integer, bit *i* marks field *i*; past 31 fields one such segment per 31 fields, trailing empty segments left off |
| Collection, `rows` | `[[...], [...]]` |
| Collection, `flat` | one array; stride = the number of fields; rows never trimmed; a `null` record is a run of `null`s |
| Collection, `columns` | `[column0, column1, ...]`, one array per field, each as long as the list; a missing or `null` column is a column of `null`s; the column of a `delta` field is its first value and the differences, as a delta list |
| A collection inside a record with a layout of its own | that layout, in the collection's slot |
| Envelope (`@alexify/protoarray/registry`) | `[id, payload]`: the writer schema's id, then its wire |

## Encoding

`encode` trusts the values it is given: checking them is metaschema's (`check`, `parse`). It
throws only for what has no wire at all.

| Case | Result |
| --- | --- |
| A required field or tuple element is `null` or missing | `null` |
| A scalar of the wrong type | travels as it is |
| `NaN`, an infinity | `null` in the text (`JSON.stringify`) |
| An invalid date, a value outside the enum | `null` |
| A `null` element of an array of required items | `null` |
| A `null` record in `flat` or `columns` | a run of `null`s, a `null` in each column |
| A record that is not an object (an array is not one), a collection or tuple that is not an array | `EncodeError` `object` / `array` |
| A set that is neither a `Set` nor an array, a map that is not a `Map` | `EncodeError` `set` / `map` |
| A `delta` value that is not a safe integer, or whose difference is not one | `EncodeError` `type` |
| A `decimals` number whose scaled value is not a safe integer (`NaN` and the infinities too) | `EncodeError` `type`, whatever `validate` says |
| A `BigInt` or a `Symbol` as a `date` | `null` |
| A union value whose discriminator is not one of its values | `EncodeError` `union` |
| A cyclic value, or one nested deeper than 512 levels of a recursion (or than the call stack) | `EncodeError` `depth` |
| Keys not in the schema, tuple elements beyond its length | ignored |

## Decoding

"With validation" here is the default, `validate: true`.

| Case | Result |
| --- | --- |
| A required field is `null` or missing | `DecodeError` `required` (with validation); `null` without |
| An optional field is `null` or missing | `null`, the key is present |
| A field with a `default` is `null` or missing | the default |
| A scalar of the wrong type, an enum index out of range, a `date` that is not whole milliseconds within ±8.64e15 | `DecodeError` `type` / `enum` (with validation); passed through without |
| Not an array where one is expected, a sparse mask that is not a non-negative 31-bit integer, an odd map length, a dictionary that is not an object | `DecodeError` `structure`, always |
| An interned payload that is not `[table, body]` | `DecodeError` `structure`, always; a table entry that is not a string, an index outside the table: `structure` / `type` with validation |
| A union tag that is not an integer index of its values | `DecodeError` `union`, always |
| Elements beyond the schema | ignored; `DecodeError` `extra` with `{ strict: true }` |
| A `null` element of an array of required items | `DecodeError` `type` (with validation); `null` without |
| A value with no wire form of its type, without validation | passed through as it is, not converted |
| A payload nested deeper than 512 levels of a recursion (or than the call stack) | `DecodeError` `structure` ("nested too deeply"), always, the same depth on either backend |
| Keys on the decoded object | every key of the schema, in schema order |

## Canonical form

`schema.toString()` prints the schema as `{key:type,key:?type=default,...}` with `[item]` for
arrays, `set[item]`, `map<key,value>`, `object<value>`, `(a,b)` for tuples, `enum(a|b)`,
`flags(a|b)`, `number(2)` for a number with decimals, a `*` suffix for an interned string, a `~`
suffix for a `delta` field and a `~` prefix for a delta list, `union(key)[{…}|{…}]` for a union
(its branches with their discriminators), `@Name` for a reference held as the record, a `sparse`
prefix for sparse structs, a `flat` or `columns` prefix for layouts and a `?` prefix for an
optional root scalar. `any` and `unknown` print as `json`, a reference held as an id as `string`,
an alias as its type; `aliases`, metaschema's rules and metadata do not print. A schema from
`resolve` prints as its writer. A key, an enum value, a flag name, a discriminator or an entity
name that holds the form's punctuation (`:,{}[]()|?=@;*~<>`), begins with a `"` or is empty prints
as a JSON string (`{"a:b":number}`), and so does a string enum value that reads as a number
(`enum("1")`, where `enum(1)` is the number): no two schemas of different wires print the same.

`schema.id` is the FNV-1a 32-bit hash, as eight hex digits, of the schema's signature, taken over
its UTF-16 code units (not UTF-8 bytes, as most FNV-1a implementations): the canonical form, then
`;Name=<canonical form>` for every other entity the schema references by name (`@Name`), sorted by
name as code units (the name printed as in the form); a reference to its own name adds nothing,
nor does the schema itself as the record of its `list`. The `fingerprint` option supplies another
function of the signature.
