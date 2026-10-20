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

## Checking it in CI

The rules above are kept by hand, and a definition that breaks one still builds: a version that
moves a position decodes the payloads of the other into the wrong keys without a word.
`compatible`, from the `@alexify/protoarray/evolve` subpath, reads two versions the way a
reviewer would, position by position, and names every rule a change breaks. It is a tool for
development and CI, kept out of the core and apart from [`resolve`](/guide/resolve), which reads
one version as another at runtime:

```js
const { compatible } = require('@alexify/protoarray/evolve');

const V3 = Schema.from(
  {
    id: 'number',
    name: 'string',
    email: '?string',
    score: { type: 'number', default: 0 },
    'role?': { enum: ['admin', 'user'] },
  },
  { metaschema },
);
compatible(V2, V3); // { ok: true, problems: [] } — an optional field appended

const V4 = Schema.from(
  {
    id: 'integer',
    fullName: 'string',
    org: 'string',
    email: '?string',
    score: { type: 'number', default: 0 },
    'role?': { enum: ['admin', 'user', 'guest'] },
  },
  { metaschema },
);
compatible(V3, V4);
// {
//   ok: false,
//   problems: [
//     { path: 'id', rule: 'type', severity: 'error', message: 'Type changed: number → integer', previous: 'number', next: 'integer' },
//     { path: 'fullName', rule: 'renamed', severity: 'info', message: 'Field "name" is now "fullName"', previous: 'string', next: 'string' },
//     { path: 'org', rule: 'inserted', severity: 'error', message: 'Field "org" inserted at position 2: "email", "score" and "role" move further', next: 'string' },
//     { path: 'role', rule: 'appended', severity: 'warning', message: 'Enum value "guest" appended: deploy decoders before encoders', previous: 'enum(admin|user)', next: 'enum(admin|user|guest)' },
//   ],
// }
compatible(V3, V4, { strict: true }).ok; // false on a warning too
```

`ok` is false when a problem is an error, and with `{ strict: true }` when one is a warning. Each
problem names its place as the errors do (`address.city`, `orders[].sku`, `scores{}`, `pair[1]`,
`''` for the root), the rule it breaks, how bad it is, and the canonical forms of the two nodes
where there are two. What changes nothing on the wire is reported for information, so a review
sees it. `register()` from the same subpath installs it as `Schema.compatible(previous, next)`.

| `rule` | Severity | When | Rule above |
| --- | --- | --- | --- |
| `inserted` | error | a field, a tuple element, an enum value, a flag name or a union value inserted before one that keeps its place, which moves | 1, Unions |
| `moved` | error | one that is elsewhere in the new version, not further (a swap, a reorder) | 1 |
| `removed` | error | one the new version does not have, or fewer positions | 1, 3 |
| `renamed` | info | a key, a value or an entity under another name at the same place, the old one nowhere else | 1 |
| `required` | error | a field or an element appended as required without a default; an optional one now required | 2 |
| `retired` | warning | a slot that now takes anything (`?any`, `json`) or only `null`: a validating decoder on either side holds the slot to what it took before, so readers deploy before writers | 3 |
| `type` | error | another type or form: `integer` for `number`, an enum for a string, `decimals` changed, a record for an id, a Set for an array, a map keyed otherwise, a union on another discriminator | 4, 7 |
| `optional` | warning | a required slot now optional: the newer version may write a `null` an older validating reader refuses, so readers deploy before writers | 4 |
| `appended` | warning | an enum value, a flag name or a union value appended: deploy decoders before encoders | 4, 5 |
| `wire` | error | `sparse`, a `layout`, `delta` or `intern` switched at a place | 6 |
| `flat` | error | the record of a `flat` collection has another number of fields, optional or not | Nested records |
| `default` | warning | a default added, removed or changed: an empty slot in older payloads decodes differently | 2 |
| `fingerprint` | info | the two versions hash their ids differently (`fnv1a32` against `fnv1a64`, or a function of your own): the ids are not comparable, which a handshake must know | — |

