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
| Tuple `['number', 'number']` | an array of fixed length, never trimmed |
| `{ enum: [...] }` | the index; an unknown value → `null` |
| `date` | epoch milliseconds; an invalid date → `null` |
| `bigint` | a decimal string |
| `{ flags: [...] }` | an integer; bit *i* is name *i*; up to 31 names |
| `json` | the value, by reference; never required |
| `string`, `number`, `boolean` | as is |

## Layouts

| Layout | On the wire |
| --- | --- |
| Struct, `{ sparse: true }` | `[mask, ...present values]`; bit *i* of the mask marks field *i*; up to 31 fields |
| Collection, `rows` | `[[...], [...]]` |
| Collection, `flat` | one array; stride = the number of fields; rows never trimmed; a `null` record is a run of `null`s |
| Collection, `columns` | `[column0, column1, ...]`, one array per field, each as long as the list |

## Decoding

| Case | Result |
| --- | --- |
| A required field is `null` or missing | `DecodeError` `required` (with validation); `null` without |
| An optional field is `null` or missing | `null`, the key is present |
| A field with a `default` is `null` or missing | the default |
| A scalar of the wrong type, an enum index out of range | `DecodeError` `type` / `enum` (with validation); passed through without |
| Not an array where one is expected | `DecodeError` `structure`, always |
| Elements beyond the schema | ignored; `DecodeError` `extra` with `{ strict: true }` |
| A `null` element of an array of required items | `DecodeError` `type` (with validation); `null` without |
| Keys on the decoded object | every key of the schema, in schema order |

## Canonical form

`schema.toString()` prints the schema as `{key:type,key:?type=default,...}` with `[item]` for
arrays, `(a,b)` for tuples, `enum(a|b)`, `flags(a|b)`, `@Name` for a reference, a `sparse` prefix
for sparse structs and a `flat` or `columns` prefix for layouts. `schema.id` is the FNV-1a 32-bit
hash of that string as eight hex digits.
