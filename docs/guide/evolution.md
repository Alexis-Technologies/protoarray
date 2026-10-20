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
   Anything else is breaking, adding or changing `decimals` included: the wire holds a different
   number. A 1.0 peer ignores `decimals` altogether, so a field with it needs 1.1 or newer on both
   sides; the ids of the two definitions differ, which is how a handshake notices.
5. **Deploy decoders before encoders** when you append enum values or union branches: an old
   decoder rejects an index or a tag it does not know.
6. **`delta` and `intern` change the wire** of the places they name: turning one on is a
   breaking change for older peers, which [`resolve`](/guide/resolve) bridges (it reads the
   writer's wire whichever way the reader writes).
7. **References keep their form.** Whether a reference travels as the record or as its id
   follows the kind of the entity, the field's `embed` and the `references` option: changing any
   of them changes the wire of that field, as a type change does.
8. **A stored kind's id field is the last field.** metaschema appends `<entity>Id` after the
   fields of the definition, so a field appended to an `Entity` takes the id's position and the
   id moves one further: an older peer reads the id as the new field. Where payloads carry the
   id, declare it in the definition, `userId: '?string'`, which keeps it in its place, and append
   after it.

```js
const { Schema: Definition } = require('@alexify/metaschema');
const canonical = (definition) => Schema.from(new Definition('User', definition)).toString();

canonical({ Entity: {}, name: 'string' });                                     // '{name:string,userId:?string}'
canonical({ Entity: {}, name: 'string', email: '?string' });                   // '{name:string,email:?string,userId:?string}' — the id moved
canonical({ Entity: {}, name: 'string', userId: '?string', email: '?string' }); // '{name:string,userId:?string,email:?string}'
```

The examples on this page build schemas from a definition with metaschema injected
(`const metaschema = require('@alexify/metaschema')`):

```js
const V1 = Schema.from({ id: 'number', name: 'string' }, { metaschema });
const V2 = Schema.from(
  { id: 'number', name: 'string', email: '?string', score: { type: 'number', default: 0 } },
  { metaschema },
);

V2.decode(V1.encode({ id: 1, name: 'Alex' }));
// { id: 1, name: 'Alex', email: null, score: 0 }

V1.decode(V2.encode({ id: 1, name: 'Alex', email: 'a@b.c', score: 5 }));
// { id: 1, name: 'Alex' }
```

What breaks: a new **required** field without a default (`DecodeError: Field "org" is required`
on old payloads), a reordered definition (values land in the wrong keys, silently), a changed
type. When a change has to break these rules (a rename, a reorder, a dropped field, a type that
widens), [`resolve`](/guide/resolve) reads the old payloads by name instead of by position, and
writes them for older peers.

The wire did not change between protoarray 1.x and 2.0: a 2.0 schema of the shape of a 1.x schema
writes its payloads, and has its id unless it references another entity by name, so peers on the
two majors talk to each other while they upgrade (see
[Migrating from 1.x](/guide/migrating-from-1)).

## Nested records, sparse records and columns

The same rules apply at every level. Rows of a collection are trimmed and extended independently.
A sparse record's bit *n* is field *n*, so appended fields take the next bits and their values
come after the ones an older decoder knows. Columns are appended at the end; an older decoder
ignores them, a newer one reads `null`s where a column is missing. The one exception is the
`flat` layout, whose fixed width changes with every field: use it only where both sides deploy
together.

## Unions

A union's tags follow the order of its branches and of the values in them, so new branches go at
the end, and a new discriminator value only into the last branch; anything inserted before moves
every later tag. A branch is a struct and grows like one: append optional fields, and an older
decoder reads the branch without them.

## Strict decoding

By default, elements beyond the schema are ignored. If a payload must match the schema exactly,
pass `{ strict: true }` to `decode` or `parse`: extra elements, values or columns throw
`DecodeError` with code `extra`.

## Telling versions apart

`schema.id` is an FNV-1a fingerprint of the schema's signature, 32 bits as eight hex digits by
default (`'fnv1a64'` below widens it): its canonical form (`schema.toString()`: every position,
its type and its key, with the layout), followed by the canonical form of every other entity it
references by name (see [Defining a Schema](/guide/schema#properties)). Two sides whose ids match
agree on the wire, the entities their references reach included: a change to `Address` changes
the id of a `User` that references it, so a registry or a handshake tells the two versions apart.
Exchange it in a handshake (an HTTP header, the `hello` of an RPC session, a field in an
envelope) and map ids to schemas on the receiving side when a breaking change has to coexist with
the old version for a while: [`SchemaRegistry`](/guide/resolve#the-registry) keeps that map and
wraps payloads in `[id, payload]`.

```js
V1.id; // '030d98ef'
V2.id; // 'aafe8696' — different: it has more positions
```

The id includes keys, so renaming a field changes it even though the wire stays compatible. That
is deliberate: a swap of two same-typed fields is a change of meaning, and the id should say so.
If only wire compatibility matters, compare `toString()` after stripping keys on your side.

### A wider fingerprint

Thirty-two bits are plenty for a handshake between two sides, where the only question is "do we
have the same schema?": two different schemas collide with probability 2⁻³². They are not enough
for a registry that keys many schemas by id. Among K schemas, some two share a b-bit id with
probability P ≈ 1 − exp(−K(K−1)/2ᵇ⁺¹), the birthday bound:

| Schemas | 32 bits | 64 bits |
| --- | ---: | ---: |
| 2¹⁰ (1,024) | 0.012% | 2.8 × 10⁻¹⁴ |
| 2¹² (4,096) | 0.2% | 4.6 × 10⁻¹³ |
| 2¹⁴ (16,384) | 3.1% | 7.3 × 10⁻¹² |
| 2¹⁶ (65,536) | 39% | 1.2 × 10⁻¹⁰ |
| 2¹⁸ (262,144) | ≈ 100% | 1.9 × 10⁻⁹ |
| 2²⁰ (1,048,576) | ≈ 100% | 3.0 × 10⁻⁸ |

The `fingerprint` option names the hash: `'fnv1a32'` is the default, `'fnv1a64'` the 64-bit
FNV-1a of the same signature, as sixteen hex digits, computed as cheaply and without a
dependency. A registry of thousands of schemas takes it on every schema it holds: the registry
refuses two schemas of different signatures under one id (`ERR_ID_COLLISION`) rather than mix
them up. What a schema derives hashes with the same name (`schema.list`, the entities its
references reach, a resolved schema), and a standalone module carries it.

```js
const V1 = Schema.from({ id: 'number', name: 'string' }, { metaschema, fingerprint: 'fnv1a64' });
V1.id; // '2eb324893863d0cf' — 64-bit FNV-1a of '{id:number,name:string}'; '030d98ef' with 32
```

The option also takes any synchronous function of the signature, which is the canonical form
itself for a schema that references no other entity, for a hash of your own:

```js
const { createHash } = require('node:crypto');
const sha = (signature) => createHash('sha256').update(signature).digest('hex').slice(0, 16);

const User = Schema.from({ id: 'number', name: 'string' }, { metaschema, fingerprint: sha });
User.id; // '17ad5aba43b19ad4' — 64 bits of SHA-256 of '{id:number,name:string}'
```

The function must be deterministic and derive the id from its argument only: both sides compute
it on their own from the same schema, which is what makes the handshake work. A random or
time-based identifier (a cuid, a ulid) would differ between two copies of the same schema; if you
need hand-written version ids, keep a map from id to schema in the application instead. A
function has no source, so a [standalone module](/guide/standalone#what-it-does-not-write)
carries the ids it computed and hashes what it derives with the default; a name travels.

### Past 31 fields or names

A sparse record grows past 31 fields without breaking anyone: the first 31 fields keep the 1.0
form (one segment), and the rest follow in extra segments that an older decoder ignores. Only a
strict decoder notices them, as `extra`.

A `flags` field grows past 31 names, but the wire changes shape once a name past 31 is set: from
one integer to an array of words, which a 1.1 or newer decoder reads and a 1.0 decoder does not (it rejects
the array as `type`, or without validation reads every flag as `false`). While no such name is
set the wire stays the one integer of 1.0. So deploy decoders first, as for a new enum value, and
only then set the new names.
