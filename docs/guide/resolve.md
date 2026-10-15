# Migrations and the Registry

The [compatibility rules](/guide/evolution) keep two versions of a schema readable by position:
append fields, never move one. Some changes cannot follow them: a field renamed and reordered, one
dropped, a type that widens, a new required field with a default. `Schema.resolve` bridges such
versions the way Avro does, by name: it reads what one version wrote as the objects of another,
and writes those objects back as the first one would.

## Schema.resolve

```js
const V1 = new Schema('User', {
  id: 'integer',
  fullName: 'string',
  role: { enum: ['admin', 'user'] },
  legacy: '?string',
});
const V2 = new Schema('User', {
  id: 'number',
  name: { type: 'string', aliases: ['fullName'] },
  email: { type: 'string', default: '' },
  role: { enum: ['user', 'admin', 'guest'] },
});

const Read = Schema.resolve(V1, V2);
const wire = V1.encode({ id: 1, fullName: 'Alex', role: 'admin', legacy: 'x' }); // [1, 'Alex', 0, 'x']
Read.decode(wire);                                       // { id: 1, name: 'Alex', email: '', role: 'admin' }
Read.encode({ id: 2, name: 'Bo', email: 'b@x', role: 'user' }); // [2, 'Bo', 1] — what V1 writes
```

`Schema.resolve(writer, reader, options?)` returns a `Schema` with the writer's wire and the
reader's objects:

- its `id`, `toString()` and `layout` are the writer's, so it reads and writes what the writer's
  peers send and expect, and a registry or a handshake sees the writer;
- its `keys`, key order, types, defaults and `definition` are the reader's, and so is `validate`;
- it is compiled by the same backends, recursion and embedded schemas included, so it runs at the
  speed of a schema of its own; `list`, `stringify`, `parse` and `check` work as on any schema.

When the two canonical forms are the same there is nothing to resolve, and `resolve` returns the
reader itself.

## How fields are matched

| Writer → reader | Decode (the writer's wire → the reader's object) | Encode (the reader's object → the writer's wire) |
| --- | --- | --- |
| a field of the same key, or one the reader names in `aliases` | read into the reader's key | written from the reader's key |
| a field only the writer has | skipped | `null`; a writer that requires it gets `EncodeError` `required` with validation |
| a field only the reader has | its default, or `null` when optional; a required one without a default is `ERR_INCOMPATIBLE` when resolving | ignored |
| optional → required | `null` on the wire is the default, or `DecodeError` `required` | — |
| `integer` → `number`, `integer` → `bigint` | widened | narrowed back, checked |
| `decimals` → more decimals or a plain `number` | read as is | written as the writer's integer |
| enum → enum | by value; a value the reader dropped becomes its default, `null` when optional, a `DecodeError` `enum` otherwise | by value; one the writer lacks is `null`, or `EncodeError` `enum` with validation |
| enum ↔ string | the value as a string; a string as one of the reader's values | through the writer's type |
| flags → flags | by name: names the writer lacks are `false`, names the reader lacks dropped | by name |
| anything → `json`, `any`, `unknown` | the value the writer's type decodes to | through the writer's type |
| anything → `null` | dropped | `null` |
| array ↔ set, map, object, tuple | element by element; a tuple's extra writer elements skipped, extra reader ones at their defaults | element by element |
| union → union | branches pair up by their discriminator values; a writer branch with no reader values cannot be decoded (`union`) | a value the writer has no branch for is `EncodeError` `union` |
| interned string ↔ string, delta ↔ plain | the writer's wire | the writer's wire |

What cannot be read throws `SchemaDefinitionError` `ERR_INCOMPATIBLE` when resolving, with the
reader's path: a narrowing (`number` → `integer`, fewer decimals), a type of another kind, a union
on another discriminator or a writer branch whose values the reader split between branches.

```js
Schema.resolve(Schema.from({ a: 'number' }), Schema.from({ a: 'integer' }));
// SchemaDefinitionError: Cannot read number as integer at "a"
```

### Aliases

A reader field names its earlier keys in `aliases`, in any object form of a field
(`{ type: 'string', aliases: ['fullName'] }`, `{ array: 'string', aliases: ['labels'] }`). It is
metaschema's own key, which its `parse` reads too; it does not reach the wire or the fingerprint.
An inline struct has no place for it, so the `aliases` option names them by the reader's path, as
definition errors spell it:

```js
const Old = Schema.from({ address: { town: 'string' }, orders: { array: { code: 'string' } } });
const New = Schema.from({ address: { city: 'string' }, orders: { array: { sku: 'string' } } });

Schema.resolve(Old, New, { aliases: { 'address.city': 'town', 'orders[].sku': ['code'] } })
  .decode([['Kyiv'], [['A-1']]]);
// { address: { city: 'Kyiv' }, orders: [{ sku: 'A-1' }] }
```

A writer field is claimed once: the first reader field that names it gets it.

## The registry

`@alexify/protoarray/registry` keeps schemas by id and wraps a payload with the id of the schema
that wrote it, `[id, payload]`, so a receiver that knows several versions reads each one right.

```js
const { SchemaRegistry } = require('@alexify/protoarray/registry');

const registry = new SchemaRegistry([V1, V2]);
const envelope = registry.encode(V1, { id: 1, fullName: 'Alex', role: 'admin' });
// ['006029c4', [1, 'Alex', 0]]

registry.decode(envelope);     // as V1 wrote it: { id: 1, fullName: 'Alex', role: 'admin', legacy: null }
registry.decode(envelope, V2); // as V2 reads it: { id: 1, name: 'Alex', email: '', role: 'admin' }

// A reply for a peer that still runs V1:
registry.encode(V2, { id: 3, name: 'C', role: 'user' }, { as: V1.id }); // ['006029c4', [3, 'C', 1]]
```

| Member | |
| --- | --- |
| `new SchemaRegistry(schemas?)` | from an iterable of schemas |
| `add(schema)` | under its id; again for the same canonical form changes nothing; returns the registry |
| `get(id)`, `has(id)`, `size`, iteration | by id |
| `find(name)` | the latest schema added under that name |
| `resolve(id, reader)` | the schema that reads what the schema with that id wrote, as `reader` objects, resolved once per pair |
| `encode(schema, value, { as? })`, `stringify(…)` | an envelope; `as` writes for the schema with that id |
| `decode(envelope, reader?, options?)`, `parse(text, reader?, options?)` | as its writer wrote it, or as `reader` objects |
| `SchemaRegistry.from(model)` | every entity of a metaschema `Model` (see [metaschema](/guide/metaschema)) |

An envelope that is not `[id, payload]` is a `DecodeError` `structure`, an id the registry does not
know a `DecodeError` `schema`. Two different schemas under one id throw `ERR_ID_COLLISION` when
added: the 32-bit fingerprint is too narrow for that registry, and a wider one is the remedy (see
[Your own fingerprint](/guide/evolution#your-own-fingerprint)). The registry is a subpath of its
own, so a program that does not use it does not carry it.
