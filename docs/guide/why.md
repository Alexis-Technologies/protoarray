# Why protoarray?

## The idea

A JSON payload repeats every key in every message:

```js
JSON.stringify({ name: 'Alex', age: 27 });
// '{"name":"Alex","age":27}'  (24 bytes)
```

When the client and the server already agree on the shape, the keys carry no information. protoarray
sends only the values, in a fixed order:

```js
const User = Schema.from({ name: 'string', age: 'number' });
User.stringify({ name: 'Alex', age: 27 });
// '["Alex",27]'  (11 bytes)
```

The schema both sides share records that position `0` is `name` and position `1` is `age`, so the
receiver turns the array back into the object it describes:

```js
User.parse('["Alex",27]');
// { name: 'Alex', age: 27 }
```

That is the whole format: one field per position, nested records as nested arrays, and a few
typed conversions (an enum travels as its index, a date as epoch milliseconds) that keep the array
small. The payload is still plain JSON.

## Compared with JSON

- **Smaller payloads.** About 45% fewer bytes on a typical record before compression. After gzip
  or brotli the difference depends on the message size: around 35% for a single small message,
  5–10% for a list of a thousand records (compression already shortens repeated keys), and about
  20% again with the [`columns` layout](/guide/collections#columns). The gain is largest exactly
  where transport compression is absent or weak: small messages, WebSocket frames,
  `localStorage`, logs.
- **Faster, not slower.** A positional array is less work for `JSON.parse` and `JSON.stringify`,
  and the conversion between objects and arrays is generated code that costs tens of nanoseconds.
  End to end, on a record with ten fields, a nested address, tags and two orders: ×1.5 faster to
  encode and ×1.7 faster to decode than `JSON.stringify`/`JSON.parse` of the keyed object. See
  [Benchmarks](/guide/benchmarks).
- **Typed, validated, evolvable.** The schema checks the wire on decode, reports problems with a
  path, and lets you add fields without breaking older peers. JSON alone gives you none of that.
- **Same transport.** The result is JSON, so it goes through HTTP, WebSocket, message brokers and
  storage that already handle JSON, and compresses the same way.

## Compared with Protocol Buffers and MessagePack

- **No toolchain.** No `.proto` files, no compiler, no generated files to commit. A schema is a
  plain JavaScript value, in the same DSL as [`@alexify/metaschema`](https://metaschema.vercel.app/).
- **No dependencies, 7 KB.** protobufjs is over 20 KB min+gzip, msgpackr about 10 KB.
- **Readable on the wire.** The payload can be logged, inspected and edited as is.
- **Faster in JavaScript on real payloads.** Binary codecs written in JavaScript decode strings
  byte by byte; `JSON.parse` is native. On records and strings protoarray is ahead of protobufjs,
  msgpackr, @msgpack/msgpack and cbor-x. Two honest exceptions: payloads that are mostly numbers
  (a double prints as up to 17 characters, binary stores 8 bytes) and msgpackr with shared record
  structures, which decodes small records faster than `JSON.parse` can read them.
- **Schema evolution with the same discipline.** Positions are append-only, like protobuf field
  numbers; decoders tolerate extra and missing trailing fields.

## When not to use it

- The other side is not JavaScript and already speaks protobuf or Avro.
- The payload is dense numeric data (sensor readings, vectors): a typed array in a binary frame is
  the right tool.
- The data has no fixed shape at all: `'json'` fields pass anything through, but a schema with
  one `json` field is just JSON.
