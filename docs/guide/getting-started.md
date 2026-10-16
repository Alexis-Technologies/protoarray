# Getting Started

## Installation

```bash
pnpm add @alexify/protoarray @alexify/metaschema
# or
npm install @alexify/protoarray @alexify/metaschema
```

Node.js 18 or newer, or any browser through a bundler. protoarray has no runtime dependencies.
Schemas are defined with [`@alexify/metaschema`](https://metaschema.vercel.app/) (3.4 or newer),
which you install where you define them; protoarray never requires it, so a client that receives
its schemas as snapshots installs protoarray alone (see
[metaschema and protoarray](/guide/metaschema)).

## Importing

```js
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');
```

```js
import { Schema } from '@alexify/protoarray';
import { Schema as Definition } from '@alexify/metaschema';
```

Both packages export a `Schema`; these pages call metaschema's `Definition`.

## Define a schema

A definition is a plain object in [metaschema's language](https://metaschema.vercel.app/guide/schema-syntax):
keys are the fields, values are their types, in the order they will take on the wire.

```js
const User = Schema.from(
  new Definition('User', {
    id: 'number',
    name: 'string',
    role: { enum: ['admin', 'editor', 'viewer'] },
    address: { city: 'string', zip: '?string' },
    tags: { array: 'string' },
    email: '?string',
  }),
);
```

`'?string'` is an optional string. metaschema reads the definition into a schema, which validates
values and writes the snapshot `Schema.from` compiles into a codec. The metaschema schema stays at
hand as `User.source`, and in TypeScript it types `User`.

A definition literal works too, with metaschema handed over as an option:

```js
const metaschema = require('@alexify/metaschema');

const Point = Schema.from({ x: 'number', y: 'number' }, { metaschema });
```

## Encode and decode

```js
const user = { id: 1, name: 'Alex', role: 'editor', address: { city: 'Kyiv' }, tags: ['a'] };

User.encode(user);
// [1, 'Alex', 1, ['Kyiv'], ['a']]

User.decode([1, 'Alex', 1, ['Kyiv'], ['a']]);
// { id: 1, name: 'Alex', role: 'editor', address: { city: 'Kyiv', zip: null }, tags: ['a'], email: null }
```

`encode` returns the positional array, `decode` the object. The enum travelled as its index, the
missing `zip` as nothing at all (a trailing `null` is trimmed), and `email` was never on the wire.
Decoded objects always carry every key of the schema, in schema order, with `null` for what was
missing.

## Over the wire

`stringify` and `parse` add `JSON.stringify` and `JSON.parse`:

```js
const text = User.stringify(user); // '[1,"Alex",1,["Kyiv"],["a"]]'
User.parse(text);                  // the object again
```

Send the text over HTTP, a WebSocket, a queue, or store it. On the other side, the same schema
decodes it, and checks it by default: a wrong type or a missing required field throws a
`DecodeError` on the receiver, with a path such as `address.city`. `encode` trusts the values it
is given; to catch a producer's bug before it leaves, check them with metaschema:

```js
const result = User.source.check(user);
result.valid;  // true
result.errors; // [] — or 'Field "User.address.city" is required', …
```

## Lists of records

`User.list` is the schema of an array of users, one row per record:

```js
User.list.encode([user, user]);
// [[1, 'Alex', 1, ['Kyiv'], ['a']], [1, 'Alex', 1, ['Kyiv'], ['a']]]
```

## Without metaschema

A schema writes its snapshot, plain JSON, and protoarray builds the same schema from it with
nothing else:

```js
const snapshot = JSON.stringify(User.snapshot); // send it, or write it to a file at build time

const Same = Schema.from(JSON.parse(snapshot));
Same.id === User.id; // true
```

## Next steps

- [Defining a Schema](/guide/schema) — sources, options, references and properties.
- [Types](/guide/types) — what each type looks like on the wire.
- [Optional Fields](/guide/optional-fields) — `null`, defaults, trimming and sparse records.
- [Schema Evolution](/guide/evolution) — adding fields without breaking older peers.
- [metaschema and protoarray](/guide/metaschema) — which way to build a schema, and why.
- [Migrating from 1.x](/guide/migrating-from-1) — from protoarray's own DSL to metaschema's.