Fields, tuple elements, enum values, flag names and a union's values compare by position, and
references by the entity they reach, once per pair of entities (a recursion included); a record
written in place in one version and reached by a reference in the other is the same wire, noted
as `renamed`. A field that moved is compared where it stands now as well, so what changed inside
it is reported too. A message names at most five keys or values and counts the rest, and the
problems of the values of one enum carry its canonical form once. A stored
kind's id that moves because a field was appended to the definition (rule 8) is an `inserted`
problem whose message says where to declare it. The telling of a rename from a shift is
conservative: a key that changes at a position where neither the old nor the new key is anywhere
else is a rename; any other shift of a key is an error, since the wire cannot say which one it
was.

### A baseline

A CI job needs the version that shipped. `baseline` writes schemas as JSON, sorted by name: each
one's snapshot (once, however many schemas share it), the entity it is of, the options that shape
its wire (`sparse`, `layout`, `intern`, `delta`, `references`, `types`, the options of the
entities it reaches, and the name of a built-in fingerprint; a function of your own cannot
travel, so it is written as `null` and the id is recorded, not checked), and its canonical form,
its signature (the canonical forms of the entities it reaches, by name) and its id as checksums,
with the version of protoarray that wrote the file (`generator`). `restore` builds them again,
taking only the options of the wire from the file, and refuses a baseline that does not rebuild
to what it was written with (`ERR_INVALID_SNAPSHOT`, naming what differs with both values: another
version of protoarray wrote it, or it was edited; compare the versions before writing it again):

```js
const { baseline, restore } = require('@alexify/protoarray/evolve');

fs.writeFileSync('schemas.baseline.json', JSON.stringify(baseline({ User: V3 }), null, 2));
// later, in another process
const shipped = restore(JSON.parse(fs.readFileSync('schemas.baseline.json', 'utf8')));
compatible(shipped.User, V4);
```

The `protoarray` command does both over the schemas a module exports (a protoarray or a
metaschema `Schema`, the entities of a `Model`, as [`protoarray compile`](/guide/standalone#protoarray-compile)
takes them), paired by export name:

```sh
protoarray snapshot src/schemas.js --out schemas.baseline.json   # when a version ships
protoarray check src/schemas.js --against schemas.baseline.json  # on every change
```

`check` prints, for each schema with problems, the ids of the two versions compared and one
line per problem, then a summary of what was compared, and exits with 0 when every schema is
compatible, 1 when one is not, 2 for a wrong command line and 3 when the module, its schemas or
the baseline cannot be used (a baseline that does not rebuild fails the job too):

```
User: 4cbe92a9 → d66abd92
error    User.id: Type changed: number → integer (type)
info     User.fullName: Field "name" is now "fullName" (renamed)
error    User.org: Field "org" inserted at position 2: "email", "score" and "role" move further (inserted)
warning  User.role: Enum value "guest" appended: deploy decoders before encoders (appended)
1 schema compared: 2 errors, 1 warning, 1 info; incompatible
```

A schema the baseline has and the module no longer exports is a warning (`missing`); one the
module exports and the baseline lacks is noted (`new`, info); when no schema is in both, the
summary says so. `--only A,B` names the pairs to check, `--strict` fails on warnings too and
`--json` writes `{ ok, schemas: { Name: { ok, problems, previous: { id }, next: { id } } } }`
instead of the lines (`{ ok: false, error: { code, message } }` when the check could not run).
An option takes its value as the next word or after `=`. A workflow step holds every pull request
to the rules:

```yaml
- run: npx protoarray check src/schemas.js --against schemas.baseline.json --strict
```

Write the baseline again with `protoarray snapshot` when a version ships, and commit it with the
code: a change that has to break the rules then shows as a diff of the baseline in the same pull
request, alongside the [`resolve`](/guide/resolve) that bridges it.

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
