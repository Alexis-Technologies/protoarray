# Why protoarray?

protoarray is schema-based serialization that stays JSON: the discipline of Protocol Buffers
(a shared schema, positions instead of names, rules for evolving it) over the transport every
JavaScript program already has.

## The idea

A JSON payload repeats every key in every message:

```js
JSON.stringify({ name: 'Alex', age: 27 });
// '{"name":"Alex","age":27}'  (24 bytes)
```

When the client and the server already agree on the shape, the keys carry no information. protoarray
sends only the values, in a fixed order:

```js
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');

const User = Schema.from(new Definition('User', { name: 'string', age: 'number' }));
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

- **Smaller payloads.** About half the bytes of JSON on a typical record before compression.
  After gzip or brotli the difference depends on the message size: around 35% for a single small
  message, 5–10% for a list of a thousand records (compression already shortens repeated keys),
  and 27% with the [`columns` layout](/guide/collections#columns), the ids written as differences
  and the repeated strings interned. The gain is largest exactly where transport compression is
  absent or weak: small messages, WebSocket frames, `localStorage`, logs.
- **Faster, not slower.** A positional array is less work for `JSON.parse` and `JSON.stringify`,
  and the conversion between objects and arrays is generated code that costs tens of nanoseconds.
  End to end, on a record with ten fields, a nested address, tags and two orders: ×1.5 faster to
  encode and ×1.8 faster to decode than `JSON.stringify`/`JSON.parse` of the keyed object. Where
  a channel carries bytes, the [binary wire](/guide/binary) of the same schema is ×1.6 and ×2.1
  on that record and six times the round trip of the text wire on 32 doubles, the fastest round
  trip of every library measured on all seven payloads. See [Benchmarks](/guide/benchmarks).
- **Typed, validated, evolvable.** The schema is a [metaschema](https://metaschema.vercel.app/)
  definition, which validates the values a program sends; protoarray checks the wire on decode,
  reports problems with a path, and lets you add fields without breaking older peers. Dates,
  BigInts, bytes, sets and maps come back as what they were. JSON alone gives you none of that.
- **Same transport.** The result is JSON, so it goes through HTTP, WebSocket, message brokers and
  storage that already handle JSON, and compresses the same way.

## Compared with Protocol Buffers, Avro and MessagePack

- **No toolchain.** No `.proto` or `.avsc` files, no compiler, no generated files to commit. A
  schema is a [metaschema](https://metaschema.vercel.app/) definition, a plain JavaScript value
  that also validates, generates TypeScript and describes a domain model; its snapshot is plain
  JSON that a server can hand to its clients at runtime. Code generation is there when you want
  it: `protoarray compile` writes standalone modules for runtimes without eval.
- **Fast in JavaScript on real payloads.** Binary codecs written in JavaScript encode and decode
  strings byte by byte; `JSON.parse` and `JSON.stringify` are native. On records, strings and
  tagged messages protoarray encodes faster than protobufjs, protobuf-es, avsc, msgpackr and
  cbor-x, and decodes faster than every one of them on long strings. Two honest exceptions:
  payloads that are mostly numbers (a double prints as up to 17 characters, binary stores 8
  bytes), and msgpackr with shared record structures, which decodes records faster than
  `JSON.parse` can read them (avsc, cbor-x and protobufjs do too on some shapes). Where a
  channel carries bytes, [the binary wire](/guide/binary) (`@alexify/protoarray/binary`) puts the
  same schema on bytes and takes the numeric payloads too.
- **Readable on the wire.** The payload can be logged, inspected and edited as is, and travels
  over channels that only carry text without base64.
- **Schema evolution with the same discipline.** Positions are append-only, like protobuf field
  numbers; decoders tolerate extra and missing trailing fields. Like Avro, a reader can
  [resolve](/guide/resolve) an older writer's payload into its own shape, with renames, defaults
  and widened types, and a [registry](/guide/resolve#the-registry) tags each payload with the id
  of its schema.
- **No dependencies, about 22 KB.** Both backends, the wire checks and every type in about 22 KB
  min+gzip, the registry, resolve, streaming and standalone extras in subpaths of their own.
  protoarray does not require metaschema: a client that builds its schemas from snapshots carries
  protoarray alone, and a standalone module of one schema with its own runtime is a few KB. See
  the [bundle sizes](/guide/benchmarks#bundle-size) of the alternatives.

[Compared with alternatives](/guide/comparison) puts protoarray next to twenty-two other
serialization libraries, feature by feature.

## When not to use it

- The other side is not JavaScript and already speaks protobuf or Avro: protoarray's wire is
  specified, but JavaScript is its only implementation.
- The payload is dense numeric data (sensor readings, vectors) and the channel carries text: the
  [binary wire](/guide/binary) needs a channel that carries bytes, and base64 would eat its gain;
  a typed array in a binary frame is the right tool there.
- You need to read one field of a large message without decoding the rest: FlatBuffers and
  Cap'n Proto read in place.
- The data has no fixed shape at all: `json` fields pass anything through, but a schema with
  one `json` field is just JSON.
