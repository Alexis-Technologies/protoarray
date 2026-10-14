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
| `{ union: [...], discriminator }` | `{ type: 'event', name: 'x' }` | `[tag, ...the branch's other fields]`, `[1, 'x']` | the tag, always; then the branch |

## Enum

```js
const S = Schema.from({ role: { enum: ['admin', 'editor', 'viewer'] } });
S.encode({ role: 'editor' }); // [1]
S.decode([1]);                // { role: 'editor' }
S.encode({ role: 'nope' });   // EncodeError: Field "role" is not of enum: admin, editor, viewer
S.decode([7]);                // DecodeError: Field "role" is not of enum: admin, editor, viewer
```

Values can be strings or numbers, as many as needed; add new ones at the end only, since the index
is what travels. The value must match exactly (`'1'` is not `1`); with `validate: false` an
unknown value travels as `null`.

## Date

```js
const S = Schema.from({ at: 'date' });
S.encode({ at: new Date('2023-11-14T22:13:20Z') }); // [1700000000000]
S.decode([1700000000000]);                          // { at: 2023-11-14T22:13:20.000Z }
```

A number is accepted too (`{ at: 1700000000000 }`). An invalid date, `NaN` or anything else is an
`EncodeError`; with `validate: false` an invalid date travels as `null`.
Epoch milliseconds are shorter than ISO strings and ×3 faster to produce than `toISOString()`.

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

Any number of names. Past 31 the bitmask takes an array of 31-bit words, written as one integer
while only the first word has bits set: `[[1, 16]]` is names 0 and 35. A decoder reads either
form. Add new names at the end: an older decoder ignores bits it does not know, and a newer one
reads a missing word as zero.

## Tuples

A tuple is a fixed-length array of scalars. Elements can be optional; the length never changes:

```js
const S = Schema.from({ pair: ['number', '?string'] });
S.encode({ pair: [1] });   // [[1, null]]
S.decode([[1, null]]);     // { pair: [1, null] }
S.decode([[1]]);           // DecodeError: Field "pair" has a wrong length
```

## Unions

A discriminated union, in metaschema's spelling: each branch is a struct, and the `discriminator`
field of every branch is an `enum`. The value of that field picks the branch; on the wire its
index leads and the other fields of the branch follow, so the discriminator never travels twice.

```js
const Packet = Schema.from({
  union: [
    { Struct: {}, type: { enum: ['call'] }, id: 'string', method: 'string', args: '?json' },
    { Struct: {}, type: { enum: ['event'] }, name: 'string', data: '?json' },
  ],
  discriminator: 'type',
});
Packet.encode({ type: 'call', id: '7', method: 'auth/signIn', args: ['alex', 'secret'] });
// [0, '7', 'auth/signIn', ['alex', 'secret']]
Packet.encode({ type: 'event', name: 'chat/message' }); // [1, 'chat/message']
Packet.decode([1, 'chat/message']);                    // { type: 'event', name: 'chat/message', data: null }
```

- **The tag** is the index of the value among the values of all branches, in order: a branch
  `{ kind: { enum: ['square', 'diamond'] } }` after a one-value branch owns tags `1` and `2`.
- **A branch** is an inline struct, a `Schema` of a struct or a name from `options.schemas`. It is
  built again from its definition, so the union's options apply to it. Each branch's trailing
  optional fields are trimmed, down to `[tag]`, and a field may refer to the union by its own name.
- **The kind key.** A struct whose first key is `type` reads as the long form `{ type: 'string' }`,
  in metaschema as here, so a branch with `type` first names its kind before it: `{ Struct: {}, … }`.
  A branch whose discriminator is not first needs nothing.
- **Errors.** A discriminator outside the union is an `EncodeError` with code `union`, and a tag
  outside the union a `DecodeError` `union`, even with `validate: false`: there is no branch to fall
  back to. The decoded object has the branch's keys in the branch's order.

A union can be the whole schema, a field or the item of an array: `Packet.list` encodes a batch as
`[[0, …], [1, …]]`. It cannot be sparse or use the `flat` and `columns` layouts. A union without a
`discriminator` (metaschema's `{ union: ['string', 'number'] }`) has no positional form yet.

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

`NaN` and `Infinity` have no JSON form: `JSON.stringify` would write `null`, so encoding rejects
them as `type` errors (with `validate: false` they travel as `null` and a required field fails to
decode as missing). Integers beyond 2⁵³ lose precision in JSON as they do in
JavaScript; use `bigint`. `-0` becomes `0`. A `Map`, a `Set`, a `Buffer` or a typed array has no
positional form in this version: under `json` they serialize the way `JSON.stringify` would, which
is rarely what you want.
