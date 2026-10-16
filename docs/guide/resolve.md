# Migrations and the Registry

The [compatibility rules](/guide/evolution) keep two versions of a schema readable by position:
append fields, never move one. Some changes cannot follow them: a field renamed and reordered, one
dropped, a type that widens, a new required field with a default. `resolve` bridges such versions
the way Avro does, by name: it reads what one version wrote as the objects of another, and writes
those objects back as the first one would.

## resolve

`resolve` is the `@alexify/protoarray/resolve` subpath, kept out of the core so a program that
does not migrate does not carry it:

```js
const { Schema } = require('@alexify/protoarray');
const { resolve } = require('@alexify/protoarray/resolve');
const { Schema: Definition } = require('@alexify/metaschema');

const V1 = Schema.from(
  new Definition('User', {
    id: 'integer',
    fullName: 'string',
    role: { enum: ['admin', 'user'] },
    legacy: '?string',
  }),
);
const V2 = Schema.from(
  new Definition('User', {
    id: 'number',
    name: { type: 'string', aliases: ['fullName'] },
    email: { type: 'string', default: '' },
    role: { enum: ['user', 'admin', 'guest'] },
  }),
);

const Read = resolve(V1, V2);
const wire = V1.encode({ id: 1, fullName: 'Alex', role: 'admin', legacy: 'x' }); // [1, 'Alex', 0, 'x']
Read.decode(wire);                                       // { id: 1, name: 'Alex', email: '', role: 'admin' }
Read.encode({ id: 2, name: 'Bo', email: 'b@x', role: 'user' }); // [2, 'Bo', 1] — what V1 writes
```

`register()` from the same subpath installs it as `Schema.resolve(writer, reader, options?)`, once
per process:

```js
require('@alexify/protoarray/resolve').register();

Schema.resolve(V1, V2).decode(wire);
```

`resolve(writer, reader, options?)` returns a `Schema` with the writer's wire and the reader's
objects:

- its `id`, `toString()` and `layout` are the writer's, so it reads and writes what the writer's
  peers send and expect, and a registry or a handshake sees the writer;
- its `name`, `keys`, key order, types and defaults are the reader's, and so are `validate` and
  `stringify`; it has no `snapshot` or `source` of its own, and is no version of its own:
  `resolve` and a registry refuse it (`ERR_SCHEMA_EXPECTED`), take its writer or its reader;
- it is compiled by the same backends, recursion and referenced entities included, so it runs at
  the speed of a schema of its own; `list`, `stringify` and `parse` work as on any schema.

When the two signatures are the same (the canonical forms and the entities they reference, as
`id` reads them) there is nothing to resolve, and `resolve` returns the reader itself.

## How fields are matched

| Writer → reader | Decode (the writer's wire → the reader's object) | Encode (the reader's object → the writer's wire) |
| --- | --- | --- |
| a field of the same key, or one the reader names in `aliases` | read into the reader's key | written from the reader's key |
| a field only the writer has | skipped | `null` |
| a field only the reader has | its default, or `null` when optional; a required one without a default is `ERR_INCOMPATIBLE` when resolving | ignored |
| optional → required (a root scalar too) | `null` on the wire is the default, or `DecodeError` `required` | — |
| `integer` → `number`, `integer` → `bigint` | widened | narrowed back |
| `decimals` → more decimals or a plain `number` | read as is | written as the writer's integer |
| enum → enum | by value; a value the reader dropped becomes its default, `null` when optional, a `DecodeError` `enum` otherwise | by value; one the writer lacks is `null` |
| enum ↔ string | the value as a string; a string as one of the reader's values | through the writer's type |
| flags → flags | by name: names the writer lacks are `false`, names the reader lacks dropped | by name |
| anything → `json`, `any`, `unknown` | the value the writer's type decodes to | through the writer's type |
| anything → `null` | dropped | `null` |
| array ↔ set, map, object, tuple | element by element; a tuple's extra writer elements skipped, extra reader ones at their defaults | element by element |
| union → union | branches pair up by their discriminator values; a writer branch with no reader values, or a value of one the reader dropped, cannot be decoded (`union`) | a value the writer has no branch for is `EncodeError` `union` |
| interned string ↔ string, delta ↔ plain | the writer's wire | the writer's wire |

What cannot be read throws `SchemaDefinitionError` `ERR_INCOMPATIBLE` when resolving, with the
reader's path: a narrowing (`number` → `integer`, fewer decimals), a type of another kind, a union
on another discriminator, a writer branch whose values the reader split between branches, or two
versions whose chain of references is too long for the stack.

```js
resolve(Schema.from({ a: 'number' }, { metaschema }), Schema.from({ a: 'integer' }, { metaschema }));
// SchemaDefinitionError: Cannot read number as integer at "a"
```

### Aliases

A reader field names its earlier keys in `aliases`, in any long form of a field
(`{ type: 'string', aliases: ['fullName'] }`, `{ array: 'string', aliases: ['labels'] }`). It is
metaschema's own key, which its `parse` reads too; it does not reach the wire or the fingerprint.
Where the definition has no place for it, the `aliases` option names them by the reader's path,
as errors spell it:

```js
const Old = Schema.from({ address: { town: 'string' }, orders: { array: { code: 'string' } } }, { metaschema });
const New = Schema.from({ address: { city: 'string' }, orders: { array: { sku: 'string' } } }, { metaschema });

resolve(Old, New, { aliases: { 'address.city': 'town', 'orders[].sku': ['code'] } })
  .decode([['Kyiv'], [['A-1']]]);
// { address: { city: 'Kyiv' }, orders: [{ sku: 'A-1' }] }
```

A writer field is claimed once: the first reader field that names it gets it. An `aliases` path
that names no field of the reader is `ERR_INVALID_OPTIONS`: it would lose a value without a word.

## The registry

`@alexify/protoarray/registry` keeps schemas by id and wraps a payload with the id of the schema
that wrote it, `[id, payload]`, so a receiver that knows several versions reads each one right. It
reads one version as another through `resolve`, which it brings along.

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
| `add(schema)` | under its id; again for the same signature changes nothing; returns the registry |
| `get(id)`, `has(id)`, `size`, iteration | by id |
| `find(name)` | the latest schema added under that name |
| `resolve(id, reader)` | the schema that reads what the schema with that id wrote, as `reader` objects, resolved once per pair |
| `encode(schema, value, { as? })`, `stringify(…)` | an envelope; `as` writes for the schema with that id |
| `decode(envelope, reader?, options?)`, `parse(text, reader?, options?)` | as its writer wrote it, or as `reader` objects |
| `SchemaRegistry.from(modelOrSnapshot, options?)` | every entity of a metaschema `Model` or of its snapshot, as `Schema.fromModel` builds them |

An envelope that is not `[id, payload]` is a `DecodeError` `structure`; an id the registry does not
know, or one of a version the reader cannot resolve, a `DecodeError` `schema` with the id as
`error.id` (never in the message: the payload gave it) and, for the second, the `ERR_INCOMPATIBLE`
as `cause`. `decode` and `parse` throw nothing else, and a pair that cannot resolve is tried once.
Writing `as` an id the registry does not know is `SchemaDefinitionError` `ERR_UNKNOWN_SCHEMA`. Two schemas of different signatures under one id throw
`ERR_ID_COLLISION` when added: the 32-bit fingerprint is too narrow for that registry, and a wider one is the remedy (see
[Your own fingerprint](/guide/evolution#your-own-fingerprint)). The registry is a subpath of its
own, so a program that does not use it does not carry it.
