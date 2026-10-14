# Optional Fields

## Declaring

Three spellings, all equivalent:

```js
Schema.from({
  email: '?string',
  'nick?': 'string',
  phone: { type: 'string', required: false },
});
```

A field with a `default` is optional as well, and `json` fields are always optional. Everything
else is required.

## One rule for nullish values

On the way out, `undefined`, `null` and a missing key are the same thing: the slot holds `null`.
On the way back, `null` is what you get, and every key of the schema is present:

```js
const S = Schema.from({ a: '?string', b: '?string', c: 'number' });
S.encode({ a: undefined, b: null, c: 3 }); // [null, null, 3]
S.decode([null, null, 3]);                 // { a: null, b: null, c: 3 }
```

Decoded objects carry every key, in schema order, so all of them share one hidden class in V8
whatever was on the wire. That keeps property access in your own code monomorphic, which is the
single biggest factor in how fast the objects are to use. The trade-off is that
`decode(encode({ c: 3 }))` gives `{ a: null, b: null, c: 3 }`, not `{ c: 3 }`.

A required field that arrives as `null` or is missing throws `DecodeError` with code `required`
(unless `validate: false`).

## Trailing nulls are trimmed

A trailing run of `null` slots is left off the wire: `['Alex', null, null]` and `['Alex']` are the
same payload.

```js
const S = Schema.from({ name: 'string', email: '?string', age: '?number' });
S.encode({ name: 'Alex' }); // ['Alex']
S.decode(['Alex']);         // { name: 'Alex', email: null, age: null }
```

Only optional fields can be trimmed, so declare the ones most often missing **last**. A missing
optional field before a required one stays as `null`:

```js
Schema.from({ nick: '?string', id: 'number' }).encode({ id: 1 }); // [null, 1]
```

A nested struct whose fields are all missing is `[]`, not `null`; a missing struct is `null`.

## Sparse records

When a record has many optional fields and few of them set, `null`s cost more than keys would.
`{ sparse: true }` encodes the struct as a presence mask followed by the present values only:
bit *i* of the mask says whether field *i* is there.

```js
const S = Schema.from({ a: 'number', b: '?string', c: '?string', d: '?number' }, { sparse: true });
S.encode({ a: 1, d: 4 }); // [9, 1, 4]   — 9 is 0b1001: fields a and d
S.decode([9, 1, 4]);      // { a: 1, b: null, c: null, d: 4 }
```

On twenty optional fields with three set, a sparse record is 46 bytes where the dense form is 114
and keyed JSON is 86, and it decodes faster than either. A sparse struct takes up to 31 fields.
It can be nested in other schemas by value, and used as the record of a `rows` collection, but
not with the `flat` or `columns` layouts.

## Decoding strictly

Elements beyond the schema are ignored, which is what lets an older decoder read a newer payload.
Pass `{ strict: true }` to reject them instead:

```js
Schema.from({ id: 'number' }).decode([1, 'future'], { strict: true });
// DecodeError: Value has extra elements
```
