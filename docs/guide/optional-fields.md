# Optional Fields

## Declaring

A field is optional the way metaschema says it is
([schema syntax](https://metaschema.vercel.app/guide/schema-syntax#fields)). The spellings below
travel the same way:

```js
const { Schema } = require('@alexify/protoarray');
const metaschema = require('@alexify/metaschema');

Schema.from(
  {
    email: '?string',
    'nick?': 'string',
    phone: { type: 'string', required: false },
    parent: { type: 'string', nullable: true },
  },
  { metaschema },
);
```

A `nullable` field (the key required, the value may be `null`) can hold `null`, so it is optional
on the wire. A field with a `default` is optional as well, and `json`, `any` and `unknown` fields
are always optional. Everything else is required.

## One rule for nullish values

On the way out, `undefined`, `null` and a missing key are the same thing: the slot holds `null`.
On the way back, `null` is what you get, and every key of the schema is present:

```js
const S = Schema.from({ a: '?string', b: '?string', c: 'number' }, { metaschema });
S.encode({ a: undefined, b: null, c: 3 }); // [null, null, 3]
S.decode([null, null, 3]);                 // { a: null, b: null, c: 3 }
```

Decoded objects carry every key, in schema order, so all of them share one hidden class in V8
whatever was on the wire. That keeps property access in your own code monomorphic, which is the
single biggest factor in how fast the objects are to use. The trade-off is that
`decode(encode({ c: 3 }))` gives `{ a: null, b: null, c: 3 }`, not `{ c: 3 }`. metaschema's
`check` accepts `null` for an optional field, so a decoded object validates.

A required field that arrives as `null` or is missing throws `DecodeError` with code `required`
(unless `validate: false`). `encode` does not check that a required field is there: it writes
`null` in its place, and metaschema's `check` is what catches it on the sender.

## Trailing nulls are trimmed

A trailing run of `null` slots is left off the wire: `['Alex', null, null]` and `['Alex']` are the
same payload.

```js
const S = Schema.from({ name: 'string', email: '?string', age: '?number' }, { metaschema });
S.encode({ name: 'Alex' }); // ['Alex']
S.decode(['Alex']);         // { name: 'Alex', email: null, age: null }
```

Only optional fields can be trimmed, so declare the ones most often missing **last**. A missing
optional field before a required one stays as `null`:

```js
Schema.from({ nick: '?string', id: 'number' }, { metaschema }).encode({ id: 1 }); // [null, 1]
```

A nested struct whose fields are all missing is `[]`, not `null`; a missing struct is `null`. The
id field a stored kind adds (`userId`) is optional and comes last, so it costs nothing while it is
not set.

## Sparse records

When a record has many optional fields and few of them set, `null`s cost more than keys would.
`{ sparse: true }` encodes the root struct as a presence mask followed by the present values only:
bit *i* of the mask says whether field *i* is there.

```js
const S = Schema.from({ a: 'number', b: '?string', c: '?string', d: '?number' }, { metaschema, sparse: true });
S.encode({ a: 1, d: 4 }); // [9, 1, 4]   — 9 is 0b1001: fields a and d
S.decode([9, 1, 4]);      // { a: 1, b: null, c: null, d: 4 }
```

`sparse` also takes the paths of structs inside the record, `{ sparse: ['profile'] }`, and an
entity reached by a reference takes it from `entities`: `{ entities: { Profile: { sparse: true }
} }`. On twenty optional fields with three set, a sparse record is 46 bytes where the dense form is
114 and keyed JSON is 86, and it decodes faster than either. A sparse struct can be the record of a
`rows` collection, but not of the `flat` or `columns` layouts.

A mask holds 31 fields. A wider record takes one segment per 31 fields, each a mask followed by
its present values, and trailing segments with nothing in them are left off:

```js
// 40 optional fields, f0, f3 and f35 set:
S.encode(value); // [9, 1, 2, 16, 3]  — 9 marks f0 and f3, 16 marks f35 (bit 4 of fields 31–61)
// only f3 set:   [8, 2]              — the second segment is empty, so it is not written
```

Up to 31 fields that is exactly the one-mask form, so a record can grow past 31 fields without
breaking older decoders: they read the first segment and ignore the rest (`{ strict: true }`
rejects it as `extra`). Past the first segment, an element where a segment starts must be a
mask.

## Decoding strictly

Elements beyond the schema are ignored, which is what lets an older decoder read a newer payload.
Pass `{ strict: true }` to reject them instead:

```js
Schema.from({ id: 'number' }, { metaschema }).decode([1, 'future'], { strict: true });
// DecodeError: Value has extra elements
```
