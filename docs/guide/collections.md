# Collections and Layouts

## Arrays of scalars

An array of scalars travels as it is, by reference, with each element checked on decode:

```js
const S = Schema.from({ tags: { array: 'string' } });
S.encode({ tags: ['admin', 'editor'] }); // [['admin', 'editor']]
```

Elements are required unless the item type says otherwise: `{ array: '?number' }` keeps `null`
slots. Converted types apply per element: `{ array: 'date' }` is an array of timestamps,
`{ array: { enum: [...] } }` an array of indexes.

## Arrays of records

An array of records is an array of arrays, each row trimmed on its own:

```js
const S = Schema.from({ orders: { array: { sku: 'string', qty: '?number' } } });
S.encode({ orders: [{ sku: 'A-1', qty: 2 }, { sku: 'B-7' }] });
// [[['A-1', 2], ['B-7']]]
S.decode([[['A-1', 2], ['B-7']]]);
// { orders: [{ sku: 'A-1', qty: 2 }, { sku: 'B-7', qty: null }] }
```

A `null` element is only allowed when the item is optional (`{ array: { type: 'json', required:
false } }`, or a schema name with `?`); otherwise it fails with code `type`.

## A list of a schema

`schema.list` is the collection of that schema's records as rows, `Schema.from({ array: schema })`:

```js
const User = Schema.from({ id: 'number', name: '?string' });
User.list.encode([{ id: 1 }, { id: 2, name: 'x' }]); // [[1], [2, 'x']]
User.list.decode([[1], [2, 'x']]);                   // [{ id: 1, name: null }, { id: 2, name: 'x' }]
```

Error paths in a collection start with the index: `[1].name`.

## Layouts

A collection of records at the root of a schema can take one of three layouts:

| Layout | Wire | Use it for |
| --- | --- | --- |
| `rows` (default) | `[[1, 'a'], [2, 'b']]` | Everything: streams one record per line (NDJSON), partial decoding, batches |
| `flat` | `[1, 'a', 2, 'b']` | Many short records; fewer brackets and allocations, one array to parse |
| `columns` | `[[1, 2], ['a', 'b']]` | Bulk endpoints: compresses best, since each column is a run of similar values |

```js
const Users = Schema.from({ array: { a: 'number', b: '?string' } }, { layout: 'columns' });
Users.encode([{ a: 1 }, { a: 2, b: 'x' }]); // [[1, 2], [null, 'x']]
Users.decode([[1, 2], [null, 'x']]);        // [{ a: 1, b: null }, { a: 2, b: 'x' }]
```

### flat

Rows have a fixed width, so nothing is trimmed and a `null` record becomes a run of `null`s;
a length that is not a multiple of the width fails with code `structure`. Adding a field changes
the width, so `flat` suits closed systems that deploy both sides together.

### columns

Each column is an array of the record's values for one field. On a thousand records of a typical
shape, `columns` is 18–21% smaller than keyed JSON after gzip, brotli or zstd, where rows are
5–10% smaller: compressors love a run of similar values. New columns are appended at the end and
ignored by older decoders; a missing column (an older sender) decodes as `null`s.

Layouts apply to the root collection only; arrays of records inside a record are always rows.
Neither `flat` nor `columns` takes a sparse record.
