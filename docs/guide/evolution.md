# Schema Evolution

A protoarray schema evolves the way a Protocol Buffers message does, with positions in the role of
field numbers. Follow these rules and a client and a server on different versions keep
understanding each other.

## The rules

1. **A position is forever.** Append new fields at the end. Never insert, reorder or delete.
   Renaming is free: names never travel.
2. **A new field is optional**, or has a `default`, or is `json`. An older sender's shorter array
   decodes with `null` (or the default) in the new slot; a newer sender's longer array decodes on
   the old side with the extra positions ignored.
3. **Retire a field by keeping its slot** and making it optional; senders put `null` there.
4. **Safe type changes:** required → optional; appending values to an `enum` or names to `flags`.
   Anything else is breaking.
5. **Deploy decoders before encoders** when you append enum values: an old decoder rejects an
   index it does not know.

```js
const V1 = Schema.from({ id: 'number', name: 'string' });
const V2 = Schema.from({ id: 'number', name: 'string', email: '?string', score: { type: 'number', default: 0 } });

V2.decode(V1.encode({ id: 1, name: 'Alex' }));
// { id: 1, name: 'Alex', email: null, score: 0 }

V1.decode(V2.encode({ id: 1, name: 'Alex', email: 'a@b.c', score: 5 }));
// { id: 1, name: 'Alex' }
```

What breaks: a new **required** field without a default (`DecodeError: Field "org" is required`
on old payloads), a reordered definition (values land in the wrong keys, silently), a changed
type.

## Nested records, sparse records and columns

The same rules apply at every level. Rows of a collection are trimmed and extended independently.
A sparse record's bit *n* is field *n*, so appended fields take the next bits and their values
come after the ones an older decoder knows. Columns are appended at the end; an older decoder
ignores them, a newer one reads `null`s where a column is missing. The one exception is the
`flat` layout, whose fixed width changes with every field: use it only where both sides deploy
together.

## Strict decoding

By default, elements beyond the schema are ignored. If a payload must match the schema exactly,
pass `{ strict: true }` to `decode` or `parse`: extra elements, values or columns throw
`DecodeError` with code `extra`.

## Telling versions apart

`schema.id` is a 32-bit FNV-1a fingerprint of the canonical form (`schema.toString()`): every
position, its type and its key, with the layout. Two sides whose ids match agree on the wire.
Exchange it in a handshake (an HTTP header, the `hello` of an RPC session, a field in an
envelope) and map ids to schemas on the receiving side when a breaking change has to coexist with
the old version for a while.

```js
V1.id; // '030d98ef'
V2.id; // 'aafe8696' — different: it has more positions
```

The id includes keys, so renaming a field changes it even though the wire stays compatible. That
is deliberate: a swap of two same-typed fields is a change of meaning, and the id should say so.
If only wire compatibility matters, compare `toString()` after stripping keys on your side.
