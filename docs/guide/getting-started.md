# Getting Started

## Installation

```bash
pnpm add @alexify/protoarray
# or
npm install @alexify/protoarray
```

Node.js 18 or newer, or any browser through a bundler. The package has no runtime dependencies.

## Importing

```js
const { Schema } = require('@alexify/protoarray');
```

```js
import { Schema } from '@alexify/protoarray';
```

## Define a schema

A schema is a plain object: keys are the fields, values are their types, in the order they will
take on the wire.

```js
const User = new Schema('User', {
  id: 'number',
  name: 'string',
  role: { enum: ['admin', 'editor', 'viewer'] },
  address: { city: 'string', zip: '?string' },
  tags: { array: 'string' },
  email: '?string',
});
```

`'?string'` is an optional string. The name is optional (`Schema.from(definition)` gives a nameless
one); it is what fields of other schemas refer to.

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

Send the text over HTTP, a WebSocket, a queue, or store it. On the other side, the same definition
decodes it. Decoding validates the wire by default: a wrong type or a missing required field throws
a `DecodeError` with a path such as `address.city`.

## Lists of records

`User.list` is the schema of an array of users, one row per record:

```js
User.list.encode([user, user]);
// [[1, 'Alex', 1, ['Kyiv'], ['a']], [1, 'Alex', 1, ['Kyiv'], ['a']]]
```

## Next steps

- [Defining a Schema](/guide/schema) — every form of the definition DSL.
- [Types](/guide/types) — what each type looks like on the wire.
- [Optional Fields](/guide/optional-fields) — `null`, defaults, trimming and sparse records.
- [Schema Evolution](/guide/evolution) — adding fields without breaking older peers.
- [TypeScript](/guide/typescript) — `Infer` and `Input`.
