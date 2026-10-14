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
| Tuple `['number', 'number']` | an array of fixed length, never trimmed |
| `{ enum: [...] }` | the index, any number of values; an unknown value → `null` |
| `date` | epoch milliseconds; an invalid date → `null` |
| `bigint` | a decimal string |
| `{ flags: [...] }` | an integer; bit *i* is name *i*; past 31 names an array of 31-bit words (word *i* / 31, bit *i* % 31), still one integer while only the first word has bits set |
| `{ union: [...], discriminator }` | `[tag, ...the branch's other fields]`; the tag is the index of the discriminator value among the values of all branches; trailing optionals trimmed down to `[tag]` |
| `json` | the value, by reference; never required |
| `string`, `number`, `boolean` | as is |

## Layouts

| Layout | On the wire |
| --- | --- |
| Struct, `{ sparse: true }` | `[mask, ...present values]`; bit *i* of the mask marks field *i*; past 31 fields one such segment per 31 fields, trailing empty segments left off |
| Collection, `rows` | `[[...], [...]]` |
| Collection, `flat` | one array; stride = the number of fields; rows never trimmed; a `null` record is a run of `null`s (without validation) |
| Collection, `columns` | `[column0, column1, ...]`, one array per field, each as long as the list; a missing or `null` column is a column of `null`s |

## Encoding

| Case | Result |
| --- | --- |
| A required field or tuple element is `null` or missing | `EncodeError` `required` (with validation); `null` without |
| A scalar of the wrong type, `NaN`, an infinity, an invalid date | `EncodeError` `type` (with validation); travels as it is (`null` for the last three) without |
| A value outside the enum | `EncodeError` `enum` (with validation); `null` without |
| A `null` element of an array of required items, a `null` record in `flat` or `columns` | `EncodeError` `type` (with validation); `null` (a run of `null`s) without |
| A record that is not an object, a collection or tuple that is not an array | `EncodeError` `object` / `array`, always |
| A union value whose discriminator is not one of its values | `EncodeError` `union`, always |
| A cyclic value, or one nested deeper than the call stack | `EncodeError` `depth`, always |
| Keys not in the schema, tuple elements beyond its length | ignored |

## Decoding

| Case | Result |
| --- | --- |
| A required field is `null` or missing | `DecodeError` `required` (with validation); `null` without |
| An optional field is `null` or missing | `null`, the key is present |
| A field with a `default` is `null` or missing | the default |
| A scalar of the wrong type, an enum index out of range | `DecodeError` `type` / `enum` (with validation); passed through without |
| Not an array where one is expected | `DecodeError` `structure`, always |
| A union tag that is not an integer index of its values | `DecodeError` `union`, always |
| Elements beyond the schema | ignored; `DecodeError` `extra` with `{ strict: true }` |
| A `null` element of an array of required items | `DecodeError` `type` (with validation); `null` without |
| A value with no wire form of its type, without validation | passed through as it is, not converted |
| A recursive schema's payload nested deeper than the call stack | `DecodeError` `structure` ("nested too deeply"), always |
| Keys on the decoded object | every key of the schema, in schema order |

## Canonical form

`schema.toString()` prints the schema as `{key:type,key:?type=default,...}` with `[item]` for
arrays, `(a,b)` for tuples, `enum(a|b)`, `flags(a|b)`, `union(key)[{…}|{…}]` for a union (its branches with their discriminators), `@Name`
for a reference, a `sparse` prefix
for sparse structs, a `flat` or `columns` prefix for layouts and a `?` prefix for an optional root
scalar. `schema.id` is the FNV-1a 32-bit hash of that string as eight hex digits, unless the
`fingerprint` option supplies another function of it.
