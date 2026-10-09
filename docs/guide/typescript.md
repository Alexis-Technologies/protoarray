# TypeScript

The package ships hand-written typings. A definition literal is enough to type the object a schema
decodes to and the value it accepts:

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
| `'string'`, `'number'`, `'boolean'`, `'bigint'`, `'date'` | `string`, `number`, `boolean`, `bigint`, `Date` |
| `'json'` | `unknown` |
| `'?T'`, `'key?'`, `required: false`, `default` | `T \| null` |
| `{ array: T }` | `T[]` |
| `{ enum: ['a', 'b'] }` | `'a' \| 'b'` |
| `{ flags: ['x', 'y'] }` | `{ x: boolean; y: boolean }` |
| `['number', '?string']` | `[number, string \| null]` |
| a nested struct or a schema by value | the nested object type |
| a schema by name (`'User'`) | `unknown` — the registry is not visible to the type system |

`schema.list` is typed as a `Collection<D>` whose `decode` returns `Infer<D>[]`. The functional
entry points (`encode(schema, value)` and friends) carry the same types.

The error classes export their code unions: `SchemaErrorCode`, `EncodeErrorCode`,
`DecodeErrorCode`.
