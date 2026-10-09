# Types

How each type travels. Identity types go through as they are; the others are converted on the way
out and back.

| Type | Value | On the wire | Decode checks |
| --- | --- | --- | --- |
| `string` | string | as is | `typeof` |
| `number` | number | as is | `typeof` |
| `boolean` | boolean | as is | `typeof` |
| `json` | anything JSON | as is, by reference | none; never required |
| `date` | `Date` (or a timestamp) | epoch milliseconds | number |
| `bigint` | bigint | decimal string, `'12345678901234567890'` | digits only |
| `{ enum: [...] }` | one of the values | its index, `0` for the first | an integer in range |
| `{ flags: [...] }` | `{ read: true, admin: true }` | a bitmask, `5` | a non-negative integer |
| tuple `['number', 'number']` | `[1, 2]` | `[1, 2]`, fixed length | length and each element |

## Enum

```js
const S = Schema.from({ role: { enum: ['admin', 'editor', 'viewer'] } });
S.encode({ role: 'editor' }); // [1]
S.decode([1]);                // { role: 'editor' }
S.encode({ role: 'nope' });   // [null] — an unknown value is nothing
S.decode([7]);                // DecodeError: Field "role" is not of enum: admin, editor, viewer
```

Values can be strings or numbers; add new ones at the end only, since the index is what travels.

## Date

```js
const S = Schema.from({ at: 'date' });
S.encode({ at: new Date('2023-11-14T22:13:20Z') }); // [1700000000000]
S.decode([1700000000000]);                          // { at: 2023-11-14T22:13:20.000Z }
```

A number is accepted too (`{ at: 1700000000000 }`); an invalid date travels as `null`. Epoch
milliseconds are shorter than ISO strings and ×3 faster to produce than `toISOString()`.

## BigInt

`JSON.stringify` cannot write a BigInt; protoarray writes it as a decimal string and reads it
back with `BigInt()`:

```js
const S = Schema.from({ n: 'bigint' });
S.encode({ n: 12345678901234567890n }); // ['12345678901234567890']
```

## Flags

A `flags` field is an object of booleans that travels as one integer: bit *i* is the *i*-th name.

```js
const S = Schema.from({ perms: { flags: ['read', 'write', 'admin'] } });
S.encode({ perms: { read: true, admin: true } }); // [5]
S.decode([5]);                                    // { perms: { read: true, write: false, admin: true } }
```

Up to 31 names. Add new ones at the end: an older decoder ignores bits it does not know.

## Tuples

A tuple is a fixed-length array of scalars. Elements can be optional; the length never changes:

```js
const S = Schema.from({ pair: ['number', '?string'] });
S.encode({ pair: [1] });   // [[1, null]]
S.decode([[1, null]]);     // { pair: [1, null] }
S.decode([[1]]);           // DecodeError: Field "pair" has a wrong length
```

## json

A `json` field passes any JSON value through by reference, without checks. It is never required:
`null` is a value here.

```js
const S = Schema.from({ payload: 'json', next: 'number' });
S.encode({ payload: { any: [1, { deep: true }] }, next: 2 }); // [{ any: [1, { deep: true }] }, 2]
```

## Defaults

A `default` is the decoded value of a slot that is `null` or missing on the wire. It makes the
field optional, and it is only for `string`, `number`, `boolean`, `json` and `enum` fields:

```js
const S = Schema.from({ balance: { type: 'number', default: 0 }, name: 'string' });
S.encode({ name: 'Alex' }); // [null, 'Alex']
S.decode([null, 'Alex']);   // { balance: 0, name: 'Alex' }
```

An explicit `null` from the sender becomes the default too; encoding never elides a value equal to
the default.

## Numbers, strings and what JSON cannot carry

`NaN` and `Infinity` have no JSON form: `JSON.stringify` writes `null`, so a required number field
holding them fails to decode as missing. Integers beyond 2⁵³ lose precision in JSON as they do in
JavaScript; use `bigint`. `-0` becomes `0`. A `Map`, a `Set`, a `Buffer` or a typed array has no
positional form in this version: under `json` they serialize the way `JSON.stringify` would, which
is rarely what you want.
