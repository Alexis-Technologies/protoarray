# Wire Format

The normative rules. The test suite holds them as data (`tests/support/vectors.js`), and the
examples on these pages come from there.

## Values

| Construct | On the wire |
| --- | --- |
| Struct `{ a, b, c }` | `[a, b, c]` in declaration order |
| Missing, `undefined` or `null` | `null` |
| Trailing `null`s | trimmed: `['Alex', null, null]` ≡ `['Alex']`; all-null ≡ `[]` |
| Nested struct | a nested array; `null` when missing; `[]` when every field is missing |
| `{ array: scalar }` | the same array, by reference |
| `{ array: Record }` | an array of arrays, each row trimmed on its own |
| A `Schema` used by value or by name | its own wire form, layout and sparseness included |
| Tuple `['number', { x: 'number' }]` | an array of fixed length, never trimmed; each element in its own wire form |
| `{ set: T }` | the array of its elements, in iteration order |
| `{ map: { K: V } }` | flat pairs `[k0, v0, k1, v1, …]`, in iteration order |
| `{ object: { string: V } }` | an object with the same keys, each value in its wire form |
| `{ array: integer \| date \| decimals, delta: true }` | the first value, then each value minus the one before it; `null`s in place, leaving the running value |
| `{ enum: [...] }` | the index, any number of values; an unknown value → `null` |
| `date` | epoch milliseconds; an invalid date → `null` |
| `bigint` | a decimal string |
| `bytes` | canonical base64, standard alphabet with padding (RFC 4648 §4): the text must encode back to itself; decoded as a plain `Uint8Array` |
| `{ type: 'number', decimals: n }` | `Math.round(value × 10ⁿ)`, a safe integer; decoded as that integer ÷ 10ⁿ |
| `{ flags: [...] }` | an integer; bit *i* is name *i*; past 31 names an array of 31-bit words (word *i* / 31, bit *i* % 31), still one integer while only the first word has bits set |
| `{ union: [...], discriminator }` | `[tag, ...the branch's other fields]`; the tag is the index of the discriminator value among the values of all branches; trailing optionals trimmed down to `[tag]` |
| `json`, `any`, `unknown` | the value, by reference; never required |
| `null` | `null` |
| `string`, `number`, `integer`, `boolean` | as is |
| An interned string (`intern`) | its index into the message's table; the payload of a schema that holds one is `[table, body]`, the table being the message's distinct interned strings in the order they first appear |

## Layouts

| Layout | On the wire |
| --- | --- |
| Struct, `{ sparse: true }` | `[mask, ...present values]`; the mask is a non-negative 31-bit integer, bit *i* marks field *i*; past 31 fields one such segment per 31 fields, trailing empty segments left off |
| Collection, `rows` | `[[...], [...]]` |
| Collection, `flat` | one array; stride = the number of fields; rows never trimmed; a `null` record is a run of `null`s (without encode validation) |
| Collection, `columns` | `[column0, column1, ...]`, one array per field, each as long as the list; a missing or `null` column is a column of `null`s; the column of a `delta` field is its first value and the differences, as a delta list |
| Envelope (`@alexify/protoarray/registry`) | `[id, payload]`: the writer schema's id, then its wire |

## Encoding

"With validation" here is `validate: 'both'` or `'encode'`; by default the values are trusted.

| Case | Result |
| --- | --- |
| A required field or tuple element is `null` or missing | `EncodeError` `required` (with validation); `null` without |
| A scalar of the wrong type, `NaN`, an infinity, an invalid date | `EncodeError` `type` (with validation); travels as it is (`null` for the last three) without |
| A value outside the enum | `EncodeError` `enum` (with validation); `null` without |
| A `null` element of an array of required items, a `null` record in `flat` or `columns` | `EncodeError` `type` (with validation); `null` (a run of `null`s) without |
| A record that is not an object (an array is not one), a collection or tuple that is not an array | `EncodeError` `object` / `array`, always |
| A set that is neither a `Set` nor an array, a map that is not a `Map` | `EncodeError` `set` / `map`, always |
| A `delta` value that is not a safe integer, or whose difference is not one | `EncodeError` `type`, always |
| A union value whose discriminator is not one of its values | `EncodeError` `union`, always |
| A cyclic value, or one nested deeper than the call stack | `EncodeError` `depth`, always |
| Keys not in the schema, tuple elements beyond its length | ignored |

## Decoding

"With validation" here is the default `validate: true` (or `'decode'` and `'both'`).

| Case | Result |
| --- | --- |
| A required field is `null` or missing | `DecodeError` `required` (with validation); `null` without |
| An optional field is `null` or missing | `null`, the key is present |
| A field with a `default` is `null` or missing | the default |
| A scalar of the wrong type, an enum index out of range | `DecodeError` `type` / `enum` (with validation); passed through without |
| Not an array where one is expected, a sparse mask that is not a non-negative 31-bit integer, an odd map length, a dictionary that is not an object | `DecodeError` `structure`, always |
| An interned payload that is not `[table, body]` | `DecodeError` `structure`, always; a table entry that is not a string, an index outside the table: `structure` / `type` with validation |
| A union tag that is not an integer index of its values | `DecodeError` `union`, always |
| Elements beyond the schema | ignored; `DecodeError` `extra` with `{ strict: true }` |
| A `null` element of an array of required items | `DecodeError` `type` (with validation); `null` without |
| A value with no wire form of its type, without validation | passed through as it is, not converted |
| A recursive schema's payload nested deeper than the call stack | `DecodeError` `structure` ("nested too deeply"), always |
| Keys on the decoded object | every key of the schema, in schema order |

## Canonical form

`schema.toString()` prints the schema as `{key:type,key:?type=default,...}` with `[item]` for
arrays, `set[item]`, `map<key,value>`, `object<value>`, `(a,b)` for tuples, `enum(a|b)`,
`flags(a|b)`, `number(2)` for a number with decimals, a `*` suffix for an interned string, a `~`
suffix for a `delta` field and a `~` prefix for a delta list, `union(key)[{…}|{…}]` for a union
(its branches with their discriminators), `@Name` for a reference, a `sparse` prefix for sparse
structs, a `flat` or `columns` prefix for layouts and a `?` prefix for an optional root scalar.
`any` and `unknown` print as `json`; `aliases` do not print. A schema from `Schema.resolve`
prints as its writer. `schema.id` is the FNV-1a 32-bit hash of that string as eight hex digits, unless the
`fingerprint` option supplies another function of it.
