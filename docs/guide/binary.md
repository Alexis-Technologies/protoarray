# The Binary Wire

protoarray's wire is JSON text: a positional array the engines print and parse natively, which is
what makes it fast on records, strings and tagged messages, readable in logs and at home on any
channel that carries JSON. Where a channel carries bytes and the payload is numbers, booleans,
enums and dates, text is the slower form: a double prints as up to 17 characters where 8 bytes
would do, and every value is parsed back from decimal text. `@alexify/protoarray/binary` puts the
same schema on a binary wire. Nothing about the schema changes: the same plan is compiled a second
time, into a writer and a reader of bytes, with the same checks on decode and the same errors.

```js
import { Schema } from '@alexify/protoarray';
import { toBinary, fromBinary } from '@alexify/protoarray/binary';
import { Schema as Definition } from '@alexify/metaschema';

const Reading = Schema.from(
  new Definition('Reading', { sensor: 'string', at: 'date', values: { array: 'number' } }),
);

const bytes = toBinary(Reading, { sensor: 'a1', at: new Date(), values: [20.5, 20.7, 21.1] });
// Uint8Array(…): the header, 'a1', the timestamp as a varint, three float64s
fromBinary(Reading, bytes);
// { sensor: 'a1', at: 2026-10-19T…, values: [20.5, 20.7, 21.1] }
```

`toBinary` gives a `Uint8Array` of its own, `fromBinary` takes one (a Node.js `Buffer` is one).
The codec is compiled from the schema's plan on first use and kept on the schema, by the backend
the schema runs: generated code, or closures where the runtime has none (see
[Runtimes](/guide/runtimes)). `register()` installs the two as methods:

```js
import { register } from '@alexify/protoarray/binary';

register(); // once per process
Reading.toBinary(value);
Reading.fromBinary(bytes);
Reading.list.toBinary([value, value]); // the rows of a list, through the same codec
```

## When to use it

The choice is the channel's and the payload's, not a question of which wire is "faster": over a
round trip the binary wire is ahead of the text wire on every payload of the
[comparison](/guide/benchmarks#the-binary-wire-measured) except long strings, and ahead of the
binary codecs written in JavaScript on most, at fewer bytes before compression. What the text wire
keeps is everything that makes it JSON.

- **Text** when the payload has to be readable (logs, a debugger, a REST client), travels over a
  channel that carries text (a JSON API, a WebSocket text frame, NDJSON, `localStorage`, a
  JSON-RPC envelope), is read by a side that only has JSON and the schema, or streams: the
  [registry](/guide/resolve#the-registry), [resolve](/guide/resolve) and
  [streaming](/guide/streaming) are the text wire's.
  Through a text channel the bytes would need base64, which costs a third more and the time to
  write and read it, and after gzip or brotli the two wires are close in size (on a list of
  records the text wire is even smaller).
- **Binary** when the channel carries bytes (a WebSocket binary frame, `fetch` with an
  `ArrayBuffer`, a file, an IPC pipe) and the payload is numeric, or many short records a second:
  32 doubles are 260 bytes against 582 of text and six times the round trip; a record of enums,
  booleans and dates 26 bytes against 36.
- **In a browser** the text wire leans on the engine's native `JSON.parse`, while the binary
  wire's strings go through `TextDecoder`; on records of strings the text wire stays ahead or
  level there, and the binary wire wins on numbers. The numbers of the comparison are Node's,
  where strings go through `Buffer`, as protobufjs and avsc do.

## The wire

The normative table is in [Wire Format](/guide/wire-format#the-binary-wire). In short, little-endian:

- a **record** is a header bitset (a presence bit per field, then the value of every boolean
  field) in whole bytes, and its present fields in declaration order; a `sparse` record is no
  different, since every record has a header;
- a **union** is its tag (a byte, a varint past 256 values) and the branch's record without the
  discriminator;
- a **collection** is its count, a presence bitmap when its items may be `null`, and its items; a
  map its entries, a dictionary its keys and values, a tuple a bitmap and its elements;
- a **`number`** is a float64; an `integer`, a `date` (milliseconds) and a `decimals` number
  (scaled) are zigzag varints; an enum index is a byte (a varint past 256 values); a flags mask one
  varint per 31 names; a boolean outside a record a byte;
- a **string** travels behind its byte length, doubled, whose low bit says its form: UTF-8 for
  one of up to 21 characters, UTF-16 for a longer one, copied rather than transcoded, which is what
  keeps long strings within reach of the text wire; a lone surrogate is kept, as JSON keeps it;
  `bytes` travel as they are behind their length, a `bigint` as its decimal digits, `json` as its
  text; `null` writes nothing.

## Both sides need the schema

Positions, header bits and tags are the schema's, so the reader needs the writer's schema, as an
Avro reader needs the writer's. There is no trimming of trailing optionals and no tolerance of
extra elements: a message of another version of the schema is a `DecodeError` (or garbage without
validation), not a partially understood one. Hand the snapshot to the other side, or agree on it
through `schema.id` in a handshake (see [Schema Evolution](/guide/evolution#telling-versions-apart)).
Reading another version through `resolve`, and the `[id, payload]` envelope of the registry, are
the text wire's in this release.

## Validation and errors

Decode checks the wire as the text wire does, behind the schema's `validate` option (`true` by
default): the bounds of every read (a truncated message is a `DecodeError` `structure`), the
range of an enum index, the fit of a bitmap, a string or a count, a required field's presence
(`required`), a date within its range (`type`); a union's tag is checked whatever `validate`
says. Errors carry the schema's name and a path, as `decode` writes them: `orders[1].sku`.

Encode trusts its values, as `encode` does (checking them is metaschema's), and throws
`EncodeError` only for what has no form on the wire: `null` at the root (`required`), a record
that is not an object, a collection that is not an array, a `Set` or a `Map` (`object`, `array`,
`set`, `map`), a `null` item of a list of required items (`type`), a union value outside the
union (`union`), a `decimals` number past the safe integers (`type`), and, unlike the text wire,
which carries anything as it is, a string slot that does not hold a string or a `bytes` slot that
does not hold a `Uint8Array` (`type`). A value JSON has no text for in a `json` slot (a function)
travels as `null`, as on the text wire.

## What has no binary form

The options that shape the text wire shape text: an interned string (`intern`), a list or a
column of differences (`delta`), the `flat` and `columns` layouts (a collection nested with a
layout of its own included) and a schema from `resolve`. `toBinary` and `fromBinary` of such a
schema throw `SchemaDefinitionError` with code `ERR_NO_BINARY_FORM`, naming the place by its path:

```js
const Users = Schema.from(definition, { metaschema, layout: 'columns', intern: ['[].city'] });
toBinary(Users, users);
// SchemaDefinitionError [ERR_NO_BINARY_FORM]: The binary wire has no form for the columns layout
```

Numbers need no `delta` on this wire, booleans and small enums are already bits and bytes, and a
`number` is eight bytes whatever its value.

## Backends, runtimes and size

The binary codec follows `schema.backend`: generated code where the schema has it, closures
elsewhere, both writing the same bytes (the test suite holds them to each other on random
schemas, as it does the text backends). Under a strict CSP the closures are what runs, unless a
[standalone module](/guide/standalone#the-binary-wire) written with `--binary` brings the
generated codec along: an import module's schemas then carry it for `toBinary` and `fromBinary`,
an inline module's have the two as methods of their own. In Node.js the strings go through
`Buffer`'s own UTF-8 and UTF-16, in a browser through `TextDecoder` and a loop, by the same
runtime twin that handles base64. The subpath adds about 7.7 KB min+gzip to a bundle that uses
it; the core is unchanged.
