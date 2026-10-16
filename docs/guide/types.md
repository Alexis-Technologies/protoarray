# Types

How each type of metaschema's language travels. Identity types go through as they are; the others
are converted on the way out and back. The spellings are metaschema's
([types](https://metaschema.vercel.app/guide/types)); the examples build schemas from a definition
with metaschema injected:

```js
const { Schema } = require('@alexify/protoarray');
const metaschema = require('@alexify/metaschema');
```

| Type | Value | On the wire | Decode checks |
| --- | --- | --- | --- |
| `string` | string | as is | `typeof` |
| `string` at an `intern` path | string | its index into the message's string table | an index into the table |
| `number` | number | as is | `typeof` |
| `integer` | an integer | as is | `Number.isInteger` |
| `{ type: 'number', decimals: 2 }` | `19.99` | an integer scaled by 10ⁿ, `1999` | a safe integer |
| `boolean` | boolean | as is | `typeof` |
| `json`, `any`, `unknown` | anything JSON | as is, by reference | none; never required |
| `null` | `null` | `null` | nothing else; never required |
| `date` | `Date` (or a timestamp) | epoch milliseconds | whole milliseconds within ±8.64e15 |
| `bigint` | bigint | decimal string, `'12345678901234567890'` | digits only |
| `bytes` | `Uint8Array` (a `Buffer` too) | base64 with padding, `'iVBORw=='` | canonical base64 |
| `{ enum: [...] }` | one of the values | its index, `0` for the first | an integer in range |
| `{ flags: [...] }` | `{ read: true, admin: true }` | a bitmask, `5` | a non-negative integer, or an array of them past 31 names |
| `{ array: 'integer' }` at a `delta` path | `[100, 101, 103]` | the first and the differences, `[100, 1, 2]` | safe integers |
| `{ set: 'string' }` | a `Set` (or an array) | the array of its elements | as an array |
| `{ map: { string: 'date' } }` | a `Map` | `[k0, v0, k1, v1, …]` | key types, values |
| `{ object: { string: 'number' } }` | an object | an object, keys as they are | each value |
| tuple `['number', { x: 'number' }]` | `[1, { x: 2 }]` | `[1, [2]]`, fixed length | length and each element |
| `{ union: [...], discriminator }` | `{ type: 'event', name: 'x' }` | `[tag, ...the branch's other fields]`, `[1, 'x']` | the tag, always; then the branch |
| a reference | a record, or its id | the record's wire, or the id | as the record, or a string |

`encode` trusts the values it is given: a value of the wrong type travels as it is, and one that
has no wire form of its type (a date that is not a date, an unknown enum value) travels as
`null`. Validate values with metaschema first (`schema.source.check(value)`), whose `check`
knows every rule of the definition; see [Errors](/guide/errors#what-is-validated).

## Enum

```js
const S = Schema.from({ role: { enum: ['admin', 'editor', 'viewer'] } }, { metaschema });
S.encode({ role: 'editor' }); // [1]
S.decode([1]);                // { role: 'editor' }
S.encode({ role: 'nope' });   // [null] — metaschema's check rejects it: value is not of enum
S.decode([7]);                // DecodeError: Field "role" is not of enum: admin, editor, viewer
```

Values can be strings or numbers, as many as needed; add new ones at the end only, since the index
is what travels.

## Date

```js
const S = Schema.from({ at: 'date' }, { metaschema });
S.encode({ at: new Date('2023-11-14T22:13:20Z') }); // [1700000000000]
S.decode([1700000000000]);                          // { at: 2023-11-14T22:13:20.000Z }
```

A number is accepted too (`{ at: 1700000000000 }`); an invalid date, a `BigInt` or a `Symbol`
travels as `null`. A date is told by its brand, so a date of another realm is one and an object
that only claims the tag is not. With validation, decode takes whole milliseconds within the range
of `Date`, ±8.64e15, and nothing else. Epoch
milliseconds are shorter than ISO strings and ×3 faster to produce than `toISOString()`.

## Bytes

Binary data travels as a base64 string, standard alphabet with padding (RFC 4648 §4), the same as
`btoa`, `Buffer`'s `'base64'` and JSON Schema's `contentEncoding: 'base64'`:

```js
const S = Schema.from({ id: 'number', avatar: 'bytes' }, { metaschema });
S.encode({ id: 1, avatar: new Uint8Array([137, 80, 78, 71]) }); // [1, 'iVBORw==']
S.decode([1, 'iVBORw==']);                                     // { id: 1, avatar: Uint8Array(4) [137, 80, 78, 71] }
```

`bytes` is metaschema's own type since 3.4. Encoding takes any `Uint8Array`, a `Buffer`, a
subclass or a view into a larger buffer included; other typed arrays and `ArrayBuffer` travel as
they are (metaschema's `check` rejects them: wrap them in a `Uint8Array` first). Decoding accepts
canonical base64 only, the text an encoder writes: missing padding, whitespace, the URL-safe
alphabet or stray bits in the last character are a `type` error (with `validate: false` such a
string stays as it is). Decoding always returns a plain `Uint8Array` with a buffer of its own, in
Node.js as in browsers, never a `Buffer` or a view into a shared pool. Base64 costs a third more
than the bytes; for large binaries a separate binary channel beats any JSON.

## Decimals

A number with a fixed count of decimals, such as an amount of money, travels as an integer:
`decimals: n` multiplies by 10ⁿ and rounds on the way out, and divides on the way back.

```js
const S = Schema.from({ price: { type: 'number', decimals: 2 } }, { metaschema });
S.encode({ price: 19.99 });      // [1999]
S.encode({ price: 0.1 + 0.2 });  // [30] — not 0.30000000000000004
S.decode([1999]);                // { price: 19.99 }
```

`n` goes from 0 to 15. Rounding is `Math.round`, half up, on the double: `1.005` is stored as
`1.00499999…` and becomes `100`. Decoding divides the integer by 10ⁿ, which gives back the double
nearest to the decimal, so `19.99` comes back as the literal `19.99`; an integer on the wire that
is not a safe integer is a `type` error. A number that scales past the safe integers (`1e14` with
two decimals, `10` with fifteen, `NaN` and the infinities) has no wire its decoder reads, so
`encode` refuses it with `EncodeError` `type` whatever `validate` says; a value of another type
travels as it is. `decimals` is a rule of metaschema too since 3.4: its
`check` rejects a value with more digits after the point.

## BigInt

`JSON.stringify` cannot write a BigInt; protoarray writes it as a decimal string and reads it
back with `BigInt()`:

```js
const S = Schema.from({ n: 'bigint' }, { metaschema });
S.encode({ n: 12345678901234567890n }); // ['12345678901234567890']
```

## Flags

A `flags` field is an object of booleans that travels as one integer: bit *i* is the *i*-th name.

```js
const S = Schema.from({ perms: { flags: ['read', 'write', 'admin'] } }, { metaschema });
S.encode({ perms: { read: true, admin: true } }); // [5]
S.decode([5]);                                    // { perms: { read: true, write: false, admin: true } }
```

Any number of names. Past 31 the bitmask takes an array of 31-bit words, written as one integer
while only the first word has bits set: `[[1, 16]]` is names 0 and 35. A decoder reads either
form, and a missing word as zero. Add new names at the end: a decoder ignores bits it has no
name for. A 1.0 decoder reads the one-integer form only, so a set name past 31 needs 1.1 or newer
on the decoding side (see [Schema Evolution](/guide/evolution#past-31-fields-or-names)). An array
is not a set of flags; any other object is read by name. `flags` is metaschema's own type since
3.4.

## Integer, any, unknown, null

`integer` is a number that must be an integer (`Number.isInteger`), checked on decode. `any` and
`unknown` are a value of any kind: the same slot as `json`, never required, with the same
canonical form and so the same `id`. `null` is a slot that holds nothing else: encoding writes
`null` whatever it is given, decoding accepts only `null`.

## Sets, maps and dictionaries

```js
const S = Schema.from(
  {
    tags: { set: 'string' },
    seen: { map: { string: 'date' } },
    prices: { object: { string: { type: 'number', decimals: 2 } } },
  },
  { metaschema },
);
S.encode({
  tags: new Set(['admin', 'editor']),
  seen: new Map([['Kyiv', new Date(1700000000000)]]),
  prices: { tea: 1.5 },
});
// [['admin', 'editor'], ['Kyiv', 1700000000000], { tea: 150 }]
```

- **`{ set: T }`** travels as the array of its elements and decodes as a `Set`. Encoding takes a
  `Set` or an array; anything else is an `EncodeError` `set`.
- **`{ map: { K: V } }`**, with `string` or `number` keys, travels as flat pairs
  `[k0, v0, k1, v1, …]` and decodes as a `Map`; an odd length is a `structure` error. An entry's
  path is its index: `seen[2]`. Encoding takes a `Map` only (`EncodeError` `map` otherwise).
- **`{ object: { string: V } }`** is a dictionary: its keys travel as JSON keys and each value is
  converted like a field, with the key in its path (`prices.tea`). With values that travel as they
  are and nothing to check, the object itself goes through. A `__proto__` key stays an own property,
  as `JSON.parse` makes it, never the prototype of the result.

The long forms are metaschema's: `{ type: 'set', value: 'string' }`,
`{ type: 'map', key: 'string', value: 'date' }`, `{ type: 'object', key: 'string', value: … }`.
The path of a map's or a dictionary's value, for the options, is `seen{}`.

## Tuples

A tuple is a fixed-length array whose elements can be any definition: scalars, structs,
collections, unions, schemas. An element `{ name: 'type' }` with one key and a type name is a
named element as metaschema reads it (the name does not travel); `{ 'name?': 'type' }` makes it
optional. Elements can be optional or have a default; the length never changes:

```js
const S = Schema.from({ hit: [{ at: 'date' }, { x: 'number', y: '?number' }, { 'label?': 'string' }] }, { metaschema });
S.encode({ hit: [new Date(1700000000000), { x: 1 }] }); // [[1700000000000, [1], null]]
S.decode([[1700000000000, [1], null]]);                   // { hit: [2023-11-14T22:13:20.000Z, { x: 1, y: null }, null] }
S.decode([[1700000000000, [1]]]);                         // DecodeError: Field "hit" has a wrong length
```

`{ type: 'tuple', value: [...] }` is the long form. The path of an element is `hit[1]`.

## Unions

A discriminated union, in metaschema's spelling: each branch is a struct, and the `discriminator`
field of every branch is an `enum`. The value of that field picks the branch; on the wire its
index leads and the other fields of the branch follow, so the discriminator never travels twice.

```js
const Packet = Schema.from(
  {
    union: [
      { Struct: {}, type: { enum: ['call'] }, id: 'string', method: 'string', args: '?json' },
      { Struct: {}, type: { enum: ['event'] }, name: 'string', data: '?json' },
    ],
    discriminator: 'type',
  },
  { metaschema },
);
Packet.encode({ type: 'call', id: '7', method: 'auth/signIn', args: ['alex', 'secret'] });
// [0, '7', 'auth/signIn', ['alex', 'secret']]
Packet.encode({ type: 'event', name: 'chat/message' }); // [1, 'chat/message']
Packet.decode([1, 'chat/message']);                    // { type: 'event', name: 'chat/message', data: null }
```

- **The tag** is the index of the value among the values of all branches, in order: a branch
  `{ kind: { enum: ['square', 'diamond'] } }` after a one-value branch owns tags `1` and `2`.
- **A branch** is a struct, inline or a metaschema schema, and the union's options reach it by
  path (`[1].name`, `packet[1].name` for a union in the field `packet`). Each branch's trailing
  optional fields are trimmed, down to `[tag]`, and a field may refer to the union by its own
  name for a recursion.
- **The kind key.** A struct whose first key is `type` reads as the long form `{ type: … }` in
  metaschema, so a branch with `type` first names its kind before it: `{ Struct: {}, … }`. A branch
  whose discriminator is not first needs nothing.
- **Errors.** A discriminator outside the union is an `EncodeError` with code `union`, and a tag
  outside the union a `DecodeError` `union`, even with `validate: false`: there is no branch to fall
  back to. The decoded object has the branch's keys in the branch's order.

A union can be the whole schema, a field or the item of an array: `Packet.list` encodes a batch as
`[[0, …], [1, …]]`. It cannot be sparse or use the `flat` and `columns` layouts. A union without a
`discriminator` (metaschema's `{ union: ['string', 'number'] }`) has no positional form yet and is
`ERR_UNKNOWN_TYPE`.

## References

A reference to another entity travels as metaschema's `check` reads it: the record, as the
referenced schema's own wire, or its id, a string. By default the kind of the entity decides (a
stored kind by id, a memory kind as the record); `embed` on the field and the `references` option
override it. See [Defining a Schema](/guide/schema#references).

## Custom types

A metaschema type that names another, `{ money: { js: 'number' } }`, travels as that type, down
its chain of aliases. A type with a check of its own (`checkType`) says nothing about its values'
shape, so protoarray needs its wire type from the `types` option:

```js
const { Model } = require('@alexify/metaschema');

const types = {
  decimal: { kind: 'scalar', construct() {}, checkType: (value) => typeof value === 'string' },
};
const model = new Model(types, new Map([['Payment', { Entity: {}, amount: 'decimal' }]]));

const { Payment } = Schema.fromModel(model, { types: { decimal: 'string' } });
Payment.encode({ amount: '10.50' }); // ['10.50']
```

Without it the schema is `ERR_UNKNOWN_TYPE`: `Type "decimal" checks values of its own: give it a
wire type in "types"`. A wire type is a scalar: `string`, `number`, `integer`, `boolean`,
`bigint`, `date`, `bytes`, `json`, `any`, `unknown` or `null`.

## Delta

A list of integers (`integer`, a whole `number`, `date`, decimals) can travel as its first value
and the differences between neighbours, which are short when the values are close: ids, times,
counters. The `delta` option names the lists by path:

```js
const S = Schema.from({ ids: { array: 'integer' }, at: { array: 'date' } }, { metaschema, delta: ['ids', 'at'] });
S.encode({ ids: [100, 101, 103, 102], at: [new Date(1700000000000), new Date(1700000000500)] });
// [[100, 1, 2, -1], [1700000000000, 500]]
```

A path to a field of a [`columns` collection](/guide/collections#columns), `'[].id'` or
`'orders[].id'`, writes its column that way. Nulls keep their places and leave the running value
as it is. Only integers have exact differences, so a value that is not one is an `EncodeError`
`type`. The canonical form marks it (`id:integer~`, `~[date]`), so `delta` changes the `id`.

## Interned strings

`{ intern: true }` for every string of the schema, or `{ intern: ['role', 'tags[]'] }` for the
strings at those paths, makes the payload `[table, body]`: the message's distinct interned
strings in the order they first appear, then the usual wire with each of them as its index.

```js
const S = Schema.from({ role: 'string', tags: { array: '?string' } }, { metaschema, intern: true });
S.encode({ role: 'admin', tags: ['admin', null, 'editor'] });
// [['admin', 'editor'], [0, [0, null, 1]]]
```

One table serves the whole message: the records of a collection, a collection with a layout of its
own, the entities it reaches and recursion share it. It pays for strings with few distinct values (a city, a status, tags):
interning unique ones (names, emails) only adds a table of them, which compresses worse than the
strings in place. The canonical form marks the string (`role:string*`).

## json

A `json` field passes any JSON value through by reference, without checks. It is never required:
`null` is a value here. metaschema checks a `json` field as an object (an array included); for a
value of any kind, a string or a number too, write `any` or `unknown`, which travel the same way
and have the same canonical form.

```js
const S = Schema.from({ payload: 'json', next: 'number' }, { metaschema });
S.encode({ payload: { any: [1, { deep: true }] }, next: 2 }); // [{ any: [1, { deep: true }] }, 2]
```

## Defaults

A `default` is the decoded value of a slot that is `null` or missing on the wire. It makes the
field optional, and the wire uses it for `string`, `number`, `integer`, `boolean`, `json` and
`enum` fields:

```js
const S = Schema.from({ balance: { type: 'number', default: 0 }, name: 'string' }, { metaschema });
S.encode({ name: 'Alex' }); // [null, 'Alex']
S.decode([null, 'Alex']);   // { balance: 0, name: 'Alex' }
```

An explicit `null` from the sender becomes the default too; encoding never elides a value equal to
the default. A default the wire has no use for (a function, a `Date`, a bigint) stays
metaschema's: its `parse` applies it.

## Numbers, strings and what JSON cannot carry

`NaN` and `Infinity` have no JSON form: `JSON.stringify` writes `null`, and a required field then
fails to decode as missing. Integers beyond 2⁵³ lose precision in JSON as they do in JavaScript; use `bigint`. `-0` becomes `0`. Binary data is
`bytes`; a `Map` and a `Set` are `map` and `set`: under `json` they serialize the way
`JSON.stringify` would, which is rarely what you want.
