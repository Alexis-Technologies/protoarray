# Defining a Schema

protoarray has no definition language of its own: schemas are
[`@alexify/metaschema`](https://metaschema.vercel.app/)'s. A definition is written in
metaschema's language, metaschema reads it into a schema, and that schema writes a **snapshot**:
plain JSON (format 1) that says which fields there are, in which order, of which types.
protoarray reads the snapshot and compiles it into a codec. One definition validates values with
metaschema and carries them with protoarray.

```js
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');

const Address = Definition.from({ city: 'string', street: 'string', zip: '?string' });

const User = Schema.from(
  new Definition('User', {
    id: 'number',
    name: 'string',
    active: 'boolean',
    role: { enum: ['admin', 'editor', 'viewer'] },
    address: Address,
    tags: { array: 'string' },
    orders: { array: { sku: 'string', qty: 'number' } },
    createdAt: 'date',
    perms: { flags: ['read', 'write', 'admin'] },
    balance: { type: 'number', default: 0 },
    manager: '?User',
    email: '?string',
  }),
);
```

protoarray stays without dependencies: it never requires metaschema, in its runtime or in its
types. It recognises a metaschema `Schema` or `Model` by its brand and asks it for its snapshot,
reads a snapshot it is given directly, and reads a raw definition only when the metaschema module
is passed to it as an option.

## Sources

| Source | Call | metaschema at runtime |
| --- | --- | --- |
| A metaschema `Schema` | `Schema.from(new Definition('User', { … }))` | where the schema is defined |
| A definition, with metaschema injected | `Schema.from({ … }, { metaschema })` | yes, the core or `./definition` |
| A snapshot | `Schema.from(snapshot)` | no |
| A metaschema `Model`, or its snapshot | `Schema.fromModel(model)` → `{ [entity]: Schema }` | no, for a snapshot |
| A protoarray schema | `Schema.from(User, options)` | no |

### A metaschema Schema

`Schema.from(definitionSchema, options?)` reads `definitionSchema.toSnapshot()` (metaschema 3.4 or
newer). The schema keeps the metaschema schema as `source`, whose `check` and `parse` validate
values, and in TypeScript it is typed by it (see [TypeScript](/guide/typescript)). An entity of a
`Model` is a metaschema `Schema` too: `Schema.from(model.entities.get('User'))` builds it with the
entities it references.

### A definition, with metaschema injected

A definition literal needs something to read it, and protoarray does not bring metaschema along:
pass the module as the `metaschema` option.

```js
const metaschema = require('@alexify/metaschema');

const Point = Schema.from({ x: 'number', y: 'number' }, { metaschema });
const Node = new Schema('Node', { value: 'number', 'next?': 'Node' }, { metaschema });
```

`@alexify/metaschema/definition`, the half of metaschema that builds schemas and does not
validate them (10.3 KB min+gzip), reads a definition as well: `{ metaschema:
require('@alexify/metaschema/definition') }`. A definition metaschema cannot read throws
metaschema's own `SchemaDefinitionError` (see [Errors](/guide/errors#schema-errors)).

### A snapshot

```js
const User = Schema.from(snapshot); // what Definition#toSnapshot() or Model#toJSON() wrote
```

A snapshot is JSON, so it can come from a server, a file or a build step, and protoarray reads it
without metaschema: a client that receives the snapshots of its server's schemas carries 22 KB of
protoarray and nothing else (see [metaschema and protoarray](/guide/metaschema)). A snapshot of one
schema names its entity in `root`; a model's snapshot holds several, and `{ entity: 'User' }`
picks one. The snapshot is read as untrusted input: a broken one is a `SchemaDefinitionError`
`ERR_INVALID_SNAPSHOT` with the path, never a crash (see [Security](#a-snapshot-is-input)).

### A Model

`Schema.fromModel(modelOrSnapshot, options?)` builds every entity of a metaschema `Model` (or of
`model.toJSON()`), in the model's order, as an object of schemas by name. References between
entities reach one another, a recursion between two entities included.

```js
const { Model } = require('@alexify/metaschema');

const model = new Model({}, new Map([
  ['Address', { Struct: {}, city: 'string', zip: '?string' }],
  ['User', { Entity: {}, name: 'string', home: 'Address' }],
]));

const { Address, User } = Schema.fromModel(model);
User.toString(); // '{name:string,home:@Address,userId:?string}'
```

Its options apply to every entity; the ones that shape one schema's wire (`sparse`, `layout`,
`intern`, `delta`) go under `entities`, by name: `{ entities: { Address: { sparse: true } } }`.

### A schema with other options

`Schema.from(User, options)` builds the same schema again from its snapshot with the options
given, which replace the ones it was built with: `Schema.from(User, { codegen: false })`.

### Constructors

```js
Schema.from(source, options?);               // named by its source ('' for a definition literal)
new Schema(source, options?);                // the same
new Schema(name, source, options?);          // a name of your own, which a definition reaches for a recursion
Schema.fromModel(modelOrSnapshot, options?); // every entity, by name
```

A source is a collection, a tuple or a single scalar as well as a struct: `{ array: { … } }`,
`['number', '?string']`, `'string'`. Anything else is `ERR_SCHEMA_EXPECTED`, a plain object
included when no `metaschema` is given.

## The definition

The language is metaschema's, and its guide documents it:
[schema syntax](https://metaschema.vercel.app/guide/schema-syntax) (fields, optional keys, long
forms, the first key that decides what an object is),
[types](https://metaschema.vercel.app/guide/types),
[kinds and metadata](https://metaschema.vercel.app/guide/kinds-and-metadata) and
[references](https://metaschema.vercel.app/guide/references). What protoarray adds is a wire form
for each of its types:

| metaschema | On the wire |
| --- | --- |
| `string`, `number`, `integer`, `boolean`, `json`, `any`, `unknown` | as is |
| `null` | `null` |
| `date`, `bigint`, `bytes` | epoch milliseconds, a decimal string, base64 |
| `{ type: 'number', decimals: 2 }` | an integer scaled by 10ⁿ |
| `{ enum: [...] }`, `{ flags: [...] }` | an index, a bitmask |
| a struct, a schema used as a field | a nested array |
| `{ array }`, `{ set }`, `{ map }`, `{ object }`, a tuple | an array, an array, flat key-value pairs, an object, an array |
| `{ union: [...], discriminator }` | `[tag, ...the branch's fields]` |
| a reference | the record, or its id (see [References](#references)) |
| an alias, `{ money: { js: 'number' } }` | its type, down its chain |
| a custom type with a check of its own | the wire type the `types` option gives it |
| a calculated field, a function | nothing: it has no position |

[Types](/guide/types) shows each one, and [Wire Format](/guide/wire-format) has the rules. The
rules metaschema checks (`length`, `min` and `max`, `pattern`, `format`, `validate`) and the
metadata (kinds, indexes, relations) do not reach the wire: checking values is metaschema's.

## Positions

Fields take positions in the order of the definition, which is the order of the snapshot. Four
rules keep that order safe:

- Integer-like keys (`'1'`, `'007'`) are refused (`ERR_INTEGER_KEY`): JavaScript orders them
  first, whatever the source says.
- `__proto__` is refused (`ERR_RESERVED_KEY`).
- A stored kind (`Entity`, `Registry`, …) adds the optional id field metaschema gives it,
  `<entity>Id` (`id` for an anonymous schema), after the fields of the definition: `{ Entity: {},
  a: 'number' }` is `{a:number,id:?string}`.
- An object whose first key is a type name is that type in metaschema, not a struct: a struct
  whose first field is `type`, `map` or `flags` names its kind first, `{ Struct: {}, type: … }`.

Optional fields are best declared last: only the trailing run of optional fields can be left off
the wire (see [Optional Fields](/guide/optional-fields)).

## References

A capitalised type name is a reference to an entity, and it travels as metaschema's `check` reads
it, so the value protoarray carries is the value metaschema validates:

| The field refers to | By default (`references: 'kind'`) | `embed: true` on the field | `references: 'embed'` | `references: 'id'` |
| --- | --- | --- | --- | --- |
| a stored kind (`Entity`, `Registry`, …) | its id, a string | the record | the record | the id |
| a memory kind (`Struct`, a schema without a kind) | the record | the record | the record | the id |

`embed: false` on a field holds the id of a memory kind. A list, `{ many: 'Tag' }`, is a list of
ids or of records by the same rule. A record travels as the referenced schema's own wire, and the
canonical form prints it as `@Name`.

A reference reaches the entities of a `Model`, or of the snapshot of a schema that references
them (`toSnapshot()` writes every entity the schema reaches). Without a model, a schema reaches
its own name only, which is how a recursion is written: `manager: '?User'` above, or
`new Schema('Node', { value: 'number', 'next?': 'Node' }, { metaschema })`. An entity reached
by a reference keeps the options given for it in `entities`.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `codegen` | runtime | `true` requires generated code (throws `ERR_CODEGEN_UNAVAILABLE` where blocked), `false` forces closures. See [Runtimes](/guide/runtimes) |
| `validate` | `true` | `true` checks the wire on decode; `false` trusts it (the array structure is still checked). The values given to encode are not checked: that is metaschema's `check`. See [Errors](/guide/errors#what-is-validated) |
| `sparse` | `false` | `true` for the root struct, or the paths of structs: `[mask, ...present values]`. See [Optional Fields](/guide/optional-fields#sparse-records) |
| `layout` | `'rows'` | `'flat'` or `'columns'` for a root collection of records, or `{ path: layout }` for collections inside a record. See [Collections](/guide/collections#layouts) |
| `delta` | `[]` | The paths of integer, number, date or decimals columns and lists that travel as differences. See [Types](/guide/types#delta) |
| `intern` | `false` | `true` for every string, or the paths of strings: `[table, body]`. See [Types](/guide/types#interned-strings) |
| `stringify` | `'auto'` | How `stringify` writes the text: `'auto'`, `'builder'` or `'native'`. See [Runtimes](/guide/runtimes#how-stringify-writes-the-text) |
| `fingerprint` | FNV-1a 32-bit | `(signature) => string`, computes `id` from the schema's signature (below). See [Schema Evolution](/guide/evolution#your-own-fingerprint) |
| `maxDepth` | `Infinity` | The levels of a recursion one payload may nest: deeper is `DecodeError` `structure` or `EncodeError` `depth`, at the same depth on either backend. By default nothing is counted and the call stack is the limit, which differs between backends; `512` is a depth both reach everywhere. See [Errors](/guide/errors#depth) |
| `references` | `'kind'` | How every reference travels: `'kind'`, `'embed'` or `'id'`. See [References](#references) |
| `types` | `{}` | The wire type of each custom type with a check of its own: `{ decimal: 'string' }` |
| `entity` | the snapshot's `root` | The entity of a snapshot to build (a metaschema Schema builds its own) |
| `entities` | `{}` | Options of the entities references reach, by name: `{ Address: { sparse: true } }`. Each key names an entity of the snapshot, each one's options are checked whether a reference reaches it or not, and an option an entity leaves undefined is the shared one |
| `metaschema` | none | The metaschema module, to read a definition: `require('@alexify/metaschema')` or its `./definition` |
| `compiled` | none | The codec of a generated module. See [Standalone Modules](/guide/standalone) |

### Paths

`sparse`, `layout`, `delta` and `intern` name the places they shape by path, spelled as error
paths are:

| Path | Place |
| --- | --- |
| `''` | the root |
| `address.city` | a field of a nested struct |
| `orders[]`, `orders[].sku` | the item of a collection, a field of it |
| `scores{}` | the value of a map or a dictionary |
| `pair[1]` | an element of a tuple |
| `packet[0].args` | a field of a union's branch |

```js
const Customer = Schema.from(
  {
    id: 'integer',
    profile: { bio: '?string', site: '?string' },
    orders: { array: { at: 'date', city: 'string', total: 'number' } },
  },
  {
    metaschema,
    sparse: ['profile'],
    layout: { orders: 'columns' },
    delta: ['orders[].at'],
    intern: ['orders[].city'],
  },
);
Customer.toString();
// '{id:integer,profile:sparse{bio:?string,site:?string},orders:columns[{at:date~,city:string*,total:number}]}'
```

A path that names no place of the schema, or a place of another kind (`sparse` on a string,
`delta` on a string), is `ERR_INVALID_OPTIONS`, as is an unknown option or a value of the wrong
type: `Option "delta" names no place of the schema at "ids"`. A path stays inside its schema: an
entity reached by a reference takes its options from `entities`. A key that holds a dot,
brackets or braces, begins with a quote or is empty is a quoted JSON string in brackets, in an
option's path as in an error's: `sparse: ['["a.b"]']`, `delta: ['[]["at.x"]']`. `delta` on a lone
number outside a `columns` collection marks its form (`id:integer~`) and its id, as 1.x did, and
changes nothing on the wire.

## Properties

| Property | Value |
| --- | --- |
| `name` | The name given to the constructor, or the metaschema schema's, or the snapshot's `root`; `''` for a nameless one |
| `snapshot` | The snapshot the schema was read from, the object as it was given (`null` for a list or a resolved schema); leave it as it is, since `Schema.from(schema)` and a generated module read it again |
| `source` | The metaschema `Schema` it was built from, or `null` (a snapshot, a model, another entity of the snapshot of a schema built again) |
| `keys` | Field keys in wire order (frozen; empty for a collection, a tuple or a scalar); an alias has the keys of what it stands for |
| `backend` | `'codegen'`, `'closures'`, or `'standalone'` for a schema built with `compiled` |
| `layout` | `'dense'` or `'sparse'` for a struct; `'rows'`, `'flat'` or `'columns'` for a collection |
| `id` | A fingerprint of the schema's signature, see below |
| `list` | The schema of an array of these records, as rows; it reuses this schema's codec and name |

`toString()` returns the canonical form of the schema: every position with its type.

```js
User.toString();
// '{id:number,name:string,active:boolean,role:enum(admin|editor|viewer),address:{city:string,street:string,zip:?string},tags:[string],orders:[{sku:string,qty:number}],createdAt:date,perms:flags(read|write|admin),balance:?number=0,manager:?@User,email:?string}'
User.id; // 'cecbac56' — FNV-1a of its signature, the same on both sides of the wire
```

`id` is the fingerprint of the schema's **signature**: its canonical form, followed by
`;Name=<canonical form>` for every other entity it references by name, sorted by name. A
reference prints as `@Name` in the canonical form, so the signature brings in what that name
stands for: when a referenced entity changes, so does the id of every schema that references it.
A recursion to the schema's own name adds nothing, which is why `User` above is its canonical form
alone, and neither does the schema itself as the record of its `list`. A name that holds the
form's punctuation prints quoted (see [the canonical form](/guide/wire-format#canonical-form)).

```js
const { Model } = require('@alexify/metaschema');
const model = new Model({}, new Map([
  ['Address', { Struct: {}, city: 'string' }],
  ['Person', { Struct: {}, home: 'Address', 'boss?': 'Person' }],
]));
const { Person } = Schema.fromModel(model);
Person.toString(); // '{home:@Address,boss:?@Person}'
// signature:         '{home:@Address,boss:?@Person};Address={city:string}'
```

Two schemas with the same positions, types, keys and referenced entities have the same `id`,
whatever name the schema was given and whichever way it was built. Renaming a key changes it, and
so does the optionality of a root scalar (`'?string'` prints as `?string`). The canonical form is
the one protoarray 1.x gave the same shape, and so is the id of a schema that references no other
entity, so a 2.0 schema and a 1.x schema agree on the wire; one that references another entity by
name has a new id in 2.0 (1.x fingerprinted its canonical form alone). The `fingerprint` option
replaces the hash (see [Schema Evolution](/guide/evolution#your-own-fingerprint)).

## A snapshot is input

A snapshot that arrives over the network is read as untrusted input: its format, its entity and
every form in it are checked, nesting is limited (64 levels an entity; the entities a reference
reaches are read from a list, so a long chain of them never exhausts the stack), references that
come back to themselves with no record between them are refused, a default of another type than
its field is left to metaschema, a `__proto__` or integer-like key is refused, and
keys, enum values and defaults reach generated code only through `JSON.stringify`. A peer that
sends a snapshot still decides your wire, though: accept snapshots only from a peer you trust to
define it, such as your own server (see [SECURITY.md](https://github.com/Alexis-Technologies/protoarray/blob/main/SECURITY.md)).
