# With metaschema

protoarray's DSL is the one of [`@alexify/metaschema`](https://metaschema.vercel.app/): the same
definition validates data with metaschema and serializes it with protoarray (see the
[compatibility table](/guide/schema#metaschema-compatibility)). `@alexify/protoarray/metaschema`
closes the remaining gaps in both directions without a dependency between the packages: it
recognises metaschema's objects by their brand.

## A protoarray schema from a metaschema Schema

A metaschema `Schema` keeps no raw definition, so `fromMetaschema(schema, options?)` reads its
field types and builds the protoarray schema of the same shape: the same keys, in the same order,
so the same positions.

```js
const { Model } = require('@alexify/metaschema');
const { fromModel, types } = require('@alexify/protoarray/metaschema');

const model = new Model(types, new Map([
  ['Company', { Entity: {}, name: 'string' }],
  ['Address', { Struct: {}, city: 'string', zip: '?string' }],
  ['User', {
    Entity: {},
    name: 'string',
    company: 'Company',
    home: 'Address',
    perms: { flags: ['read', 'write'] },
    avatar: '?bytes',
  }],
]));

const registry = fromModel(model);
const User = registry.find('User');
User.toString();
// '{name:string,company:string,home:@Address,perms:flags(read|write),avatar:?bytes,userId:?string}'

const wire = User.encode({ name: 'Alex', company: 'c1', home: { city: 'Kyiv' }, perms: { read: true } });
// ['Alex', 'c1', ['Kyiv'], 1]
model.entities.get('User').check(User.decode(wire)).valid; // true
```

How the field types translate:

| metaschema | protoarray |
| --- | --- |
| every type of the shared DSL (scalars, collections, tuples, enums, unions with a discriminator) | the same type |
| a type alias, `{ money: { js: 'number' } }` | its base type |
| `bytes`, `flags` from `types` below | `bytes`, `flags` |
| `decimals`, `aliases`, `delta`, `intern`, a primitive `default` | carried over |
| a `default` that is a function | left out: metaschema's `parse` applies it |
| `length`, `min`, `pattern`, `validate`, `parse`/`serialize` | left out: validation stays metaschema's |
| a calculated field | left out: it has no position |
| a reference to a stored entity (`Entity`, `Registry`, …) | its id, `'string'`; `{ many: … }` a list of ids |
| a reference to a memory kind (`Struct`), or a field with `embed: true` | the record, as a schema of its own by name |
| a stored entity's own id field (`userId`), which metaschema appends | the last, optional field |
| a union without a discriminator, a custom type that is not an alias | `ERR_UNKNOWN_TYPE` |

References follow metaschema's storage view: what a row holds. A memory kind that embeds itself
is a recursion by name; two that embed each other have no order to be built in and are refused.

`fromModel(model, options?)` translates every entity of a `Model`, in the model's order, and
returns a [`SchemaRegistry`](/guide/resolve#the-registry) of them, by name and by id. The options
are those of a `Schema` and apply to every schema built.

## Types for metaschema

`types` is the custom types table metaschema lacks for the two types protoarray adds: `bytes` (a
`Uint8Array`) and `flags` (an object of the listed names, each `true` or `false`). Pass it to
`new Model(types, entities)`; the same objects can be registered by any number of models. metaschema
has its own `date`, which protoarray reads as epoch milliseconds.

## register()

`register()` makes metaschema's objects usable where protoarray takes a definition, once per
process:

```js
require('@alexify/protoarray/metaschema').register();

const Address = Schema.from(model.entities.get('Address')); // fromMetaschema, through Schema.from
const Order = Schema.from({ id: 'integer', ship: model.entities.get('Address') });
const all = SchemaRegistry.from(model);                       // fromModel
```

Without it, a metaschema `Schema` in a definition is a `SchemaDefinitionError` `ERR_UNKNOWN_TYPE`
that says so, and `SchemaRegistry.from` throws the same.

metaschema lints the options protoarray reads (`decimals`, `delta`, `intern`) as unknown and keeps
them; `aliases` it reads itself.
