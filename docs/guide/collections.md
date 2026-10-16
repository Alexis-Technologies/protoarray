# Collections and Layouts

The examples build schemas from a definition with metaschema injected (`const metaschema =
require('@alexify/metaschema')`); a metaschema `Schema` or a snapshot builds the same ones (see
[Defining a Schema](/guide/schema#sources)).

## Arrays of scalars

An array of scalars travels as it is, by reference, with each element checked on decode:

```js
const S = Schema.from({ tags: { array: 'string' } }, { metaschema });
S.encode({ tags: ['admin', 'editor'] }); // [['admin', 'editor']]
```

Elements are required unless the item type says otherwise: `{ array: '?number' }` keeps `null`
slots. Converted types apply per element: `{ array: 'date' }` is an array of timestamps,
`{ array: { enum: [...] } }` an array of indexes. A list of integers can travel as differences
(`{ delta: ['ids'] }`, see [Types](/guide/types#delta)); a `Set`, a `Map` and a dictionary have
types of their own (see [Types](/guide/types#sets-maps-and-dictionaries)).

## Arrays of records

An array of records is an array of arrays, each row trimmed on its own:

```js
const S = Schema.from({ orders: { array: { sku: 'string', qty: '?number' } } }, { metaschema });
S.encode({ orders: [{ sku: 'A-1', qty: 2 }, { sku: 'B-7' }] });
// [[['A-1', 2], ['B-7']]]
S.decode([[['A-1', 2], ['B-7']]]);
// { orders: [{ sku: 'A-1', qty: 2 }, { sku: 'B-7', qty: null }] }
```

A `null` element decodes only where the item is optional (`{ array: '?json' }`, or a reference
with `?`); otherwise it fails with code `type`. A list of references, `{ many: 'Order' }` or
`{ array: 'Order' }`, is an array of records or of ids, as the reference travels (see
[References](/guide/schema#references)).

## A list of a schema

`schema.list` is the collection of that schema's records as rows, built once over the codec the
schema already has and carrying its name:

```js
const User = Schema.from({ id: 'number', name: '?string' }, { metaschema });
User.list.encode([{ id: 1 }, { id: 2, name: 'x' }]); // [[1], [2, 'x']]
User.list.decode([[1], [2, 'x']]);                   // [{ id: 1, name: null }, { id: 2, name: 'x' }]
```

Error paths in a collection start with the index: `[1].name`. A list that is not an array fails to
encode with `EncodeError` code `array`, an element that is not an object with code `object` at
`[i]`.

## Layouts

A collection of records can take one of three layouts:

| Layout | Wire | Use it for |
| --- | --- | --- |
| `rows` (default) | `[[1, 'a'], [2, 'b']]` | Everything: streams one record per line (NDJSON) or one item at a time (see [Streaming](/guide/streaming)), batches |
| `flat` | `[1, 'a', 2, 'b']` | Many short records; fewer brackets and allocations, one array to parse |
| `columns` | `[[1, 2], ['a', 'b']]` | Bulk endpoints: compresses best, since each column is a run of similar values |

The `layout` option gives the layout of the root collection:

```js
const Users = Schema.from({ array: { a: 'number', b: '?string' } }, { metaschema, layout: 'columns' });
Users.encode([{ a: 1 }, { a: 2, b: 'x' }]); // [[1, 2], [null, 'x']]
Users.decode([[1, 2], [null, 'x']]);        // [{ a: 1, b: null }, { a: 2, b: 'x' }]
```

### A collection inside a record

`layout` also takes an object of paths, for the collections inside a record. Such a collection is
compiled as a codec of its own and travels in its slot:

```js
const Order = Schema.from(
  { id: 'number', items: { array: { sku: 'string', qty: '?number' } } },
  { metaschema, layout: { items: 'flat' } },
);
Order.encode({ id: 1, items: [{ sku: 'A' }, { sku: 'B', qty: 2 }] });
// [1, ['A', null, 'B', 2]]
Order.toString(); // '{id:number,items:flat[{sku:string,qty:?number}]}'
```

The path names a collection whose item is a record written in place: `{ array: { … } }`,
`orders[].lines` for one nested deeper, `''` for the root (the same as `layout: 'flat'`). A list of
references takes the layout of its entity's own, so `{ array: 'Order' }` is always rows. A
`layout` that names anything but a collection of records, or a sparse record, is
`ERR_INVALID_OPTIONS`.

### flat

Rows have a fixed width, so nothing is trimmed. A `null` record has no row of its own: it travels
as a run of `null`s. A length that is not a multiple of the width fails with code `structure`.
Adding a field changes the width, so `flat` suits closed systems that deploy both sides together.

### columns

Each column is an array of the record's values for one field. On a thousand records of a typical
shape, `columns` is 18–21% smaller than keyed JSON after gzip, brotli or zstd, where rows are
5–10% smaller: compressors love a run of similar values. New columns are appended at the end and
ignored by older decoders; a missing column (an older sender) or an explicit `null` in its place
decodes as `null`s, and the record count comes from the first column present. An error about a
column names it by its field, for every record (`Field "[].city" has a wrong length`), one about a
value by its record (`[2].city`).

Two opt-in options shrink columns further: `delta` writes an integer, date or decimals column as
its first value and the differences between neighbours, and `intern` writes a string column of few
distinct values as indexes into one table of the message's strings (see
[Types](/guide/types#interned-strings)). Both name the fields of the record by path, `[].id` for
the root collection:

```js
const Events = Schema.from(
  { array: { id: 'integer', at: 'date', city: 'string' } },
  { metaschema, layout: 'columns', delta: ['[].id', '[].at'], intern: ['[].city'] },
);
Events.encode([
  { id: 100, at: new Date(1700000000000), city: 'Kyiv' },
  { id: 101, at: new Date(1700000060000), city: 'Lviv' },
  { id: 103, at: new Date(1700000120000), city: 'Kyiv' },
]);
// [['Kyiv', 'Lviv'], [[100, 1, 2], [1700000000000, 60000, 60000], [0, 1, 0]]]
```

On the thousand records of the benchmark, a delta id and interned cities and tags take columns
another 17% smaller before compression and 6–10% after it, and encode and decode faster. Neither
`flat` nor `columns` takes a sparse record or a union.
