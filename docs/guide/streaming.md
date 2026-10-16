# Streaming

A payload does not have to arrive or leave in one piece. protoarray streams in three ways, none of
which needs a Node.js builtin: iterables of values, NDJSON (one payload per line) and the items of
one large JSON array.

## encodeEach and decodeEach

`schema.encodeEach(values)` and `schema.decodeEach(arrays, options?)` convert an iterable lazily,
one value at a time: a generator for an iterable, an async generator for an async one (a Node.js
stream, a database cursor).

```js
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');

const User = Schema.from(new Definition('User', { id: 'integer', name: '?string' }));

[...User.encodeEach([{ id: 1 }, { id: 2, name: 'Bo' }])]; // [[1], [2, 'Bo']]

for await (const user of User.decodeEach(cursor)) handle(user);
```

An error names the index of its value: `Field "[3].id" is required`. Something that is not
iterable (a string counts as a mistake) is an `EncodeError` `iterable` or a `DecodeError`
`structure`. `encodeEach` and `decodeEach` are also functions: `encodeEach(schema, values)`.

## The stream subpath

`@alexify/protoarray/stream` has the rest, as functions that take the schema first. Its sources are
a string, an iterable or async iterable of strings or `Uint8Array`s (UTF-8), or a `ReadableStream`
of them, read through its reader, so a `fetch` body works in every browser:

```js
const { parseLines, parseItems } = require('@alexify/protoarray/stream');

const response = await fetch('/users.ndjson');
for await (const user of parseLines(User, response.body)) handle(user);
```

Chunks may cut a line, a string, an escape or a multi-byte character anywhere. Invalid UTF-8 is a
`DecodeError` `json`, not a replacement character.

### NDJSON

| Function | Does |
| --- | --- |
| `stringifyLines(schema, values)` | the payload of each value and `\n`: a generator, or an async one over an async iterable |
| `parseLines(schema, source, options?)` | the values of NDJSON text, as an async generator; `\r\n` ends a line too and blank lines are skipped |
| `stringifyStream(schema)` | the same as a `TransformStream`: values in, lines out |
| `parseStream(schema, options?)` | a `TransformStream`: text or bytes in, values out |

```js
[...stringifyLines(User, [{ id: 1 }, { id: 2, name: 'Bo' }])]; // ['[1]\n', '[2,"Bo"]\n']

const values = response.body.pipeThrough(parseStream(User));
```

A line that is not JSON is a `DecodeError` `json`, one that does not match the schema the error
its decode throws; either names the index of the value (`[1].id`). A `TransformStream` errors with
it.

### The items of a large array

`stringifyItems(collection, values)` writes the JSON array of a collection a piece at a time, and
`parseItems(collection, source, options?)` reads one item by item while its text arrives, so
neither holds the whole payload. The collection is a schema of rows or `flat` records, such as
`User.list`:

```js
[...stringifyItems(User.list, [{ id: 1 }, { id: 2 }])]; // ['[', '[1]', ',[2]', ']']

for await (const user of parseItems(User.list, response.body)) handle(user);
```

The text is the text of `stringify`, and the items are what `parse` would return, with the
collection's rules: a `null` item where items are required is a `type` error, a `flat` collection
gathers each record's slots. A scanner finds where each item ends, outside strings and nested
values, and hands it to `JSON.parse`; a malformed array is a `DecodeError` `json` naming the item.
On the thousand records of the benchmark it reads about half as fast as parsing the whole text at
once, which is the price of holding one item instead of the payload. A `columns` collection and an
interned one have no items that stand on their own (each needs the whole payload), and are refused
with `ERR_INVALID_OPTIONS`.

### Methods on Schema

`register()` installs the six functions as methods of `Schema`, once per process:

```js
require('@alexify/protoarray/stream').register();

for await (const user of User.parseLines(source)) handle(user);
```

The subpath is kept out of the core bundle, so a program that does not stream does not carry it.
