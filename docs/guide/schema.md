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
| Struct | `{ city: 'string', zip: '?string' }` | A nested record, encoded as a nested array |
| Schema by value | `address: Address` | The other schema's fields, embedded |
| Schema by name | `manager: '?User'` | A capitalised name: the schema's own name (recursion) or one from `options.schemas` |
| Array | `{ array: 'string' }`, `{ array: { sku: 'string' } }` | A list of scalars (travels as is) or of records (an array of arrays) |
| Enum | `{ enum: ['admin', 'editor'] }` | One of the listed strings or numbers; travels as its index |
| Flags | `{ flags: ['read', 'write'] }` | An object of booleans; travels as one integer |
| Tuple | `['number', 'number']` | Fixed-length array of scalars; `[{ x: 'number' }, { y: 'number' }]` names them |
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

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `codegen` | runtime | `true` requires generated code (throws `ERR_CODEGEN_UNAVAILABLE` where blocked), `false` forces closures. See [Runtimes](/guide/runtimes) |
| `validate` | `true` | Check types, required fields and enum ranges on decode. `false` trusts the wire; the array structure is always checked |
| `sparse` | `false` | Encode the struct as `[mask, ...present values]`. See [Optional Fields](/guide/optional-fields#sparse-records) |
| `layout` | `'rows'` | For a collection of records: `'rows'`, `'flat'` or `'columns'`. See [Collections](/guide/collections) |
| `schemas` | `{}` | Schemas a field may reference by name |

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
| `list` | The schema of an array of these records, as rows |

`toString()` returns the canonical form of the schema: every position with its type.

```js
User.toString();
// '{id:number,name:string,active:boolean,role:enum(admin|editor|viewer),address:{city:string,street:string,zip:?string},tags:[string],orders:[{sku:string,qty:number}],createdAt:date,perms:flags(read|write|admin),balance:?number=0,manager:?@User,email:?string}'
User.id; // 'cecbac56' — FNV-1a of that string, the same on both sides of the wire
```

Two definitions with the same positions, types and keys have the same `id`, whatever name the
schema was given. Renaming a key changes it (see [Schema Evolution](/guide/evolution)).

## Not in protoarray

metaschema's `set`, `map`, `object` and `tuple` shorthands have no positional form yet and throw
`ERR_UNKNOWN_TYPE`; its `length`, `unique` and `validate` options are accepted and ignored. The
two types protoarray adds, `date` and `flags`, are not metaschema types.
