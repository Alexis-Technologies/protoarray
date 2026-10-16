# metaschema and protoarray

[`@alexify/metaschema`](https://metaschema.vercel.app/) defines schemas, validates values and
describes domain models; protoarray carries the values of those schemas as positional arrays. In
2.0 the two split the work: a definition is metaschema's, written in its language and read by it,
and protoarray reads what metaschema writes of it, the
[snapshot](https://metaschema.vercel.app/guide/model#the-snapshot-of-one-schema). One definition
validates with metaschema and travels with protoarray, and both libraries mean the same thing by
it, a reference or an optional field included.

protoarray has no dependency on metaschema, not even a peer one. It recognises a metaschema
`Schema` or `Model` by its brand, reads a snapshot as plain JSON, and reads a raw definition only
with the metaschema module handed to it. Which of the three a program uses decides what it
carries.

## Three ways to build a schema

| | Where | Carries | Validates values |
| --- | --- | --- | --- |
| [A metaschema `Schema`](#from-a-metaschema-schema) | a server, a program that defines its schemas | metaschema and protoarray | yes, `schema.source.check` |
| [A definition, metaschema injected](#from-a-definition) | a program that keeps definition literals | metaschema (or its `./definition` entry) and protoarray | with the core entry |
| [A snapshot](#from-a-snapshot) | a client that gets its schemas from its server or a build step | protoarray alone, about 22 KB | no |

### From a metaschema Schema

```js
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');

const definition = new Definition('User', { id: 'integer', name: 'string', 'email?': 'string' });
const User = Schema.from(definition);

User.source === definition;               // true
definition.check({ id: 1 }).errors;        // [ 'Field "User.name" is required' ]
User.stringify({ id: 1, name: 'Alex' });   // '[1,"Alex"]'
```

The schema is typed by the metaschema schema (see [TypeScript](/guide/typescript)), keeps it as
`source`, and is built from `definition.toSnapshot()`. An entity of a `Model` works the same way,
with the entities it references: `Schema.from(model.entities.get('User'))`, or every entity at once
with `Schema.fromModel(model)`.

### From a definition

```js
const metaschema = require('@alexify/metaschema');

const User = Schema.from({ id: 'integer', name: 'string', 'email?': 'string' }, { metaschema });
```

The definition is read by the metaschema module given, so a definition metaschema refuses throws
metaschema's own `SchemaDefinitionError`. `User.source` is the metaschema schema it built.

`@alexify/metaschema/definition` is the half of metaschema that builds schemas and their snapshots
without the half that validates them: 10.3 KB min+gzip against 21.3 KB for the core, by
metaschema's own measure. It is enough for protoarray, for a program that encodes and decodes but
does not check values:

```js
const definition = require('@alexify/metaschema/definition');

const User = Schema.from({ id: 'integer', name: 'string' }, { metaschema: definition });
```

### From a snapshot

A snapshot is plain JSON with a written contract (format 1), so it can travel: a server sends the
snapshots of its schemas, or a build step writes them into a file, and the client builds its
schemas from them with protoarray alone.

```js
// The server: metaschema defines and validates.
const { Schema: Definition } = require('@alexify/metaschema');
const User = new Definition('User', { id: 'integer', name: 'string', 'email?': 'string' });

app.get('/schemas/user', (request, reply) => reply.send(User.toSnapshot()));
```

```js
// The client: no metaschema, about 22 KB of protoarray.
import { Schema } from '@alexify/protoarray';

const User = Schema.from(await (await fetch('/schemas/user')).json());
User.parse('[1,"Alex"]'); // { id: 1, name: 'Alex', email: null }
```

A model's snapshot, `model.toJSON()`, holds every entity: `Schema.fromModel(snapshot)` builds them
all, and `Schema.from(snapshot, { entity: 'User' })` one of them. The client checks the wire on
decode, as any schema does, but does not validate the values it encodes: the server's metaschema
does. Where a runtime forbids code generation as well, a [standalone module](/guide/standalone)
embeds the snapshots with their generated code, and still needs no metaschema.

protoarray reads a snapshot as untrusted input (see [Defining a Schema](/guide/schema#a-snapshot-is-input)),
but the peer that sends it decides the client's wire: accept snapshots only from a server you
trust to define it.

## Same definition, same meaning

protoarray reads every form of metaschema's language as metaschema's `check` reads it, so the
values that pass `check` are the values the wire carries:

| metaschema | protoarray |
| --- | --- |
| scalars, structs, `?`, `required`, `nullable`, `default`, collections, tuples, enums | the same shapes: see [Types](/guide/types) |
| `integer`, `any`, `unknown`, `null` | as is; `any` and `unknown` as `json` |
| `date`, `bigint`, `bytes`, `flags`, `decimals` | epoch milliseconds, a decimal string, base64, a bitmask, a scaled integer |
| `{ union: [...], discriminator }` | `[tag, ...fields]` |
| `{ union: [...] }` without a discriminator | `ERR_UNKNOWN_TYPE`: no positional form |
| a reference to a stored kind (`Entity`, `Registry`, …) | its id, a string, unless `embed: true` or `references: 'embed'` |
| a reference to a memory kind (`Struct`, a schema without a kind) | the record, unless `embed: false` or `references: 'id'` |
| a stored kind's id field, `<entity>Id` | the last field, optional |
| a struct whose first key is a type name | that type: a struct names its kind first, `{ Struct: {}, type: … }` |
| a type alias, `{ money: { js: 'number' } }` | its type, down the chain |
| a custom type with `checkType` | the wire type the `types` option gives it, `ERR_UNKNOWN_TYPE` without |
| `length`, `min`, `max`, `pattern`, `format`, `validate`, `unique` | not on the wire: metaschema checks them |
| a `default` that is a function, a `Date` or a bigint | not on the wire: metaschema's `parse` applies it |
| `parse` and `serialize` on a field | metaschema's: protoarray encodes the value it is given |
| `aliases` | read by [`resolve`](/guide/resolve#aliases), as metaschema's `parse` reads them |
| a calculated field, the schema's own functions | no position |
| kinds, scopes, indexes, relations | metadata: not on the wire |

The [references guide](https://metaschema.vercel.app/guide/references) has the rule for references
and the [kinds guide](https://metaschema.vercel.app/guide/kinds-and-metadata) the stored and memory
kinds; [Defining a Schema](/guide/schema#references) shows the `references` option.

## Validating and encoding

The two halves meet at the boundaries of a program: check what comes in from a user, encode what
goes out, decode what comes back.

```js
const result = User.source.check(input);
if (!result.valid) throw new Error(result.summary);
socket.send(User.stringify(input));

const message = User.parse(text); // the wire checked by protoarray
```

A decoded object passes metaschema's `check`: every key present, `null` for the optional ones that
were missing. metaschema's `parse` applies defaults and codecs, and `{ references: 'embed' }`
checks a graph of records, as protoarray's option of the same name carries one.
