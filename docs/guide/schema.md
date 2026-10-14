# Defining a Schema

A definition is a plain JavaScript value in the DSL of
[`@alexify/metaschema`](https://metaschema.vercel.app/guide/schema-syntax): the same object can
validate data with metaschema and serialize it with protoarray.

```js
const { Schema } = require('@alexify/protoarray');

const Address = Schema.from({ city: 'string', street: 'string', zip: '?string' });

const User = new Schema('User', {
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
});
```

## Field forms

| Form | Example | Meaning |
| --- | --- | --- |
| Type name | `'string'` | A scalar: `string`, `number`, `boolean`, `bigint`, `date`, `json` |
| Optional type | `'?number'` | Optional: may be missing, `undefined` or `null` |
| Optional key | `'email?': 'string'` | The same, written on the key |
| Long form | `{ type: 'string', required: false, default: 'x' }` | Options on the field; `default` fills a missing slot on decode |
| Decimals | `{ type: 'number', decimals: 2 }` | A number that travels as an integer scaled by 10ⁿ: `19.99` is `1999` (see [Types](/guide/types#decimals)) |
| Struct | `{ city: 'string', zip: '?string' }` | A nested record, encoded as a nested array |
| Schema by value | `address: Address` | The other schema in that slot, with its own options and layout (see below) |
| Schema by name | `manager: '?User'` | The same through a capitalised name: the schema's own name (recursion) or one from `options.schemas` |
| Array | `{ array: 'string' }`, `{ array: { sku: 'string' } }` | A list of scalars (travels as is) or of records (an array of arrays) |
| Enum | `{ enum: ['admin', 'editor'] }` | One of the listed strings or numbers; travels as its index |
| Flags | `{ flags: ['read', 'write'] }` | An object of booleans; travels as one integer |
| Tuple | `['number', 'number']` | Fixed-length array of scalars; `[{ x: 'number' }, { y: 'number' }]` names them |
| Union | `{ union: [Call, Event], discriminator: 'type' }` | One of several structs, picked by an enum field they share; travels as `[tag, ...fields]` (see [Types](/guide/types#unions)) |
| Calculated | `total: (record) => …` | Ignored: a function has no position on the wire |

Arrays and enums take `required: false` next to the shorthand key:
`{ array: 'string', required: false }`. See [Types](/guide/types) for what each one looks like on
the wire and [Optional Fields](/guide/optional-fields) for the rules around `null`.

## Positions

Fields take positions in the order the keys appear in the definition, which is the order
`Object.keys` reports. Three rules keep that order safe:

- Integer-like keys (`'1'`, `'007'`) are rejected (`ERR_INTEGER_KEY`): JavaScript orders them
  first, whatever the source says.
- `__proto__` is rejected (`ERR_RESERVED_KEY`).
- A struct cannot start with a field named like a type (`string`, `array`, `enum`, `map`, …):
  metaschema reads such an object as a type shorthand, and a shared definition must mean the same
  thing in both libraries (`ERR_UNKNOWN_TYPE`).

metaschema's kind key is accepted and skipped: `{ Entity: {}, id: 'number' }` has one field.
Optional fields are best declared last: only the trailing run of optional fields can be left off
the wire (see [Optional Fields](/guide/optional-fields)).

## Constructors

```js
new Schema(name, definition, options?);
new Schema(definition, options?);
Schema.from(definition, options?);          // nameless
Schema.keys(['x', 'y'], options?);          // keys only: every field is json
```

A definition can also be a collection (`{ array: User }`), a tuple or a single scalar; a `Schema`
passed as the definition is compiled again with the new options.

## Schemas inside schemas

A `Schema` is a compiled codec. Used inside another definition, by value (`address: Address`) or
by name (`manager: '?User'`), it is called as it is: its own `validate`, `codegen`, `sparse` and
`layout` apply inside that slot, its code is not compiled a second time, and the options of the
outer schema apply only to the outer schema's own fields. The two spellings produce the same wire;
they differ only in the canonical form (`{…}` embedded against `@User`) and so in `id`.

```js
const Items = Schema.from({ array: { sku: 'string', qty: '?number' } }, { layout: 'flat' });
const Order = Schema.from({ id: 'number', items: Items });
Order.encode({ id: 1, items: [{ sku: 'A' }, { sku: 'B', qty: 2 }] });
// [1, ['A', null, 'B', 2]]  — the flat layout travels with Items
```

Only a root is different: a `Schema` passed as the whole definition is compiled again with the
options given there (`Schema.from(User, { sparse: true })`), and a root reference by name is an
alias of the referenced schema.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `codegen` | runtime | `true` requires generated code (throws `ERR_CODEGEN_UNAVAILABLE` where blocked), `false` forces closures. See [Runtimes](/guide/runtimes) |
| `validate` | `true` | Check types, required fields and enum values on encode and on decode. `false` trusts both the values and the wire; shapes and the array structure are always checked. See [Errors](/guide/errors#what-is-validated) |
| `sparse` | `false` | Encode the struct as `[mask, ...present values]`. See [Optional Fields](/guide/optional-fields#sparse-records) |
| `layout` | `'rows'` | For a collection of records: `'rows'`, `'flat'` or `'columns'`. See [Collections](/guide/collections) |
| `schemas` | `{}` | Schemas a field may reference by name |
| `fingerprint` | FNV-1a 32-bit | `(canonical) => string`, computes `id` from the canonical form. See [Schema Evolution](/guide/evolution#telling-versions-apart) |

Unknown options and wrong types throw `SchemaDefinitionError` with code `ERR_INVALID_OPTIONS`.

## Properties

| Property | Value |
| --- | --- |
| `name` | The name given to the constructor, or `''` |
| `definition` | The definition object, as given |
| `keys` | Field keys in wire order (frozen; empty for a collection, a tuple or a scalar) |
| `backend` | `'codegen'` or `'closures'` |
| `layout` | `'dense'` or `'sparse'` for a struct; `'rows'`, `'flat'` or `'columns'` for a collection |
| `id` | A fingerprint of the canonical form, see below |
| `list` | The schema of an array of these records, as rows; it reuses this schema's codec and name |

`toString()` returns the canonical form of the schema: every position with its type.

```js
User.toString();
// '{id:number,name:string,active:boolean,role:enum(admin|editor|viewer),address:{city:string,street:string,zip:?string},tags:[string],orders:[{sku:string,qty:number}],createdAt:date,perms:flags(read|write|admin),balance:?number=0,manager:?@User,email:?string}'
User.id; // 'cecbac56' — FNV-1a of that string, the same on both sides of the wire
```

Two definitions with the same positions, types and keys have the same `id`, whatever name the
schema was given. Renaming a key changes it, and so does the optionality of a root scalar
(`'?string'` prints as `?string`). The `fingerprint` option replaces the hash (see
[Schema Evolution](/guide/evolution#telling-versions-apart)).

## metaschema compatibility

A definition both libraries read means the same thing in both, or one of them refuses it.

| Construct | metaschema | protoarray |
| --- | --- | --- |
| scalars, structs, `?`, `required`, `default`, `{ array }`, `{ enum }`, tuples, references, the kind key | ✓ | ✓ |
| `{ union: [...], discriminator }` | ✓ | ✓, as `[tag, ...fields]` |
| `{ union: [...] }` without a discriminator | ✓ | `ERR_UNKNOWN_TYPE` |
| `{ type: 'number', decimals: 2 }` | ✓, kept as an unknown option (lint: `unknown-option`) | ✓, a scaled integer |
| `length`, `unique`, `validate` options | ✓ | accepted and ignored |
| `set`, `map`, `object`, `tuple` shorthands | ✓ | `ERR_UNKNOWN_TYPE` |
| `date` | ✓ | ✓, epoch milliseconds |
| `{ flags: [...] }` | not a metaschema type | ✓ |
