# Migrating from 1.x

protoarray 2.0 hands the definition of a schema to
[`@alexify/metaschema`](https://metaschema.vercel.app/) and keeps the wire. The 1.x DSL was a
subset of metaschema's language, so most definitions stay as they are; what changes is how a
schema is built from one, and a few places where 1.x read the language its own way.

## What does not change

The wire. A 2.0 schema of the shape of a 1.x schema writes the same payloads and prints the same
canonical form, and every 1.x payload decodes the same way, so a 1.x peer and a 2.0 peer talk to
each other while they upgrade. The id is the same too, except for a schema that references
another entity by name: 2.0 fingerprints the referenced entities with the schema (see
[Defining a Schema](/guide/schema#properties)), so a handshake or a registry keyed by ids sees a
new id for it. The decode errors, the layouts, sparse records, `list`, `stringify`, `parse`,
streaming and the registry work as they did.

## Install metaschema where schemas are defined

```bash
pnpm add @alexify/metaschema
```

metaschema 3.4 or newer. It is not a dependency of protoarray: install it in the programs that
define schemas. A client that receives its schemas as snapshots does not need it (see
[metaschema and protoarray](/guide/metaschema#from-a-snapshot)).

## Build schemas from metaschema

A plain object is no longer a protoarray definition. Build the schema from a metaschema `Schema`,
or keep the literal and hand metaschema over:

```js
// 1.x
const { Schema } = require('@alexify/protoarray');
const User = new Schema('User', { id: 'number', name: 'string', 'email?': 'string' });
```

```js
// 2.0: a metaschema Schema, which also validates and types the schema
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');
const User = Schema.from(new Definition('User', { id: 'number', name: 'string', 'email?': 'string' }));

// 2.0: the same literal, read by the metaschema module given
const metaschema = require('@alexify/metaschema');
const User = new Schema('User', { id: 'number', name: 'string', 'email?': 'string' }, { metaschema });
```

A definition metaschema cannot read throws metaschema's own `SchemaDefinitionError`, with the
codes metaschema gives it (see [Errors](/guide/errors)). `schema.definition` is gone:
`schema.snapshot` is what the schema was read from, and `schema.source` the metaschema schema.

## References by name: a Model

`options.schemas` is gone. A reference by name reaches an entity of a metaschema `Model`, and a
schema reaches its own name for a recursion without one:

```js
// 1.x
const Address = new Schema('Address', { city: 'string' });
const User = new Schema('User', { name: 'string', home: 'Address', 'boss?': 'User' }, { schemas: { Address } });
```

```js
// 2.0
const { Model } = require('@alexify/metaschema');

const model = new Model({}, new Map([
  ['Address', { Struct: {}, city: 'string' }],
  ['User', { Struct: {}, name: 'string', home: 'Address', 'boss?': 'User' }],
]));
const { Address, User } = Schema.fromModel(model);
```

The options of each entity go under `entities`: `Schema.fromModel(model, { entities: { Address:
{ sparse: true } } })`.

## Schemas used by value

A protoarray `Schema` inside a definition is gone. Use the metaschema schema instead, which is
inlined with the options of the schema around it, the same wire and id as 1.x gave the embedded
schema:

```js
// 1.x
const Address = Schema.from({ city: 'string', zip: '?string' });
const User = Schema.from({ id: 'number', home: Address });
```

```js
// 2.0
const Address = Definition.from({ city: 'string', zip: '?string' });
const User = Schema.from(Definition.from({ id: 'number', home: Address }));
```

An embedded schema with options of its own (`layout`, `sparse`) becomes a path option of the
schema around it:

```js
// 1.x
const Items = Schema.from({ array: { sku: 'string', qty: '?number' } }, { layout: 'flat' });
const Order = Schema.from({ id: 'number', items: Items });
```

```js
// 2.0: the same wire, [1, ['A', null, 'B', 2]]
const Order = Schema.from(
  { id: 'number', items: { array: { sku: 'string', qty: '?number' } } },
  { metaschema, layout: { items: 'flat' } },
);
```

Or reference an entity of a `Model` by name, which keeps the options given for it in `entities`.

## delta and intern: options by path

`delta: true` and `intern: true` on a field become options that name the field by path, and
`intern: false` on a field becomes a list of the strings to intern:

```js
// 1.x
Schema.from({ ids: { array: 'integer', delta: true }, role: { type: 'string', intern: true } });
```

```js
// 2.0
Schema.from({ ids: { array: 'integer' }, role: 'string' }, { metaschema, delta: ['ids'], intern: ['role'] });
```

A field of the record of a `columns` collection is `'[].id'`, of a nested collection
`'orders[].id'` (see [Paths](/guide/schema#paths)). The wire and the canonical form are the ones
1.x gave.

## Where metaschema reads differently

1.x read a few forms its own way; 2.0 reads them as metaschema's `check` does:

- **A reference to a stored kind** (`Entity`, `Registry`, `Dictionary`, …) travels as its id, a
  string, where 1.x embedded the record. Keep the record with `embed: true` on the field, or with
  the option `references: 'embed'` for every reference:

  ```js
  const model = new Model({}, new Map([
    ['Company', { Entity: {}, name: 'string' }],
    ['User', { Struct: {}, name: 'string', company: 'Company' }],
  ]));
  Schema.fromModel(model).User.encode({ name: 'A', company: 'c1' });                // ['A', 'c1']
  Schema.fromModel(model, { references: 'embed' }).User.encode({ name: 'A', company: { name: 'Acme' } }); // ['A', ['Acme']]
  ```

- **A stored kind adds its id field**, `<entity>Id` (`id` in an anonymous schema), an optional
  string after the fields of the definition, where 1.x skipped the kind. A field of that name in
  the definition is replaced by it: 1.x `{ Entity: {}, id: 'number', name: 'string' }` was
  `{id:number,name:string}`, 2.0 reads `{id:?string,name:string}`. Give a schema that is not a
  stored entity no kind, or `Struct: {}`.
- **A struct whose first key is a type name** (`type`, `map`, `flags`, …) is that type in
  metaschema, where 1.x refused it: name the kind first, `{ Struct: {}, type: { enum: [...] }, … }`.

## Schema.keys

```js
// 1.x
Schema.keys(['x', 'y']);
// 2.0: the same schema, {x:?json,y:?json}
Schema.from({ x: 'any', y: 'any' }, { metaschema });
```

## Validating values: metaschema

`validate: 'encode' | 'both' | 'decode'`, `schema.check(value)` and `check(schema, value)` are
gone. `validate` is a boolean that says whether decode checks the wire (`true`, the default, was
`'decode'`); encode trusts its values, as 1.0 did, and checking them is metaschema's:

```js
// 1.x
const User = new Schema('User', definition, { validate: 'both' });
const error = User.check(input);
if (error !== null) reply(400, { path: error.path, message: error.message });
```

```js
// 2.0
const User = Schema.from(new Definition('User', definition));
const result = User.source.check(input);
if (!result.valid) reply(400, { errors: result.errors });
```

metaschema's `check` knows every rule of the definition, `length`, `pattern` and `validate`
included, which 1.x ignored. Encode still throws for what has no wire: `object`, `array`, `set`,
`map`, `iterable`, `depth`, `union`, and `type` for a value a `delta` list cannot hold;
`EncodeError`'s `required` and `enum` codes are gone.

## resolve is a subpath

```js
// 1.x
Schema.resolve(V1, V2);
```

```js
// 2.0
const { resolve } = require('@alexify/protoarray/resolve');
resolve(V1, V2);
// or, once: require('@alexify/protoarray/resolve').register(); then Schema.resolve(V1, V2)
```

## The metaschema subpath is gone

| 1.x `@alexify/protoarray/metaschema` | 2.0 |
| --- | --- |
| `fromMetaschema(schema, options)` | `Schema.from(schema, options)` |
| `fromModel(model, options)` (a registry) | `SchemaRegistry.from(model, options)`, or `Schema.fromModel(model, options)` for the schemas by name |
| `types` (`bytes`, `flags`) | nothing: both are built in to metaschema 3.4 |
| `register()` | nothing: `Schema.from` and `SchemaRegistry.from` take metaschema's objects |

## TypeScript

A schema is typed by the metaschema schema it is built from, `Schema<Output, Input>`, instead of
by the definition literal. `Infer`, `Input`, `Encoded`, `Definition`, `FieldDefinition` and their
kin are gone:

```ts
// 1.x
type User = Infer<typeof User.definition>;
// 2.0
type User = ReturnType<typeof User.decode>; // or metaschema's own type of the definition
```

A schema built from a snapshot or an injected definition is `Schema<unknown>` unless a type
argument gives it one: `Schema.from<User>(snapshot)`. See [TypeScript](/guide/typescript).

## Standalone modules

Generate them again: a 1.x module of the `import` runtime builds its schemas from definition
literals, which 2.0 no longer reads, where a 2.0 module embeds the snapshots of its schemas and
builds them with `Schema.fromModel`. The `inline` runtime's exports lose `check`.
`protoarray compile` reads modules that export protoarray schemas, metaschema `Schema`s or
metaschema `Model`s (see [Standalone Modules](/guide/standalone)).
