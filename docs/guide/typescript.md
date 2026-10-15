# TypeScript

The package ships hand-written typings, for TypeScript 5.0 or newer (the definition is read as a
`const` type parameter). A definition literal is enough to type the object a schema decodes to and
the value it accepts:

```ts
import { Schema, type Infer, type Input } from '@alexify/protoarray';

const User = new Schema('User', {
  id: 'number',
  name: 'string',
  role: { enum: ['admin', 'editor', 'viewer'] },
  address: { city: 'string', zip: '?string' },
  tags: { array: 'string' },
  createdAt: 'date',
  email: '?string',
});

type User = Infer<typeof User.definition>;
// {
//   id: number;
//   name: string;
//   role: 'admin' | 'editor' | 'viewer';
//   address: { city: string; zip: string | null };
//   tags: string[];
//   createdAt: Date;
//   email: string | null;
// }

const user = User.decode(['x']); // User
User.encode({ id: 1, name: 'Alex', role: 'editor', address: { city: 'Kyiv' }, tags: [], createdAt: new Date() });
```

`Schema` takes a `const` type parameter, so the literal keeps its string literal types without
`as const`.

- `Infer<D>` is what `decode` and `parse` return: every field present, optional ones
  `T | null`.
- `Input<D>` is what `encode` and `stringify` accept: optional fields may be left out, `null` or
  `undefined`; a missing required field or a wrong type is a compile error.
- `Encoded<D>` is the wire: `unknown[]`, or `unknown` for a scalar schema.

| Definition | `Infer` |
| --- | --- |
| `'string'`, `'number'`, `'integer'`, `'boolean'`, `'bigint'`, `'date'`, `'bytes'` | `string`, `number`, `number`, `boolean`, `bigint`, `Date`, `Uint8Array` |
| `'json'`, `'any'`, `'unknown'` | `unknown` |
| `'null'` | `null` |
| `'?T'`, `'key?'`, `required: false`, `default` | `T \| null` |
| `{ array: T }` | `T[]` |
| `{ set: T }` | `Set<T>` (`Input` also takes `readonly T[]`) |
| `{ map: { string: V } }`, `{ map: { number: V } }` | `Map<string, V>`, `Map<number, V>` |
| `{ object: { string: V } }` | `Record<string, V>` |
| the long forms (`{ type: 'map', key, value }`, …) | as their shorthands |
| `{ enum: ['a', 'b'] }` | `'a' \| 'b'` |
| `{ flags: ['x', 'y'] }` | `{ x: boolean; y: boolean }` |
| `['number', '?string']`, `[{ x: 'number' }, { 'y?': 'string' }]` | `[number, string \| null]` |
| a nested struct or a schema by value | the nested object type |
| `{ union: [A, B], discriminator: 'type' }` | `Infer<A> \| Infer<B>`, narrowed by the discriminator |
| a schema by name (`'User'`) | `unknown` — the registry is not visible to the type system |

A union decodes to the union of its branches, so checking the discriminator narrows it:

```ts
const Packet = Schema.from({
  union: [
    { Struct: {}, type: { enum: ['call'] }, id: 'string' },
    { Struct: {}, type: { enum: ['event'] }, name: 'string' },
  ],
  discriminator: 'type',
});
const packet = Packet.decode(wire);
if (packet.type === 'call') packet.id; // string
```

Branches declared as separate constants need `as const` to keep their enum literals. A struct's
kind (`Struct: {}`, a capitalised first key holding an object) is not a field; the types, which
cannot see key order, skip any capitalised key that holds plain metadata.

`schema.list` is typed as a `Collection<D>` whose `decode` returns `Infer<D>[]`. The functional
entry points (`encode(schema, value)` and friends) are typed after the methods of the schema they
get. `Schema.resolve(writer, reader)` is typed as the reader: it decodes to `Infer` of the reader's
definition. The subpaths ship their own typings (`registry.d.ts`, `stream.d.ts`,
`metaschema.d.ts`, `standalone.d.ts`); the methods `register()` installs on `Schema` are declared
by module augmentation, so they type-check whether `register()` ran or not.

The error classes export their code unions: `SchemaErrorCode`, `EncodeErrorCode`,
`DecodeErrorCode`.
