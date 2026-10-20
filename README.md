# protoarray

[![npm](https://img.shields.io/npm/v/%40alexify%2Fprotoarray)](https://www.npmjs.com/package/@alexify/protoarray)
[![CI](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fprotoarray)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-protoarray)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://protoarray.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fprotoarray)](./LICENSE)

**Schema-based serialization that stays JSON.** Send objects as positional arrays and let a
schema shared by the client and the server map every position back to its key: the discipline of
Protocol Buffers over the transport every JavaScript program already has. A fast, zero-dependency
library for Node.js and browsers: about half the bytes of JSON, faster than JSON, and still JSON.
Schemas are [`@alexify/metaschema`](https://metaschema.vercel.app/)'s: one definition validates
with metaschema and travels with protoarray.

```js
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');

const User = Schema.from(
  new Definition('User', {
    id: 'number',
    name: 'string',
    role: { enum: ['admin', 'editor', 'viewer'] },
    address: { city: 'string', zip: '?string' },
    tags: { array: 'string' },
    email: '?string',
  }),
);

User.encode({ id: 1, name: 'Alex', role: 'editor', address: { city: 'Kyiv' }, tags: ['a'] });
// [1, 'Alex', 1, ['Kyiv'], ['a']]

User.decode([1, 'Alex', 1, ['Kyiv'], ['a']]);
// { id: 1, name: 'Alex', role: 'editor', address: { city: 'Kyiv', zip: null }, tags: ['a'], email: null }

User.stringify(user); // '[1,"Alex",1,["Kyiv"],["a"]]'  — JSON.stringify of the array
User.parse(text);     // the object back, the wire checked
```

Both sides share the schema, so the keys never travel: position `0` is `id`, position `1` is
`name`, and so on. The enum travels as its index, missing optional fields as `null`, and trailing
`null`s are trimmed.

The client does not need metaschema at all. A schema's snapshot is plain JSON, and protoarray
builds the same schema from it:

```js
// The server
reply.send(User.snapshot);

// The client: protoarray alone, about 22 KB
const User = Schema.from(await (await fetch('/schemas/user')).json());
```

### 📖 [Read the documentation →](https://protoarray.vercel.app/)

## Why protoarray

- **Smaller payloads.** Keys are not repeated in every message, only the values travel: about
  half the bytes of JSON on a typical record before compression, and still 5–35% fewer after gzip
  depending on the message size; 27% fewer on a list with the `columns` layout, the ids as
  differences and the repeated strings interned.
- **Fast as a binary codec.** A positional array is less work for `JSON.parse` and
  `JSON.stringify`, and the object is rebuilt by generated code with one hidden class per schema:
  ×1.5 encode and ×1.8 decode against JSON on a typical record. On records, strings and tagged
  messages it encodes faster than protobufjs, protobuf-es, avsc, msgpackr and cbor-x, and it has
  the fastest round trip of one record; msgpackr with shared structures decodes faster (and avsc,
  cbor-x or protobufjs on some shapes), and the binary codecs win on mostly numeric payloads (see
  [benchmarks](#benchmarks)). Where a channel carries bytes, `@alexify/protoarray/binary` puts
  the same schema on a [binary wire](https://protoarray.vercel.app/guide/binary) of its own.
- **Still JSON.** The payload is a plain JSON array, so it goes through any transport and storage
  that already handle JSON, compresses with gzip, brotli and zstd like JSON, and stays readable in
  logs.
- **One schema, two jobs.** No `.proto` files, no compiler, no generated files: a schema is a
  [metaschema](https://metaschema.vercel.app/) definition, a plain JavaScript value. metaschema
  validates the values with it, protoarray carries them, and both read a reference, an optional
  field or a stored entity's id the same way.
- **Evolves safely.** Append fields at the end and old and new versions keep understanding each
  other; a fingerprint (`schema.id`, 32 or 64 bits) tells versions apart in a handshake, and
  `protoarray check` holds a module to the rules in CI, against the baseline that shipped. For
  changes that break the rules, `resolve` reads and writes another version by name, Avro-style,
  and a registry wraps payloads as `[id, payload]`.
- **Typed.** A schema takes its TypeScript types from the metaschema schema it is built from;
  hand-written typings for TypeScript 5.0 or newer.
- **Zero dependencies, about 22 KB min+gzip.** protoarray requires nothing, metaschema included:
  it recognises a metaschema schema by its brand and reads its snapshot, and takes the metaschema
  module as an option (`{ metaschema }`) only to read a raw definition. CommonJS with ESM named
  imports, no build step, one package for Node.js 18+ and browsers; the registry, resolve,
  streaming and evolve extras are subpaths of 1.7–3.8 KB each, the binary wire and the standalone
  generator ones of about 9 KB. Generated code where the
  runtime allows it, and under a strict CSP or on edge runtimes either a closures fallback or a
  standalone module generated at build time, carrying both wires.

## Installation

```bash
pnpm add @alexify/protoarray @alexify/metaschema
# or
npm install @alexify/protoarray @alexify/metaschema
```

Requires Node.js 18 or newer. Works in browsers through any bundler. metaschema (3.4 or newer) is
needed where schemas are defined; a client that builds its schemas from snapshots installs
protoarray alone.

## Features

| Feature | How |
| --- | --- |
| Schemas | metaschema's: `Schema.from(new Definition(name, definition))`, `Schema.from(definition, { metaschema })`, `Schema.from(snapshot)`, `Schema.fromModel(model)` |
| Scalars | `string`, `number`, `integer`, `boolean`, `bigint` (a decimal string), `date` (epoch ms), `bytes` (base64), `json`, `any`, `unknown`, `null` |
| Optional fields | `'?string'`, `'email?': 'string'`, `required: false`, `nullable: true`; missing ones decode as `null`, trailing `null`s are trimmed |
| Defaults | `{ type: 'number', default: 0 }` fills a missing slot on decode |
| Nested records | `address: { city: 'string' }` → a nested array |
| Collections | `{ array: 'string' }` travels as is; `{ array: Record }` becomes an array of arrays; `User.list`; `{ set }`, `{ map }` and `{ object }` dictionaries; tuples of any elements |
| Compact types | `{ enum: [...] }` → index, `{ flags: [...] }` → bitmask, `{ type: 'number', decimals: 2 }` → scaled integer, `bytes` → base64 |
| Unions | `{ union: [Call, Event], discriminator: 'type' }` → `[tag, ...fields]` |
| References | as metaschema's `check` reads them: a stored entity as its id, a memory kind as its record, `embed` and `references` to choose; recursion |
| Sparse records | `{ sparse: true }` or `{ sparse: ['profile'] }` → `[mask, ...present values]` for records with many optional fields |
| Layouts | `{ layout: 'flat' }` (one array, fixed stride) or `'columns'` (transposed, best for compression); `{ layout: { items: 'columns' } }` for a collection inside a record |
| Delta and interning | `{ delta: ['ids'] }` writes integers as differences (a column, or a list); `{ intern: ['city'] }` writes strings of few values as indexes into one table per message |
| Migrations | `resolve(writer, reader)` (`@alexify/protoarray/resolve`) reads and writes another version by name, with `aliases`; `SchemaRegistry` keeps versions by id and wraps payloads as `[id, payload]` |
| Streaming | `encodeEach`/`decodeEach`; NDJSON, `TransformStream`s and the items of a large array read as they arrive (`@alexify/protoarray/stream`) |
| Standalone modules | `protoarray compile` writes the generated code of your schemas into a module, for a strict CSP and edge runtimes, with no metaschema at runtime, the binary wire too with `--binary` (`@alexify/protoarray/standalone`) |
| Binary wire | `toBinary(schema, value)` and `fromBinary(schema, bytes)` put the same schema on bytes: a header of presence bits, varints, float64s, UTF-16 for long strings; for channels that carry bytes and numeric payloads (`@alexify/protoarray/binary`) |
| Validation | the wire on decode by default: `DecodeError` with codes, paths like `orders[1].sku` and the schema name; the values before encode with metaschema's `check` and `parse` |
| Evolution | append-only positions; `{ strict: true }` rejects elements beyond the schema; `schema.id` tells versions apart, 32 bits by default, `{ fingerprint: 'fnv1a64' }` for a registry of many schemas, or your own function; `compatible(previous, next)` and `protoarray check` hold a module to the rules in CI (`@alexify/protoarray/evolve`) |

See the [guide](https://protoarray.vercel.app/guide/schema) for every form, and
[Migrating from 1.x](https://protoarray.vercel.app/guide/migrating-from-1) for the upgrade: the
wire did not change.

## Benchmarks

`pnpm bench:compare` runs seven payloads through protoarray, JSON and eleven JavaScript codecs
(protobufjs, protobuf-es, avsc, msgpackr, @msgpack/msgpack, cbor-x, BSON, `v8.serialize`,
superjson, devalue, fast-json-stringify), each library in a fresh process and checked to give the
value back before it is timed. Speed is end to end: object to
text or bytes and back.

<!-- bench:compare:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://protoarray.vercel.app/benchmarks/compare-single.svg" alt="One record: round trip: One record: 10 fields, nested address, tags, 2 orders. Encode one payload and decode it, payloads a second, linear scale, higher is better. The line marks JSON." width="760" />

<details>
<summary>6 more scenarios</summary>

<img src="https://protoarray.vercel.app/benchmarks/compare-records.svg" alt="1,000 records: round trip: 1000 records of the same shape. Encode one payload and decode it, payloads a second, linear scale, higher is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-sparse.svg" alt="Sparse record: round trip: 20 optional fields, 3 present. Encode one payload and decode it, payloads a second, linear scale, higher is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-typed.svg" alt="Typed record: round trip: Enum, boolean and date heavy record. Encode one payload and decode it, payloads a second, linear scale, higher is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-strings.svg" alt="Long strings: round trip: Long Cyrillic strings. Encode one payload and decode it, payloads a second, linear scale, higher is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-packets.svg" alt="100 wrpc packets: round trip: 100 wrpc packets: calls, callbacks and events. Encode one payload and decode it, payloads a second, linear scale, higher is better. The line marks JSON. Not run here: fast-json-stringify." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-numeric.svg" alt="32 doubles: round trip: 32 doubles (where binary formats shine). Encode one payload and decode it, payloads a second, linear scale, higher is better. The line marks JSON." width="760" />

</details>

<details>
<summary>Payload sizes</summary>

<img src="https://protoarray.vercel.app/benchmarks/compare-single-bytes.svg" alt="One record: payload size: One record: 10 fields, nested address, tags, 2 orders. The payload as sent, before compression, linear scale, lower is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-records-bytes.svg" alt="1,000 records: payload size: 1000 records of the same shape. The payload as sent, before compression, linear scale, lower is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-sparse-bytes.svg" alt="Sparse record: payload size: 20 optional fields, 3 present. The payload as sent, before compression, linear scale, lower is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-typed-bytes.svg" alt="Typed record: payload size: Enum, boolean and date heavy record. The payload as sent, before compression, linear scale, lower is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-strings-bytes.svg" alt="Long strings: payload size: Long Cyrillic strings. The payload as sent, before compression, linear scale, lower is better. The line marks JSON." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-packets-bytes.svg" alt="100 wrpc packets: payload size: 100 wrpc packets: calls, callbacks and events. The payload as sent, before compression, linear scale, lower is better. The line marks JSON. Not run here: fast-json-stringify." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/compare-numeric-bytes.svg" alt="32 doubles: payload size: 32 doubles (where binary formats shine). The payload as sent, before compression, linear scale, lower is better. The line marks JSON." width="760" />

</details>

| Library | One record<br><sub>round trips/s</sub> | 1,000 records<br><sub>round trips/s</sub> | Sparse record<br><sub>round trips/s</sub> | Typed record<br><sub>round trips/s</sub> | Long strings<br><sub>round trips/s</sub> | 100 wrpc packets<br><sub>round trips/s</sub> | 32 doubles<br><sub>round trips/s</sub> |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| JSON<br><sub>stringify · parse · Node 24.14.1</sub> | 572,000 | 554 | 2,730,000 | 640,000 | 719,000 | 16,400 | 194,000 |
| **protoarray**<br><sub>codegen · v2.1.0</sub> | 938,000 | 849 | 3,740,000 | 2,400,000 | 883,000 | 29,000 | 262,000 |
| **protoarray**<br><sub>closures, no eval · v2.1.0</sub> | 626,000 | 574 | 1,850,000 | 1,670,000 | 818,000 | 16,800 | 220,000 |
| **protoarray**<br><sub>standalone module, no eval · v2.1.0</sub> | 892,000 | 865 | 3,520,000 | 2,360,000 | 867,000 | 28,000 | 273,000 |
| **protoarray**<br><sub>codegen + metaschema check · v2.1.0</sub> | 685,000 | 626 | 1,700,000 | 1,780,000 | 817,000 | 20,100 | 235,000 |
| **protoarray**<br><sub>columns layout · v2.1.0</sub> | — | 869 | — | — | — | — | — |
| **protoarray**<br><sub>columns, delta + intern · v2.1.0</sub> | — | 967 | — | — | — | — | — |
| **protoarray**<br><sub>binary wire · v2.1.0</sub> | 1,040,000 | 1,320 | 4,780,000 | 3,200,000 | 1,020,000 | 42,300 | 1,630,000 |
| protobufjs<br><sub>reflection, Root.fromJSON · v8.8.1</sub> | 717,000 | 675 | 3,530,000 | 2,920,000 | 270,000 | 14,600 | 520,000 |
| protobuf-es<br><sub>create · toBinary · fromBinary · v2.16.0</sub> | 261,000 | 301 | 720,000 | 889,000 | 209,000 | 6,400 | 163,000 |
| avsc<br><sub>Type.forSchema · v5.7.9</sub> | 840,000 | 786 | 1,040,000 | 1,680,000 | 300,000 | 14,300 | 1,190,000 |
| msgpackr<br><sub>pack · unpack · v2.1.0</sub> | 442,000 | 455 | 3,210,000 | 1,390,000 | 170,000 | 13,400 | 309,000 |
| msgpackr<br><sub>records, shared structures · v2.1.0</sub> | 916,000 | 1,000 | 4,000,000 | 2,040,000 | 188,000 | 21,500 | 1,010,000 |
| @msgpack/msgpack<br><sub>Encoder · Decoder · v3.1.3</sub> | 356,000 | 370 | 2,060,000 | 660,000 | 244,000 | 11,400 | 149,000 |
| cbor-x<br><sub>records · v1.6.6</sub> | 358,000 | 865 | 1,650,000 | 820,000 | 180,000 | 16,200 | 269,000 |
| BSON<br><sub>serialize · deserialize · v7.3.3</sub> | 273,000 | 270 | 1,820,000 | 780,000 | 236,000 | 8,000 | 281,000 |
| v8.serialize<br><sub>structured clone, Node only · Node 24.14.1</sub> | 277,000 | 432 | 650,000 | 533,000 | 458,000 | 12,500 | 309,000 |
| superjson<br><sub>stringify · parse · v2.2.6</sub> | 109,000 | 94 | 639,000 | 213,000 | 246,000 | 3,620 | 73,500 |
| devalue<br><sub>stringify · parse · v6.0.3</sub> | 184,000 | 171 | 1,010,000 | 383,000 | 344,000 | 5,960 | 123,000 |
| fast-json-stringify<br><sub>compiled stringify, JSON.parse · v7.1.0</sub> | 615,000 | 577 | 3,560,000 | 1,820,000 | 664,000 | — | 395,000 |

_Apple M3 Max · 16 cores · Node v24.14.1 · median of 5 × 400 ms rounds, each library and scenario in a fresh process · 2026-10-20. A round trip is one encode and one decode of the payload; medians, rounded to three significant figures; — where the scenario does not apply._

<!-- bench:compare:end -->

The interactive charts, encode, decode and the payload sizes of every scenario, and how to read
them are on the [benchmarks page](https://protoarray.vercel.app/guide/benchmarks).

### Cold start

Load the library, build the schema of one record, encode it and decode it once, in a fresh
process. A client that builds its schemas from snapshots loads protoarray alone, and a standalone
module has its codec written already.

<!-- bench:coldstart:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://protoarray.vercel.app/benchmarks/coldstart.svg" alt="Cold start: Load the library, build the schema of one record, encode it and decode it once: a fresh process, median of 10 runs. Lower is better." width="760" />

| Library | Load | Build | First encode | First decode | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON<br><sub>stringify · parse · Node 24.14.1</sub> | 0.00 ms | 0.02 ms | 0.02 ms | 0.01 ms | 0.06 ms |
| v8.serialize<br><sub>structured clone, Node only · Node 24.14.1</sub> | 0.27 ms | 0.01 ms | 0.04 ms | 0.04 ms | 0.36 ms |
| **protoarray**<br><sub>standalone module, no eval · v2.1.0</sub> | 1.2 ms | 0.01 ms | 0.15 ms | 0.15 ms | 1.5 ms |
| @msgpack/msgpack<br><sub>Encoder · Decoder · v3.1.3</sub> | 2.9 ms | 0.10 ms | 0.37 ms | 0.57 ms | 3.9 ms |
| devalue<br><sub>stringify · parse · v6.0.3</sub> | 5.1 ms | 0.01 ms | 0.49 ms | 0.26 ms | 5.9 ms |
| msgpackr<br><sub>records, shared structures · v2.1.0</sub> | 5.3 ms | 0.03 ms | 0.63 ms | 0.43 ms | 6.4 ms |
| superjson<br><sub>stringify · parse · v2.2.6</sub> | 5.8 ms | 0.01 ms | 0.58 ms | 0.04 ms | 6.4 ms |
| cbor-x<br><sub>records · v1.6.6</sub> | 5.3 ms | 0.03 ms | 0.64 ms | 0.47 ms | 6.5 ms |
| BSON<br><sub>serialize · deserialize · v7.3.3</sub> | 5.4 ms | 0.02 ms | 0.51 ms | 0.60 ms | 6.5 ms |
| **protoarray**<br><sub>codegen, from a snapshot · v2.1.0</sub> | 4.4 ms | 2.8 ms | 0.13 ms | 0.15 ms | 7.6 ms |
| avsc<br><sub>Type.forSchema · v5.7.9</sub> | 8.2 ms | 0.59 ms | 0.18 ms | 0.17 ms | 9.1 ms |
| protobufjs<br><sub>reflection, Root.fromJSON · v8.8.1</sub> | 11.1 ms | 1.5 ms | 3.1 ms | 0.35 ms | 16.2 ms |
| **protoarray**<br><sub>codegen · v2.1.0</sub> | 11.9 ms | 4.3 ms | 0.13 ms | 0.15 ms | 16.5 ms |
| **protoarray**<br><sub>closures, no eval · v2.1.0</sub> | 12.5 ms | 3.9 ms | 0.12 ms | 0.17 ms | 16.7 ms |
| **protoarray**<br><sub>binary wire · v2.1.0</sub> | 13.8 ms | 4.2 ms | 1.6 ms | 0.27 ms | 19.9 ms |
| fast-json-stringify<br><sub>compiled stringify, JSON.parse · v7.1.0</sub> | 21.0 ms | 4.5 ms | 0.26 ms | 0.01 ms | 25.7 ms |
| protobuf-es<br><sub>create · toBinary · fromBinary · v2.16.0</sub> | 24.5 ms | 0.38 ms | 0.80 ms | 0.06 ms | 25.9 ms |

<!-- bench:coldstart:end -->

### Bundle size

A browser bundle that builds the schema of one record and round-trips it (esbuild, minified,
tree-shaken; `pnpm size:compare`).

<!-- bench:size:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://protoarray.vercel.app/benchmarks/size.svg" alt="Bundle size: A browser bundle that builds the schema of one record, encodes it and decodes it (esbuild, minified, tree-shaken), min+gzip. Lower is better." width="760" />

| Library | min | min+gzip |  |
| --- | ---: | ---: | --- |
| devalue<br><sub>stringify · parse · v6.0.3</sub> | 10.7 KB | 4.0 KB |  |
| superjson<br><sub>stringify · parse · v2.2.6</sub> | 11.1 KB | 4.0 KB |  |
| @msgpack/msgpack<br><sub>Encoder · Decoder · v3.1.3</sub> | 20.7 KB | 5.8 KB |  |
| **protoarray**<br><sub>standalone module, no eval · v2.1.0</sub> | 19.0 KB | 7.2 KB | the module protoarray compile writes for this schema, with its inline runtime |
| msgpackr<br><sub>records, shared structures · v2.1.0</sub> | 27.4 KB | 10.3 KB |  |
| cbor-x<br><sub>records · v1.6.6</sub> | 28.6 KB | 10.6 KB |  |
| protobuf-es<br><sub>create · toBinary · fromBinary · v2.16.0</sub> | 66.6 KB | 18.2 KB | the runtime and the descriptor generated code embeds |
| BSON<br><sub>serialize · deserialize · v7.3.3</sub> | 74.8 KB | 22.2 KB |  |
| **protoarray**<br><sub>codegen, from a snapshot · v2.1.0</sub> | 63.2 KB | 23.0 KB | the schema built from its snapshot: a client without metaschema |
| protobufjs<br><sub>protobufjs/light, Root.fromJSON · v8.8.1</sub> | 105.7 KB | 29.2 KB | reflection; static code from pbjs with protobufjs/minimal is smaller, plus the generated code |
| **protoarray**<br><sub>binary wire, from a snapshot · v2.1.0</sub> | 90.5 KB | 32.3 KB | the core and the ./binary subpath, the schema built from its snapshot |
| avsc<br><sub>Type.forSchema · v5.7.9</sub> | 115.4 KB | 34.3 KB | avsc's browser build of types, with the buffer and util polyfills it requires |
| **protoarray**<br><sub>codegen, metaschema definition · v2.1.0</sub> | 122.3 KB | 43.6 KB | protoarray and @alexify/metaschema, which reads the definition and validates values |
| fast-json-stringify<br><sub>compiled stringify, JSON.parse · v7.1.0</sub> | 217.4 KB | 62.9 KB | encode only; JSON.parse decodes |

<!-- bench:size:end -->

### Release over release

Every release on the scenarios of the comparison, on both backends, with today's harness
(`pnpm bench:releases`).

<!-- bench:releases:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://protoarray.vercel.app/benchmarks/speedup.svg" alt="protoarray 2.1.0 against its first releases: How many times as fast, scenario by scenario, against the oldest release that has it (1 = as fast; unions came in 1.1). Higher is better." width="760" />

<details>
<summary>Every release, scenario by scenario</summary>

<img src="https://protoarray.vercel.app/benchmarks/releases-single.svg" alt="One record, release over release: One record: 10 fields, nested address, tags, 2 orders. stringify and parse, ops/s, linear scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/releases-records.svg" alt="1,000 records, release over release: 1000 records of the same shape. stringify and parse, ops/s, linear scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/releases-sparse.svg" alt="Sparse record, release over release: 20 optional fields, 3 present. stringify and parse, ops/s, linear scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/releases-typed.svg" alt="Typed record, release over release: Enum, boolean and date heavy record. stringify and parse, ops/s, linear scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/releases-strings.svg" alt="Long strings, release over release: Long Cyrillic strings. stringify and parse, ops/s, linear scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/releases-packets.svg" alt="100 wrpc packets, release over release: 100 wrpc packets: calls, callbacks and events. stringify and parse, ops/s, linear scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/releases-numeric.svg" alt="32 doubles, release over release: 32 doubles (where binary formats shine). stringify and parse, ops/s, linear scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/releases-build.svg" alt="Schema.from of one record, release over release: Building the schema from its definition (2.x: metaschema reads it first), schemas/s, linear scale, higher is better." width="760" />

</details>

| Release | One record<br><sub>encode / decode</sub> | 1,000 records<br><sub>encode / decode</sub> | Sparse record<br><sub>encode / decode</sub> | Typed record<br><sub>encode / decode</sub> | Long strings<br><sub>encode / decode</sub> | 100 wrpc packets<br><sub>encode / decode</sub> | 32 doubles<br><sub>encode / decode</sub> | Schema.from<br><sub>schemas/s</sub> |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.0.0<br><sub>codegen</sub> | 2,030,000 / 1,650,000 | 1,960 / 1,500 | 7,200,000 / 7,340,000 | 3,850,000 / 4,770,000 | 1,790,000 / 1,660,000 | — | 403,000 / 734,000 | 36,200 |
| 1.1.0<br><sub>codegen</sub> | 2,030,000 / 1,640,000 | 1,970 / 1,500 | 7,210,000 / 7,180,000 | 4,880,000 / 4,790,000 | 1,750,000 / 1,670,000 | 66,800 / 47,400 | 409,000 / 731,000 | 31,600 |
| 2.0.0<br><sub>codegen</sub> | 2,040,000 / 1,690,000 | 1,970 / 1,480 | 7,020,000 / 7,460,000 | 4,670,000 / 4,780,000 | 1,800,000 / 1,700,000 | 67,600 / 50,600 | 427,000 / 731,000 | 14,600 |
| 2.1.0<br><sub>codegen</sub> | 2,070,000 / 1,690,000 | 1,990 / 1,500 | 7,400,000 / 7,620,000 | 4,700,000 / 4,870,000 | 1,820,000 / 1,700,000 | 67,400 / 50,900 | 428,000 / 725,000 | 14,700 |
| 1.0.0<br><sub>closures</sub> | 1,550,000 / 971,000 | 1,420 / 937 | 3,180,000 / 2,590,000 | 2,950,000 / 2,850,000 | 1,670,000 / 1,540,000 | — | 360,000 / 573,000 | 172,000 |
| 1.1.0<br><sub>closures</sub> | 1,470,000 / 1,040,000 | 1,380 / 976 | 2,930,000 / 2,460,000 | 3,540,000 / 3,110,000 | 1,680,000 / 1,550,000 | 47,800 / 26,000 | 364,000 / 568,000 | 98,400 |
| 2.0.0<br><sub>closures</sub> | 1,470,000 / 1,060,000 | 1,390 / 978 | 2,950,000 / 2,360,000 | 3,450,000 / 3,090,000 | 1,690,000 / 1,560,000 | 48,100 / 26,800 | 359,000 / 567,000 | 24,000 |
| 2.1.0<br><sub>closures</sub> | 1,530,000 / 1,050,000 | 1,420 / 971 | 3,190,000 / 4,180,000 | 3,520,000 / 3,100,000 | 1,710,000 / 1,600,000 | 47,600 / 26,100 | 378,000 / 574,000 | 23,300 |

_Apple M3 Max · 16 cores · Node v24.14.1 · median of 5 × 400 ms rounds, each release, backend and scenario in a fresh process · 2026-10-20. ops/s of stringify / parse, medians; — where the release has no union._

<!-- bench:releases:end -->

### On its two backends

<!-- bench:engine:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<details>
<summary>protoarray on its two backends, and its layouts</summary>

<img src="https://protoarray.vercel.app/benchmarks/engine-stringify.svg" alt="protoarray on its two backends: encode: pnpm bench: stringify against JSON.stringify of the keyed object, ops/s, log scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/engine-parse.svg" alt="protoarray on its two backends: decode: pnpm bench: parse against JSON.parse of the keyed object, ops/s, log scale, higher is better." width="760" />

<img src="https://protoarray.vercel.app/benchmarks/layouts.svg" alt="Layouts of a list of a thousand records: pnpm bench, generated code: lists a second, linear scale, higher is better." width="760" />

</details>

<!-- bench:engine:end -->

## Compared with alternatives

protoarray next to twenty-two JavaScript serialization libraries: typed and compact JSON, the
interface definition languages (Protocol Buffers, Avro, Thrift, FlatBuffers, Cap'n Proto, Bebop),
and the schemaless binary formats. Every cell was checked against the source of the published
package; [the page](https://protoarray.vercel.app/guide/comparison) has the method and what the
table shows.

<!-- comparison:start -->
<!-- generated by `pnpm docs:comparison` from docs/comparison.json — edit the data, not this block -->

<div class="pa-matrix">

<table>
<thead>
<tr>
<th>Feature</th>
<th><a href="https://github.com/Alexis-Technologies/protoarray">protoarray</a><br><sub>positional JSON</sub></th>
<th><a href="https://tc39.es/ecma262/#sec-json-object">JSON</a><br><sub>built in</sub></th>
<th><a href="https://github.com/fastify/fast-json-stringify">fast-json-stringify</a><br><sub>JSON Schema serializer</sub></th>
<th><a href="https://github.com/blitz-js/superjson">superjson</a><br><sub>typed JSON</sub></th>
<th><a href="https://github.com/sveltejs/devalue">devalue</a><br><sub>typed JSON</sub></th>
<th><a href="https://github.com/WebReflection/JSONH">JSONH</a><br><sub>packed JSON</sub></th>
<th><a href="https://github.com/beenotung/compress-json">compress-json</a><br><sub>compressed JSON</sub></th>
<th><a href="https://github.com/protobufjs/protobuf.js">protobufjs</a><br><sub>IDL · Protobuf</sub></th>
<th><a href="https://github.com/bufbuild/protobuf-es">protobuf-es</a><br><sub>IDL · Protobuf</sub></th>
<th><a href="https://github.com/stephenh/ts-proto">ts-proto</a><br><sub>Protobuf codegen</sub></th>
<th><a href="https://github.com/mtth/avsc">avsc</a><br><sub>IDL · Avro</sub></th>
<th><a href="https://github.com/apache/thrift">Apache Thrift</a><br><sub>IDL · Thrift</sub></th>
<th><a href="https://github.com/google/flatbuffers">FlatBuffers</a><br><sub>IDL · zero-copy</sub></th>
<th><a href="https://github.com/unjs/capnp-es">Cap'n Proto</a><br><sub>IDL · zero-copy</sub></th>
<th><a href="https://github.com/6over3/bebop">Bebop</a><br><sub>IDL · binary</sub></th>
<th><a href="https://github.com/samchon/typia">typia</a><br><sub>AOT compiler</sub></th>
<th><a href="https://github.com/phretaddin/schemapack">schemapack</a><br><sub>schema · binary</sub></th>
<th><a href="https://github.com/kriszyp/msgpackr">msgpackr</a><br><sub>MessagePack</sub></th>
<th><a href="https://github.com/msgpack/msgpack-javascript">@msgpack/msgpack</a><br><sub>MessagePack</sub></th>
<th><a href="https://github.com/kriszyp/cbor-x">cbor-x</a><br><sub>CBOR</sub></th>
<th><a href="https://github.com/mongodb/js-bson">BSON</a><br><sub>BSON</sub></th>
<th><a href="https://nodejs.org/api/v8.html#serialization-api">v8.serialize</a><br><sub>built in · Node</sub></th>
<th><a href="https://github.com/amazon-ion/ion-js">Amazon Ion</a><br><sub>self-describing</sub></th>
</tr>
</thead>
<tbody>
<tr class="pa-matrix-group"><td colspan="24"><strong>Package</strong></td></tr>
<tr><td>Version compared</td><td>2.0.0</td><td>Node 24.14.1 (V8 13.6)</td><td>7.1.0</td><td>2.2.6</td><td>6.0.3</td><td>0.0.6</td><td>3.4.0</td><td>8.8.1 (protobufjs-cli 2.7.1)</td><td>2.16.0 (protoc-gen-es 2.16.0)</td><td>2.15.3</td><td>5.7.9</td><td>0.25.0</td><td>25.9.23</td><td>0.0.16<sup>1</sup></td><td>3.2.3</td><td>15.1.0</td><td>1.4.2</td><td>2.1.0</td><td>3.1.3</td><td>1.6.6</td><td>7.3.3</td><td>Node 24.14.1 (format version 15)</td><td>5.2.1</td></tr>
<tr><td>Latest release</td><td>2026-10 (this release)</td><td>Node 24 (built in)</td><td>2026-10</td><td>2025-11</td><td>2026-10</td><td>2017-07</td><td>2025-09</td><td>2026-10</td><td>2026-09</td><td>2026-10</td><td>2025-07</td><td>2026-09</td><td>2025-09</td><td>2026-08</td><td>2025-09</td><td>2026-10</td><td>2016-08</td><td>2026-08</td><td>2025-12</td><td>2026-08</td><td>2026-09</td><td>Node 24 (built in)</td><td>2024-04</td></tr>
<tr><td>Runtime dependencies</td><td>✅ 0</td><td>✅ 0 (built in)</td><td>6: ajv, ajv-formats, fast-uri, rfdc, …</td><td>1: copy-anything</td><td>✅ 0</td><td>✅ 0</td><td>✅ 0</td><td>1: <code>long</code></td><td>✅ 0</td><td>1 at runtime: <code>@bufbuild/protobuf</code></td><td>✅ 0</td><td>5: ws, uuid, node-int64, isomorphic-ws, browser-or-node</td><td>✅ 0</td><td>✅ 0 (an optional peer for the compiler)</td><td>✅ 0</td><td>3: @typia/interface, @typia/utils, randexp + optional peer ttsc</td><td>✅ 0</td><td>1 optional: <code>msgpackr-extract</code> (native)</td><td>✅ 0</td><td>1 optional: <code>cbor-extract</code> (native)</td><td>✅ 0</td><td>✅ 0 (built in)</td><td>✅ 0</td></tr>
<tr><td>License</td><td>MIT</td><td>built in (ECMA-262)</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT (source header)</td><td>BSD-2-Clause</td><td>BSD-3-Clause</td><td>Apache-2.0 AND BSD-3-Clause</td><td>ISC</td><td>MIT</td><td>Apache-2.0</td><td>Apache-2.0</td><td>MIT</td><td>Apache-2.0</td><td>MIT</td><td>MIT</td><td>MIT</td><td>ISC</td><td>MIT</td><td>Apache-2.0</td><td>MIT (Node.js)</td><td>Apache-2.0</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Runtime</strong></td></tr>
<tr><td>Runs on</td><td>✅ Node 18+, browsers, edge</td><td>✅ every JS runtime</td><td>✅ Node, browsers (bundled with Ajv)</td><td>✅ Node ≥ 16, browsers</td><td>✅ Node 20+, browsers, Deno, Bun, edge</td><td>✅ Node, browsers (ES3), Deno, Bun, edge</td><td>✅ Node, browsers (IIFE bundle), Deno, Bun</td><td>✅ Node ≥ 12, browsers, Deno, Bun</td><td>✅ Node, browsers, Deno, Bun, edge</td><td>✅ anywhere <code>@bufbuild/protobuf/wire</code> runs</td><td>⚠️ Node ≥ 0.11; browsers need <code>buffer</code>/<code>util</code>/<code>stream</code> shims<sup>2</sup></td><td>⚠️ Node ≥ 10.18; browsers need <code>util</code>/<code>Buffer</code> shims<sup>3</sup></td><td>✅ Node, browsers, Deno, Bun (no <code>engines</code>)</td><td>✅ Node, browsers, Deno, Bun (no <code>engines</code>)</td><td>✅ Node, browsers, Deno, Bun (no <code>engines</code>)</td><td>✅ Node, browsers (build needs ttsc, Node ≥ 22.15)</td><td>⚠️ Node; browsers need the <code>buffer</code> shim<sup>4</sup></td><td>✅ Node, browsers, Deno, Bun</td><td>✅ Node ≥ 18, browsers, Deno, Bun</td><td>✅ Node, browsers, Deno</td><td>✅ Node ≥ 20.19, browsers, React Native</td><td>❌ Node only (<code>node:v8</code>)</td><td>✅ Node, browsers (no <code>engines</code>, needs BigInt)</td></tr>
<tr><td>Module format</td><td>CJS, ESM named imports</td><td>built in (global <code>JSON</code>)</td><td>CJS</td><td>ESM only</td><td>ESM</td><td>CJS + global script (<code>JSONH</code>)</td><td>CJS (+ IIFE browser bundle)</td><td>CJS + UMD bundle (<code>dist/protobuf.js</code>)</td><td>ESM + CJS</td><td>generated <code>.ts</code> (ESM imports); plugin CJS</td><td>CJS</td><td>CJS (generated code CJS or ESM)</td><td>CJS + ESM (<code>module</code> field)</td><td>ESM</td><td>ESM + CJS</td><td>ESM + CJS</td><td>CJS</td><td>ESM + CJS (+ UMD)</td><td>ESM + CJS + UMD</td><td>ESM + CJS (+ UMD)</td><td>ESM + CJS</td><td>built in (<code>node:v8</code>)</td><td>CJS + ESM (bundlers) + AMD</td></tr>
<tr><td>Works without eval (strict CSP, edge)</td><td>✅ closures fallback; standalone modules at codegen speed</td><td>✅ native, no code generation</td><td>⚠️ <code>build</code> uses <code>new Function</code>; standalone modules don't<sup>5</sup></td><td>✅ no <code>eval</code> or <code>Function</code> in <code>dist/</code></td><td>✅ <code>stringify</code>/<code>parse</code> never eval</td><td>✅ never</td><td>✅ never</td><td>⚠️ reflection needs <code>new Function</code>; static code doesn't<sup>6</sup></td><td>✅ never: closures over descriptors</td><td>✅ never: plain generated code</td><td>❌ <code>new Function</code> per type; required<sup>7</sup></td><td>✅ never (library and generated code)</td><td>✅ never (runtime and flatc output)</td><td>✅ never</td><td>✅ never (runtime and bebopc output)</td><td>✅ never (code emitted at build time)</td><td>❌ <code>new Function</code> per <code>build()</code><sup>8</sup></td><td>⚠️ <code>new Function</code> for records; catches failure<sup>9</sup></td><td>✅ never</td><td>⚠️ probes <code>new Function</code> at import; compiles records<sup>10</sup></td><td>✅ never (<code>Code</code> values are not evaluated)</td><td>✅ native, no code generation</td><td>✅ never</td></tr>
<tr><td>Schema at runtime, no code generator</td><td>✅ a definition or a snapshot at runtime</td><td>✅ no schema needed</td><td>✅ JSON Schema object at runtime</td><td>✅ no schema needed</td><td>✅ no schema needed</td><td>✅ no schema needed</td><td>✅ no schema needed</td><td>✅ <code>protobuf.parse</code>/<code>load</code> or <code>Root.fromJSON</code> at runtime</td><td>⚠️ <code>createFileRegistry</code> from descriptors; no .proto parser</td><td>❌ needs <code>protoc</code>/<code>buf</code> + plugin</td><td>✅ <code>Type.forSchema(json)</code> at runtime</td><td>❌ needs <code>thrift --gen js:node</code></td><td>❌ requires <code>flatc</code> code generation</td><td>❌ requires C++ <code>capnpc</code> + <code>capnp-es</code> plugin</td><td>⚠️ <code>BinarySchema</code> reader/writer; schema from <code>bebopc</code></td><td>❌ every function throws without the ttsc transform</td><td>✅ <code>build(schema)</code> at runtime</td><td>✅ no schema needed</td><td>✅ no schema needed</td><td>✅ no schema needed</td><td>✅ no schema needed</td><td>✅ no schema needed</td><td>✅ no schema needed</td></tr>
<tr><td>TypeScript types</td><td>✅ bundled d.ts, types from the metaschema schema</td><td>✅ TypeScript's <code>lib.es5.d.ts</code></td><td>✅ bundled d.ts</td><td>✅ bundled d.ts</td><td>✅ bundled d.ts</td><td>❌ none (no <code>@types/jsonh</code>)</td><td>✅ bundled d.ts</td><td>✅ bundled d.ts; <code>pbts</code> for messages</td><td>✅ bundled d.ts; generated message types</td><td>✅ generated from the IDL</td><td>✅ bundled d.ts (<code>types/index.d.ts</code>)</td><td>✅ generated from the IDL (<code>js:ts</code>)</td><td>✅ generated from the IDL (<code>flatc --ts</code>)</td><td>✅ generated from the IDL (<code>-ots</code>, <code>-odts</code>)</td><td>✅ generated from the IDL (<code>bebopc</code>)</td><td>✅ bundled d.ts (the types are the schema)</td><td>❌ none (no <code>@types/schemapack</code>)</td><td>✅ bundled d.ts</td><td>✅ bundled d.ts (written in TypeScript)</td><td>✅ bundled d.ts</td><td>✅ bundled d.ts</td><td>⚠️ <code>@types/node</code></td><td>✅ bundled d.ts</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Schema</strong></td></tr>
<tr><td>How the shape is described</td><td>metaschema definition (a JS object) or its JSON snapshot</td><td>none (schemaless)</td><td>JSON Schema (draft 7, plus <code>nullable</code>)</td><td>none (schemaless)</td><td>none (schemaless); reducers/revivers for custom types</td><td>none; keys from the first record</td><td>none (schemaless)</td><td><code>.proto</code> file, JSON descriptor or reflection API</td><td><code>.proto</code> file, compiled to descriptors</td><td><code>.proto</code> file (via protoc)</td><td>Avro schema JSON (or <code>.avdl</code> IDL)</td><td><code>.thrift</code> IDL</td><td><code>.fbs</code> IDL (flatc also reads <code>.proto</code>)</td><td><code>.capnp</code> IDL</td><td><code>.bop</code> IDL</td><td>TypeScript type (+ <code>tags.*</code>)</td><td>JS object of type names (<code>{ age: 'uint8' }</code>)</td><td>none (records inferred from object keys)</td><td>none (schemaless)</td><td>none (records inferred from object keys)</td><td>none (schemaless)</td><td>none (schemaless)</td><td>none (self-describing)</td></tr>
<tr><td>The schema is data (store it, send it)</td><td>✅ the snapshot is JSON a server hands to clients</td><td>— schemaless</td><td>✅ JSON Schema is plain data<sup>11</sup></td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>✅ JSON descriptors: <code>root.toJSON()</code> / <code>Root.fromJSON</code></td><td>✅ <code>FileDescriptorSet</code> → <code>createFileRegistry</code></td><td>⚠️ export only (<code>outputSchema=true</code>)</td><td>✅ Avro schema JSON; <code>type.schema()</code> exports it</td><td>❌ generated code only</td><td>⚠️ export only: <code>.bfbs</code>, JSON Schema via <code>flatc</code></td><td>⚠️ schema nodes as capnp messages; no dynamic codec</td><td>✅ binary schema + <code>BinarySchema</code> (<code>RecordReader</code>)</td><td>⚠️ export only: <code>json.schema&lt;T&gt;()</code>, <code>protobuf.message&lt;T&gt;()</code></td><td>⚠️ plain JSON, but keys become code</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— schemaless</td><td>— schemaless</td></tr>
<tr><td>Static type from the schema</td><td>✅ from the metaschema schema (Standard Schema types)</td><td>— schemaless</td><td>⚠️ third-party: TypeBox, json-schema-to-ts</td><td>— schemaless</td><td>— schemaless; <code>parse</code> returns <code>any</code></td><td>— schemaless</td><td>— schemaless; <code>decompress&lt;T&gt;</code> is a cast</td><td>✅ generated by <code>pbts</code> from static code</td><td>✅ generated by <code>protoc-gen-es</code></td><td>✅ generated interfaces</td><td>⚠️ third-party <code>@ovotech/avro-ts</code> codegen</td><td>✅ generated d.ts (<code>js:ts</code>)</td><td>✅ generated by <code>flatc --ts</code></td><td>✅ generated by <code>capnp-es -ots</code></td><td>✅ generated by <code>bebopc</code></td><td>✅ the TS type is the schema</td><td>❌ none</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— schemaless</td><td>— schemaless</td></tr>
<tr><td>Values checked before encode</td><td>✅ metaschema <code>check</code> of the same definition<sup>12</sup></td><td>— schemaless</td><td>❌ coerces: <code>'12'</code> → 12, <code>null</code> → 0<sup>13</sup></td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>✅ <code>Type.verify</code>; <code>encode</code> coerces silently</td><td>⚠️ <code>toBinary</code> range-checks numbers; strings coerced<sup>14</sup></td><td>⚠️ writer range-checks numbers; no <code>verify</code><sup>15</sup></td><td>✅ <code>type.isValid(v, { errorHook })</code>; <code>toBuffer</code> throws</td><td>❌ string in <code>i32</code> → 0, 2^40 → 0<sup>16</sup></td><td>❌ coerces: string in int → 0, overflow wraps<sup>17</sup></td><td>❌ coerces: string in UInt32 → 0<sup>18</sup></td><td>❌ trusts: string in uint32 → 0<sup>19</sup></td><td>✅ <code>assertEncode</code>, <code>assertStringify</code>, <code>typia.assert</code></td><td>⚠️ typeof and range checks, on by default<sup>20</sup></td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— schemaless</td><td>— schemaless</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Wire format</strong></td></tr>
<tr><td>Wire format</td><td>JSON text (positional arrays); bytes through <code>./binary</code></td><td>JSON text</td><td>JSON text</td><td>JSON text + metadata (<code>{ json, meta }</code>)</td><td>JSON text (flat value table, index refs)<sup>21</sup></td><td>JSON text (<code>[n, …keys, …values]</code>)</td><td>JSON array (<code>[values[], rootKey]</code>, encoded strings)</td><td>binary (Protobuf); ProtoJSON via <code>ext/protojson</code></td><td>binary (Protobuf); ProtoJSON <code>toJson</code>/<code>fromJson</code></td><td>binary (Protobuf); JSON via <code>toJSON</code>/<code>fromJSON</code></td><td>binary (Avro); Avro JSON via <code>toString</code></td><td>binary (Binary/Compact) or JSON (<code>TJSONProtocol</code>)</td><td>binary (FlatBuffers: vtables + offsets)</td><td>binary (Cap'n Proto, optional packing)</td><td>binary (Bebop)</td><td>JSON text (<code>json.*</code>) or binary Protobuf (<code>protobuf.*</code>)</td><td>binary (custom, big-endian, varints)</td><td>binary (MessagePack + record extension)</td><td>binary (MessagePack)</td><td>binary (CBOR + record tags)</td><td>binary (BSON)</td><td>binary (V8 structured clone)</td><td>Ion text or Ion binary</td></tr>
<tr><td>Human-readable payload</td><td>✅ JSON arrays</td><td>✅ JSON</td><td>✅ JSON</td><td>✅ JSON</td><td>✅ JSON, values referenced by index<sup>22</sup></td><td>✅ JSON</td><td>⚠️ JSON, but base62 numbers and refs</td><td>❌ binary</td><td>❌ binary</td><td>❌ binary</td><td>⚠️ binary; Avro JSON via <code>type.toString()</code></td><td>⚠️ binary; <code>TJSONProtocol</code> is JSON</td><td>❌ binary</td><td>❌ binary</td><td>❌ binary</td><td>✅ JSON path; protobuf path is binary</td><td>❌ binary</td><td>❌ binary</td><td>❌ binary</td><td>❌ binary</td><td>❌ binary (<code>EJSON</code> for text)</td><td>❌ binary</td><td>⚠️ Ion text (JSON superset, not JSON)</td></tr>
<tr><td>Travels over a JSON or text channel as is</td><td>✅ plain JSON</td><td>✅ it is JSON</td><td>✅ it is JSON</td><td>✅ it is JSON</td><td>✅ JSON string</td><td>✅ JSON string</td><td>✅ <code>JSON.stringify(compress(x))</code></td><td>❌ binary; base64 to travel as text</td><td>❌ binary; base64 to travel as text</td><td>❌ binary; base64 to travel as text</td><td>✅ only as Avro JSON (<code>toString</code>/<code>fromString</code>)</td><td>✅ only with <code>TJSONProtocol</code></td><td>❌ needs base64</td><td>❌ needs base64</td><td>❌ needs base64</td><td>✅ JSON path; protobuf needs base64</td><td>❌ Buffer; base64 needed</td><td>❌ binary, needs base64</td><td>❌ binary, needs base64</td><td>❌ binary, needs base64</td><td>❌ binary; <code>EJSON</code> is a separate JSON form</td><td>❌ needs base64</td><td>✅ Ion text is a string</td></tr>
<tr><td>Field names on the wire</td><td>❌ positional</td><td>✅ every message</td><td>✅ every message</td><td>✅ every message (and in <code>meta</code> paths)</td><td>✅ every object</td><td>⚠️ once per collection (header)</td><td>⚠️ once per distinct key set</td><td>❌ tag numbers</td><td>❌ tag numbers</td><td>❌ tag numbers</td><td>❌ positional (schema order)</td><td>❌ tag numbers (field ids)</td><td>❌ vtable slots (field ids)</td><td>❌ fixed offsets</td><td>❌ positional structs; 1-byte tags in messages</td><td>✅ JSON: every message; protobuf: tag numbers</td><td>❌ positional (sorted key order)</td><td>⚠️ once per structure (<code>new Packr()</code> records)</td><td>✅ every object</td><td>⚠️ once per structure (<code>new Encoder()</code> records)</td><td>✅ every document</td><td>✅ every object, repeated</td><td>✅ text: each time; binary: once (symbol table)</td></tr>
<tr><td>Decodable without the schema</td><td>⚠️ parses as JSON; keys need the schema</td><td>✅ plain JSON</td><td>✅ plain JSON</td><td>✅ <code>meta</code> carries the types</td><td>✅ type tags in the payload</td><td>✅ keys in the header</td><td>✅ keys and value kinds encoded</td><td>⚠️ to raw tags only (<code>Reader</code>)</td><td>⚠️ to raw tags only (<code>BinaryReader</code>)</td><td>⚠️ to raw tags only (<code>BinaryReader</code>)</td><td>❌ needs the writer schema</td><td>⚠️ to raw tags only (type ids travel)</td><td>❌ needs the schema</td><td>⚠️ to raw structs and lists only</td><td>❌ needs the schema</td><td>✅ JSON path; protobuf to raw tags only</td><td>❌ schema required</td><td>✅ yes, unless shared <code>structures</code> are used</td><td>✅ yes</td><td>✅ yes, unless shared <code>structures</code> are used</td><td>✅ yes (type-tagged elements)</td><td>✅ tagged values</td><td>✅ typed values, names in stream</td></tr>
<tr><td>Lazy or zero-copy reads</td><td>❌ none</td><td>❌ whole text parsed</td><td>❌ decode is <code>JSON.parse</code></td><td>❌ whole text parsed</td><td>❌ whole payload revived</td><td>❌ none</td><td>❌ none</td><td>❌ full decode; <code>bytes</code> are views</td><td>❌ full decode; <code>bytes</code> are views</td><td>❌ full decode</td><td>❌ whole record decoded</td><td>❌ whole struct decoded</td><td>✅ accessors read the buffer in place</td><td>✅ lazy accessors</td><td>❌ decodes the whole record (bytes are views)</td><td>❌ none</td><td>❌ none</td><td>⚠️ only via <code>structon</code> (split out in 2.0)</td><td>❌ none</td><td>❌ none</td><td>⚠️ experimental <code>onDemand.parseToElements</code></td><td>❌ whole buffer decoded</td><td>✅ binary <code>Reader</code> skips values by length</td></tr>
<tr><td>Other languages read the wire</td><td>⚠️ the wire format is specified; JS only</td><td>✅ every language (RFC 8259)</td><td>✅ plain JSON: any language</td><td>⚠️ a community Elixir port</td><td>❌ JS only<sup>23</sup></td><td>✅ Python 2, PHP 5, Ruby (in package)</td><td>✅ Python, PHP, Rust ports<sup>24</sup></td><td>✅ C++, Java, Go, Python, C#, Rust…</td><td>✅ C++, Java, Go, Python, C#, Rust…</td><td>✅ C++, Java, Go, Python, C#, Rust…</td><td>✅ Apache Avro: Java, Python, C, C#, Rust, Go</td><td>✅ C++, Java, Python, Go, Rust, C#, …</td><td>✅ C++, Java, Go, Rust, Python, C#, Swift</td><td>✅ C++, Rust, Go, Java, Python, C#</td><td>✅ C#, Rust, C++, C, Dart, Python</td><td>✅ JSON anywhere; protobuf wire via <code>.proto</code> export</td><td>❌ JS only</td><td>⚠️ any MessagePack library; records are msgpackr-only</td><td>✅ MessagePack in C, Go, Python, Rust, Java…</td><td>⚠️ any CBOR library; records are cbor-x-only</td><td>✅ every MongoDB driver (C, Java, Go, Python…)</td><td>❌ V8 only</td><td>✅ Java, C, Python, Rust, Go, .NET</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Types</strong></td></tr>
<tr><td>64-bit integers, BigInt</td><td>✅ <code>bigint</code> as a decimal string</td><td>⚠️ doubles; <code>BigInt</code> throws <code>TypeError</code></td><td>⚠️ BigInt → JSON number; <code>JSON.parse</code> rounds it</td><td>✅ <code>BigInt</code>, as a decimal string</td><td>✅ BigInt (<code>["BigInt","…"]</code>)</td><td>❌ BigInt throws (<code>JSON.stringify</code>)</td><td>❌ BigInt throws <code>unsupported data type</code></td><td>⚠️ <code>Long</code> objects; BigInt only via <code>toObject</code></td><td>✅ BigInt (<code>jstype = JS_STRING</code> → string)</td><td>⚠️ <code>number</code> by default; <code>forceLong=bigint</code></td><td>⚠️ numbers; throws past 2^53</td><td>⚠️ <code>Int64</code> objects; BigInt with <code>js:node,bigint</code></td><td>✅ BigInt (<code>readInt64</code> returns <code>bigint</code>)</td><td>✅ BigInt</td><td>✅ BigInt</td><td>⚠️ <code>bigint</code> ↔ int64 in protobuf; JSON rejects bigint</td><td>❌ max int32/uint32; varint ±2³⁰</td><td>✅ BigInt in and out (±2⁶⁴)</td><td>⚠️ numbers by default; <code>useBigInt64</code> opt-in</td><td>✅ BigInt; bignum tags past 64 bits</td><td>⚠️ <code>Long</code>/number by default; <code>useBigInt64</code> opt-in</td><td>✅ <code>BigInt</code></td><td>✅ arbitrary-size ints, <code>bigIntValue()</code></td></tr>
<tr><td>Dates</td><td>✅ <code>Date</code> ↔ epoch ms</td><td>❌ <code>Date</code> → ISO string, comes back a string</td><td>⚠️ <code>format: 'date-time'</code> → ISO string, string back</td><td>✅ <code>Date</code> in, <code>Date</code> out</td><td>✅ <code>Date</code> in, <code>Date</code> out (ISO)</td><td>❌ ISO string out (via JSON)</td><td>❌ <code>Date</code> silently becomes <code>{}</code></td><td>⚠️ <code>Timestamp</code> <code>{ seconds, nanos }</code>, no <code>Date</code></td><td>⚠️ <code>Timestamp</code> + <code>timestampFromDate</code>/<code>timestampDate</code></td><td>✅ <code>Date</code> via <code>Timestamp</code> (<code>useDate</code>, default)</td><td>⚠️ logical type you implement (<code>logicalTypes</code>)</td><td>❌ none</td><td>❌ no date type; int64 by hand</td><td>❌ none</td><td>✅ <code>date</code> ↔ <code>Date</code> (100 ns ticks)</td><td>⚠️ <code>Date</code> → ISO string; parse returns a string</td><td>❌ none</td><td>✅ <code>Date</code> via the timestamp extension (−1)</td><td>✅ <code>Date</code> via the timestamp extension (−1)</td><td>✅ <code>Date</code> via tag 1 (epoch)</td><td>✅ <code>Date</code> via UTC datetime</td><td>✅ <code>Date</code> in, <code>Date</code> out</td><td>✅ <code>Date</code> in, <code>dom.Timestamp</code> (a Date) out</td></tr>
<tr><td>Binary data (<code>Uint8Array</code>)</td><td>✅ <code>Uint8Array</code> ↔ canonical base64</td><td>❌ <code>Uint8Array</code> → <code>{"0":1,"1":2}</code></td><td>❌ <code>Uint8Array</code> in a string → <code>"1,2"</code></td><td>✅ typed arrays, as a number array</td><td>✅ typed arrays, <code>ArrayBuffer</code> (base64 inside)<sup>25</sup></td><td>❌ <code>Uint8Array</code> → <code>{"0":1,…}</code></td><td>❌ <code>Uint8Array</code> → <code>{"0":1,…}</code></td><td>✅ <code>Uint8Array</code> (<code>Buffer</code> on Node)</td><td>✅ <code>Uint8Array</code></td><td>✅ <code>Uint8Array</code></td><td>✅ <code>bytes</code>/<code>fixed</code> as <code>Buffer</code></td><td>✅ <code>binary</code> → <code>Buffer</code></td><td>✅ <code>[ubyte]</code> → <code>xArray()</code> <code>Uint8Array</code> view</td><td>✅ <code>Data</code> (<code>toUint8Array()</code> live view)</td><td>✅ <code>byte[]</code> ↔ <code>Uint8Array</code> (a view)</td><td>⚠️ <code>Uint8Array</code> in protobuf only</td><td>⚠️ <code>buffer</code> type, Node Buffer only</td><td>✅ <code>bin</code> → Buffer/Uint8Array</td><td>✅ <code>bin</code> → Uint8Array</td><td>✅ byte string → Uint8Array/Buffer</td><td>⚠️ <code>Binary</code> wrapper; <code>promoteBuffers</code> for bytes</td><td>✅ typed arrays, <code>Buffer</code>, <code>ArrayBuffer</code></td><td>✅ <code>blob</code> ↔ <code>Uint8Array</code></td></tr>
<tr><td><code>Map</code> and <code>Set</code></td><td>✅ <code>{ map }</code>, <code>{ set }</code></td><td>❌ <code>Map</code> and <code>Set</code> → <code>{}</code></td><td>❌ <code>Map</code> → <code>{}</code></td><td>✅ both</td><td>✅ both</td><td>❌ become <code>{}</code></td><td>❌ silently become <code>{}</code></td><td>⚠️ maps as plain objects; no <code>Set</code></td><td>⚠️ maps as plain objects; no <code>Set</code></td><td>⚠️ <code>Map</code> with <code>useMapType=true</code>; no <code>Set</code></td><td>⚠️ <code>map</code> → plain object; no Set</td><td>⚠️ <code>map</code> → object, <code>set</code> → array</td><td>❌ neither; vectors only</td><td>❌ neither</td><td>⚠️ <code>map[K, V]</code> ↔ <code>Map</code>; no Set</td><td>⚠️ <code>Map</code> in protobuf only; no <code>Set</code></td><td>❌ none</td><td>✅ both with <code>moreTypes</code> or <code>structuredClone</code></td><td>❌ Map and Set encode as <code>{}</code></td><td>✅ Map (tag 259) and Set (tag 258)</td><td>⚠️ Map in, plain object out; no Set</td><td>✅ both</td><td>❌ <code>Map</code> and <code>Set</code> dump as <code>{}</code></td></tr>
<tr><td>Enums</td><td>✅ as an index</td><td>— no schema</td><td>⚠️ <code>enum</code> not enforced; the string travels</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>✅ number on the wire; names via <code>enums: String</code></td><td>✅ number on the wire; name in JSON</td><td>✅ number on the wire; <code>stringEnums</code> in TS</td><td>✅ as an index; JS sees the symbol</td><td>✅ as the i32 number</td><td>✅ the integer value travels</td><td>✅ the uint16 ordinal travels</td><td>✅ the integer value travels</td><td>✅ literal unions; the string travels</td><td>❌ none</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>⚠️ symbols (no enum type)</td></tr>
<tr><td>Tagged unions</td><td>✅ discriminated <code>union</code>: <code>[tag, …fields]</code></td><td>— any value</td><td>⚠️ untagged <code>anyOf</code>/<code>oneOf</code>; Ajv picks the branch</td><td>— any value</td><td>— any value</td><td>— any value</td><td>— any value</td><td>✅ <code>oneof</code> (virtual property names the case)</td><td>✅ <code>oneof</code> as <code>{ case, value }</code></td><td>✅ <code>oneof=unions</code> gives a <code>$case</code> union</td><td>✅ Avro unions (branch index on wire)</td><td>✅ <code>union</code> (one field id set)</td><td>✅ <code>union</code> (type byte + offset)</td><td>✅ <code>union</code> + <code>which()</code></td><td>✅ <code>union</code> → <code>{ tag, value }</code></td><td>✅ TS union types (protobuf <code>oneof</code>)</td><td>❌ none</td><td>— any value</td><td>— any value</td><td>— any value</td><td>— any value</td><td>— any value</td><td>— any value; annotations can tag it</td></tr>
<tr><td>Optional fields: absent and null</td><td>⚠️ optional fields; absent and null both <code>null</code><sup>26</sup></td><td>✅ absent vs <code>null</code>; <code>undefined</code> dropped</td><td>⚠️ absent omitted; <code>null</code> → <code>""</code>/0 unless <code>nullable</code></td><td>✅ absent, <code>undefined</code> and <code>null</code> kept apart</td><td>✅ absent, <code>undefined</code>, <code>null</code> all distinct</td><td>⚠️ absent becomes <code>null</code>; extra keys dropped</td><td>✅ absent and <code>null</code> distinct</td><td>✅ presence with proto3 <code>optional</code>/proto2</td><td>✅ presence with <code>optional</code>; <code>isFieldSet</code></td><td>✅ <code>optional</code> → <code>field?: T | undefined</code></td><td>⚠️ <code>["null", T]</code> union; absent and null merge</td><td>✅ <code>optional</code>; absent reads as <code>null</code></td><td>✅ <code>= null</code> scalars; tables, strings nullable</td><td>⚠️ scalars: default = absent; pointers <code>_hasX()</code></td><td>✅ message fields: absent ≠ set</td><td>✅ <code>?:</code> absent vs <code>null</code> distinct</td><td>❌ every field required</td><td>✅ absent, <code>null</code> and <code>undefined</code> distinct</td><td>✅ absent vs <code>null</code>; <code>undefined</code> → <code>null</code></td><td>✅ absent, <code>null</code> and <code>undefined</code> distinct</td><td>✅ absent vs <code>null</code>; <code>undefined</code> dropped</td><td>✅ absent, <code>undefined</code> and <code>null</code> kept apart</td><td>✅ absent vs <code>null</code> / typed <code>null.int</code></td></tr>
<tr><td>Defaults on decode</td><td>✅ the definition's <code>default</code></td><td>— no schema</td><td>⚠️ <code>default</code> written on encode, not on decode</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>⚠️ zero values; <code>[default]</code> in proto2/editions only</td><td>⚠️ zero values; <code>[default]</code> in proto2/editions only</td><td>⚠️ zero values; proto2 <code>[default]</code> honoured</td><td>✅ field <code>default</code> (encode and resolver)</td><td>✅ IDL defaults set in the constructor</td><td>✅ schema defaults returned when absent</td><td>✅ schema defaults (XOR-encoded)</td><td>❌ none (absent → <code>undefined</code>)</td><td>⚠️ protobuf zero values; <code>Default&lt;V&gt;</code> is schema-only</td><td>❌ none</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— schemaless</td></tr>
<tr><td>Recursive types, cyclic values</td><td>✅ references by name, recursion</td><td>✅ any nesting; cyclic values throw <code>TypeError</code></td><td>✅ <code>$ref</code> recursion; cyclic values overflow</td><td>✅ any nesting; cycles and shared refs</td><td>✅ any nesting; cyclic and repeated refs</td><td>✅ any nesting (JSON); no cycles</td><td>✅ any nesting; no cycles</td><td>✅ recursive messages, references by name</td><td>✅ recursive messages, references by name</td><td>✅ recursive messages, references by name</td><td>✅ named types by reference; no cyclic values</td><td>✅ structs reference structs; no cyclic values</td><td>✅ tables may contain themselves</td><td>✅ structs may contain themselves</td><td>✅ messages may contain themselves</td><td>✅ recursive types; cyclic values rejected</td><td>❌ none (self-referencing schema overflows <code>build</code>)</td><td>✅ any nesting; cycles with <code>structuredClone</code></td><td>✅ any nesting on decode; no cycles</td><td>✅ any nesting; cycles with <code>structuredClone</code></td><td>✅ any nesting; cycles rejected</td><td>✅ any nesting; cycles and shared refs</td><td>✅ any nesting; no cyclic values</td></tr>
<tr><td>Fixed-point decimals</td><td>✅ <code>decimals: n</code> → a scaled integer</td><td>❌ doubles only</td><td>❌ none (<code>multipleOf</code> ignored)</td><td>❌ none (<code>registerCustom</code> recipe)</td><td>❌ doubles only</td><td>❌ none</td><td>❌ none</td><td>❌ none (int64 minor units by hand)</td><td>❌ none (int64 minor units by hand)</td><td>❌ none (int64 minor units by hand)</td><td>⚠️ <code>decimal</code> logical type, not implemented</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ <code>MultipleOf&lt;0.01&gt;</code> check; travels as a number</td><td>❌ none</td><td>❌ none (float32 rounding options only)</td><td>❌ none</td><td>⚠️ tag 4 decoded to a float; not encoded</td><td>✅ <code>Decimal128</code></td><td>❌ none</td><td>✅ <code>decimal</code> type (<code>ion.Decimal</code>)</td></tr>
<tr><td>Bit flags, packed scalars</td><td>✅ <code>flags</code> → a bitmask</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ packed repeated scalars (proto3 default)</td><td>✅ packed repeated scalars (proto3 default)</td><td>✅ packed repeated scalars (proto3 default)</td><td>❌ none (a byte per boolean)</td><td>❌ none</td><td>✅ <code>(bit_flags)</code> enums</td><td>✅ Bool fields and <code>List(Bool)</code> bit-packed</td><td>✅ <code>@flags</code> enums</td><td>⚠️ packed repeated scalars (protobuf path)</td><td>❌ a byte per boolean</td><td>⚠️ typed arrays only with <code>moreTypes</code></td><td>⚠️ typed arrays as raw <code>bin</code>, type lost</td><td>✅ typed arrays (RFC 8746 tags)</td><td>✅ <code>Binary</code> vectors: int8, float32, packed bits</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>A free-form value in a typed schema</td><td>✅ <code>json</code>, <code>any</code> fields</td><td>— schemaless</td><td>✅ <code>{}</code> schema or <code>additionalProperties: true</code></td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>⚠️ <code>Struct</code> as raw <code>fields</code>/<code>Value</code> messages</td><td>✅ <code>google.protobuf.Struct</code> as <code>JsonObject</code></td><td>✅ <code>google.protobuf.Struct</code> as a plain object</td><td>❌ none (no <code>any</code> type)</td><td>❌ none</td><td>⚠️ FlexBuffers bytes in a <code>[ubyte]</code> field</td><td>⚠️ <code>AnyPointer</code>, cast by hand</td><td>❌ none</td><td>⚠️ <code>unknown</code>/<code>any</code> in JSON only (protobuf bans <code>any</code>)</td><td>❌ none</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— schemaless</td><td>— schemaless</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Schema evolution</strong></td></tr>
<tr><td>Add fields</td><td>✅ append at the end; trailing nulls trimmed</td><td>✅ no schema</td><td>✅ keyed JSON: add properties</td><td>✅ no schema</td><td>✅ no schema; keys travel</td><td>✅ no schema; keys in the header</td><td>✅ no schema; keys travel</td><td>✅ new tag numbers</td><td>✅ new tag numbers</td><td>✅ new tag numbers</td><td>✅ with <code>default</code>, via <code>createResolver</code></td><td>✅ new field ids; old readers skip them</td><td>✅ append fields or explicit <code>(id: n)</code></td><td>✅ new <code>@n</code> ordinals; old data reads defaults</td><td>✅ messages: new field indices</td><td>✅ JSON: names travel; protobuf: new <code>Sequence&lt;N&gt;</code></td><td>❌ new key shifts sorted positions</td><td>✅ no schema; keys travel</td><td>✅ no schema; keys travel</td><td>✅ no schema; keys travel</td><td>✅ no schema; keys travel</td><td>✅ no schema</td><td>✅ no schema</td></tr>
<tr><td>Rename a field</td><td>✅ positions travel; <code>aliases</code> in <code>resolve</code></td><td>❌ names travel</td><td>❌ names travel</td><td>❌ names travel</td><td>❌ names travel</td><td>❌ names travel</td><td>❌ names travel</td><td>✅ tag numbers travel, not names</td><td>✅ tag numbers travel, not names</td><td>✅ tag numbers travel, not names</td><td>✅ <code>aliases</code> in resolution; names not on wire</td><td>✅ field ids travel, names do not</td><td>✅ slots travel, names do not</td><td>✅ names do not travel</td><td>✅ indices and positions travel</td><td>⚠️ protobuf with <code>Sequence&lt;N&gt;</code>; JSON names travel</td><td>⚠️ positions travel, but sorted by key</td><td>❌ names travel</td><td>❌ names travel</td><td>❌ names travel (<code>keyMap</code> maps names to numbers)</td><td>❌ names travel</td><td>❌ names travel</td><td>❌ names travel</td></tr>
<tr><td>Reader and writer schema resolution</td><td>✅ <code>resolve(writer, reader)</code> (<code>./resolve</code>)</td><td>— schemaless</td><td>❌ none: decode is <code>JSON.parse</code></td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>⚠️ tag matching only; no resolver step</td><td>⚠️ tag matching only; no resolver step</td><td>⚠️ tag matching only; no resolver step</td><td>✅ <code>reader.createResolver(writer)</code>: aliases, defaults, promotions</td><td>⚠️ by field id; a mismatched type is skipped</td><td>❌ none; append-only rules instead</td><td>❌ none; layout rules instead</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— schemaless</td><td>— schemaless</td></tr>
<tr><td>Schema id or fingerprint</td><td>✅ <code>schema.id</code>, FNV-1a (32 or 64 bits) of the canonical form</td><td>— schemaless</td><td>❌ none (<code>$id</code> is a name)</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ <code>type.fingerprint()</code>: MD5 of canonical form</td><td>❌ none in JS</td><td>⚠️ 4-char <code>file_identifier</code>, set by hand</td><td>⚠️ 64-bit type ids, stable across versions</td><td>⚠️ <code>@opcode</code> 4-byte id, by hand</td><td>❌ none</td><td>❌ none</td><td>❌ none for shared structures</td><td>— no schema</td><td>❌ none for shared structures</td><td>— no schema</td><td>— schemaless</td><td>— schemaless</td></tr>
<tr><td>Registry or envelope with the schema id</td><td>✅ <code>SchemaRegistry</code>: <code>[id, payload]</code> (<code>./registry</code>)</td><td>— schemaless</td><td>❌ none</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>⚠️ <code>Any</code> type URL; Confluent via third party</td><td>⚠️ <code>Any</code> type URL; Confluent via <code>@confluentinc/schemaregistry</code></td><td>⚠️ <code>google.protobuf.Any</code> type URL only</td><td>⚠️ container files embed schema; registry third-party</td><td>❌ none (RPC envelope names the method)</td><td>⚠️ <code>file_identifier</code> in the buffer header</td><td>❌ segment framing carries no type id</td><td>❌ none (opcode written by hand)</td><td>❌ none</td><td>❌ none (README: add a <code>uint8</code> field by hand)</td><td>❌ record ids only; structures kept out of band</td><td>— no schema</td><td>❌ record ids only; structures kept out of band</td><td>— no schema</td><td>— schemaless</td><td>⚠️ shared symbol tables by name/version (<code>Catalog</code>)</td></tr>
<tr><td>Unknown fields from a newer writer</td><td>✅ trailing extras ignored, or rejected with <code>strict</code></td><td>— schemaless</td><td>✅ <code>JSON.parse</code> keeps them; encode drops undeclared</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>— schemaless</td><td>✅ dropped by default; <code>discardUnknown = false</code> keeps</td><td>✅ kept in <code>$unknown</code>, re-encoded</td><td>✅ dropped by default; <code>unknownFields=true</code> keeps</td><td>⚠️ skipped by the resolver; not kept</td><td>⚠️ skipped (<code>input.skip</code>), not kept</td><td>⚠️ ignored; lost on <code>unpack()</code> → <code>pack()</code></td><td>✅ kept in the buffer; <code>copyFrom</code> copies them</td><td>⚠️ ignored: skips to the message end</td><td>✅ ignored; <code>assertEquals</code> rejects, <code>assertPrune</code> strips</td><td>⚠️ trailing bytes ignored; no strict mode</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— no schema</td><td>— schemaless</td><td>— schemaless</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Decoding untrusted input</strong></td></tr>
<tr><td>Checks the payload on decode</td><td>✅ the wire checked by default</td><td>⚠️ syntax only: <code>SyntaxError</code><sup>27</sup></td><td>❌ no decoder: <code>JSON.parse</code> ignores the schema<sup>28</sup></td><td>❌ bad <code>meta</code> → raw <code>TypeError</code>, Invalid Date<sup>29</sup></td><td>⚠️ indices and tags checked; some raw errors<sup>30</sup></td><td>❌ none; raw errors or garbage<sup>31</sup></td><td>❌ none; <code>undefined</code> or raw errors<sup>32</sup></td><td>✅ bounds, wire types and UTF-8 checked</td><td>⚠️ bounds and UTF-8 checked; wire type ignored<sup>33</sup></td><td>✅ bounds and wire types checked; UTF-8 not</td><td>✅ <code>truncated buffer</code>, bad union/enum index</td><td>⚠️ <code>InputBufferUnderrunError</code>; wrong-type fields skipped<sup>34</sup></td><td>❌ no verifier in JS: garbage or defaults<sup>35</sup></td><td>⚠️ pointer and bounds checks; some raw RangeErrors<sup>36</sup></td><td>❌ no bounds checks: garbage or raw RangeError<sup>37</sup></td><td>✅ <code>json.assertParse</code>, <code>protobuf.assertDecode</code></td><td>❌ none; Node RangeErrors or garbage<sup>38</sup></td><td>⚠️ mostly <code>Error</code>s; some raw TypeErrors<sup>39</sup></td><td>✅ <code>DecodeError</code>, or <code>RangeError</code> on truncation</td><td>⚠️ mostly <code>Error</code>s; some raw TypeErrors<sup>40</sup></td><td>✅ <code>BSONError</code> on every corruption tried</td><td>⚠️ format only: one generic <code>Error</code><sup>41</sup></td><td>❌ truncated binary → <code>null</code> or wrong values<sup>42</sup></td></tr>
<tr><td>Errors with a path into the payload</td><td>✅ <code>DecodeError</code> with a path: <code>orders[1].sku</code></td><td>⚠️ position in the message</td><td>⚠️ <code>SyntaxError</code> position only</td><td>⚠️ <code>SyntaxError</code> position; <code>meta</code> errors none</td><td>⚠️ message only (<code>Invalid input</code>)</td><td>❌ raw engine errors</td><td>❌ raw engine errors</td><td>⚠️ message with byte offset; <code>verify</code> gives <code>orders.sku</code></td><td>⚠️ type and field name, no index</td><td>⚠️ message only (<code>premature EOF</code>)</td><td>⚠️ message only (<code>truncated buffer</code>)</td><td>❌ none; underrun error has no message</td><td>❌ no decode errors at all</td><td>⚠️ message with a pointer address, no field path</td><td>❌ raw errors, no path</td><td>✅ <code>TypeGuardError.path</code> (<code>$input.a[1].b</code>)</td><td>❌ raw Node errors</td><td>⚠️ message only, no path</td><td>⚠️ message only (byte offsets), no path</td><td>⚠️ message only, no path</td><td>⚠️ message only; some name the field</td><td>❌ no path or offset</td><td>⚠️ message only (<code>expected ',' or '}'</code>)</td></tr>
<tr><td>Deeply nested input</td><td>✅ stack overflow → <code>DecodeError</code>; <code>maxDepth</code> opt-in</td><td>⚠️ no limit: 1 000 000 levels parse<sup>43</sup></td><td>⚠️ decode is <code>JSON.parse</code>: no limit<sup>44</sup></td><td>❌ raw <code>RangeError</code> from a deep <code>meta</code> tree<sup>45</sup></td><td>❌ raw stack overflow at ~2,200 levels<sup>46</sup></td><td>✅ not recursive; 100 000 levels decode</td><td>❌ raw stack overflow at ~3,200 levels<sup>47</sup></td><td>✅ <code>recursionLimit</code> 100: <code>max depth exceeded</code></td><td>✅ <code>recursionLimit</code> 100 on <code>fromBinary</code>/<code>fromJson</code></td><td>✅ 100 levels on decode, hard-coded</td><td>❌ raw RangeError at 100 000 levels<sup>48</sup></td><td>✅ 64 levels (<code>DEFAULT_RECURSION_DEPTH</code>)</td><td>❌ object API <code>unpack()</code>: raw stack overflow<sup>49</sup></td><td>⚠️ lazy reads; deep copy → raw RangeError<sup>50</sup></td><td>❌ raw stack overflow (100 000 levels)</td><td>❌ recursive generated code: raw stack overflow<sup>51</sup></td><td>— no recursive types; depth fixed by schema</td><td>❌ raw RangeError at 100 000 levels<sup>52</sup></td><td>✅ iterative decoder: 100 000 levels decode</td><td>❌ raw RangeError at 100 000 levels<sup>53</sup></td><td>✅ iterative parser: 100 000 levels decode</td><td>❌ raw <code>RangeError</code> past ~4 150 levels<sup>54</sup></td><td>❌ raw RangeError at 100 000 levels<sup>55</sup></td></tr>
<tr><td><code>__proto__</code> keys</td><td>✅ keys from the schema; a dictionary's <code>__proto__</code> stays own</td><td>✅ own property, prototype untouched</td><td>✅ <code>JSON.parse</code> keeps an own key</td><td>⚠️ own key; a registered class's prototype replaced<sup>56</sup></td><td>✅ rejected (<code>__proto__</code> key throws)</td><td>❌ <code>__proto__</code> header key sets the prototype<sup>57</sup></td><td>❌ <code>__proto__</code> key sets the prototype<sup>58</sup></td><td>✅ <code>__proto__</code> map key becomes an own property</td><td>✅ own property (<code>setOwn</code>) in maps and Struct</td><td>❌ <code>__proto__</code> map key sets the prototype<sup>59</sup></td><td>❌ <code>map</code> key <code>__proto__</code> sets the prototype<sup>60</sup></td><td>✅ keys from the IDL; map <code>__proto__</code> stays a key</td><td>✅ keys from the schema</td><td>✅ keys from the schema</td><td>✅ keys from the schema</td><td>❌ protobuf <code>Record</code> key <code>__proto__</code> sets the prototype<sup>61</sup></td><td>✅ keys from the schema</td><td>✅ safe: <code>__proto__</code> renamed to <code>__proto_</code></td><td>✅ safe: <code>__proto__</code> key rejected (<code>DecodeError</code>)</td><td>✅ safe: <code>__proto__</code> renamed to <code>__proto_</code></td><td>✅ safe: own property via <code>defineProperty</code></td><td>✅ own property, prototype untouched</td><td>⚠️ <code>dom.Struct</code> safe; <code>toJSON()</code> sets the prototype<sup>62</sup></td></tr>
<tr><td>Size limits</td><td>⚠️ <code>maxLength</code> on streams, <code>maxDepth</code><sup>63</sup></td><td>❌ none (engine string limit only)</td><td>❌ none (<code>maxDepth</code> is the schema's)</td><td>❌ none</td><td>❌ no size or depth options<sup>64</sup></td><td>❌ none</td><td>❌ none; shared refs expand exponentially<sup>65</sup></td><td>⚠️ depth only (<code>Reader.recursionLimit</code>)<sup>66</sup></td><td>✅ <code>recursionLimit</code>; <code>readMaxBytes</code> 64 MiB on streams</td><td>⚠️ depth only (100, fixed)</td><td>❌ none<sup>67</sup></td><td>✅ depth 64; server frame <code>maxLength</code></td><td>❌ none (builder capped at 2 GB)</td><td>⚠️ 64 MiB traversal limit, not configurable<sup>68</sup></td><td>❌ none: 13 bytes → 10^8-element array<sup>69</sup></td><td>❌ none</td><td>❌ none; declared lengths trusted<sup>70</sup></td><td>⚠️ stream <code>maxIncompleteBufferSize</code> only<sup>71</sup></td><td>✅ <code>maxStrLength</code>, <code>maxBinLength</code>, <code>maxArrayLength</code>, <code>maxMapLength</code>, <code>maxExtLength</code></td><td>⚠️ <code>setSizeLimits</code>: array and map sizes (global)<sup>72</sup></td><td>❌ none (size header must match the buffer)</td><td>❌ none</td><td>❌ none</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Payloads and layouts</strong></td></tr>
<tr><td>Columnar layout for lists</td><td>✅ <code>layout: 'columns'</code> (and <code>flat</code>)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ row-major values after the header</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ row-wise only</td><td>❌ row-wise only</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ row-wise only</td></tr>
<tr><td>What an absent optional field costs</td><td>✅ <code>sparse</code>: a presence mask, nothing per absent field</td><td>✅ absent keys cost nothing</td><td>✅ absent keys omitted</td><td>✅ absent keys omitted</td><td>✅ nothing (keys omitted)</td><td>⚠️ <code>null</code> placeholder per absent field</td><td>✅ nothing (keys omitted)</td><td>✅ nothing: unset fields are omitted</td><td>✅ nothing: unset fields are omitted</td><td>✅ nothing: unset fields are omitted</td><td>⚠️ a byte each (null union branch)</td><td>✅ nothing (unset ids omitted)</td><td>⚠️ 2-byte vtable slot up to last present field</td><td>⚠️ fixed slots; packing squeezes zeros</td><td>✅ messages: absent fields cost nothing</td><td>✅ nothing: absent keys and tags omitted</td><td>❌ no absent fields</td><td>✅ nothing (key omitted)</td><td>✅ nothing (key omitted)</td><td>✅ nothing (key omitted)</td><td>✅ nothing (key omitted)</td><td>✅ absent keys cost nothing</td><td>✅ nothing (absent fields omitted)</td></tr>
<tr><td>Repeated strings or structures written once</td><td>✅ <code>intern</code>: a string table per message</td><td>❌ none</td><td>❌ none</td><td>⚠️ <code>dedupe: true</code> writes a shared object once</td><td>✅ equal values and references written once</td><td>✅ key header once per collection</td><td>✅ every value and key list stored once</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none (strings repeat)</td><td>❌ none</td><td>✅ <code>createSharedString</code>; vtables deduplicated</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ records: keys once per structure</td><td>❌ none (key cache is decode-side only)</td><td>✅ records + <code>pack</code> (packed CBOR, tag 51)</td><td>❌ none</td><td>⚠️ a shared object written once (back-reference)</td><td>✅ symbol tables (binary)</td></tr>
<tr><td>Delta encoding</td><td>✅ <code>delta</code> columns of differences</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none (zigzag <code>sint</code> is not delta)</td><td>❌ none (zigzag <code>sint</code> is not delta)</td><td>❌ none (zigzag <code>sint</code> is not delta)</td><td>❌ none</td><td>❌ none (Compact deltas field ids only)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr class="pa-matrix-group"><td colspan="24"><strong>Tooling</strong></td></tr>
<tr><td>Streaming decode</td><td>✅ NDJSON, TransformStreams, <code>parseItems</code> (<code>./stream</code>)</td><td>❌ none (NDJSON by hand)</td><td>❌ none</td><td>❌ none</td><td>❌ none (<code>stringifyAsync</code> awaits promises only)</td><td>❌ none</td><td>❌ none</td><td>⚠️ <code>encodeDelimited</code>/<code>decodeDelimited</code> only</td><td>✅ <code>sizeDelimitedDecodeStream</code> (async iterable)</td><td>⚠️ <code>useAsyncIterable</code> transforms; no framing</td><td>✅ <code>BlockDecoder</code>, <code>RawDecoder</code> (Node streams)</td><td>⚠️ framed/buffered transports (length-prefixed)</td><td>⚠️ size-prefixed buffers (<code>finishSizePrefixed</code>) only</td><td>❌ no stream reader (segment framing only)</td><td>⚠️ length-prefixed messages and unions only</td><td>❌ none</td><td>❌ none</td><td>✅ <code>UnpackrStream</code>, <code>decodeIter</code> (Node streams)</td><td>✅ <code>decodeMultiStream</code>, <code>decodeArrayStream</code>, <code>decodeAsync</code></td><td>✅ <code>DecoderStream</code>, <code>decodeIter</code>, <code>encodeAsAsyncIterable</code></td><td>⚠️ <code>deserializeStream</code> over one buffer only</td><td>❌ none</td><td>⚠️ <code>Reader</code> steps through values; whole input in memory</td></tr>
<tr><td>Code generated ahead of time</td><td>✅ <code>toSource</code>: standalone modules (<code>./standalone</code>)</td><td>— nothing to compile</td><td>✅ <code>mode: 'standalone'</code> writes a CJS module</td><td>— nothing to compile</td><td>— nothing to compile</td><td>— nothing to compile</td><td>— nothing to compile</td><td>✅ <code>pbjs -t static-module</code> + <code>pbts</code></td><td>✅ <code>protoc-gen-es</code>: embedded descriptor + types</td><td>✅ generated <code>.ts</code> per <code>.proto</code></td><td>❌ runtime <code>new Function</code> only</td><td>✅ <code>thrift --gen js:node</code></td><td>✅ <code>flatc --ts</code> (<code>--gen-object-api</code>)</td><td>✅ <code>capnp-es</code> plugin writes .js, .ts, .d.ts</td><td>✅ <code>bebopc</code> writes TS</td><td>✅ the ttsc transform inlines codecs at build</td><td>❌ runtime compile only</td><td>— nothing to compile</td><td>— nothing to compile</td><td>— nothing to compile</td><td>— nothing to compile</td><td>— nothing to compile</td><td>— nothing to compile</td></tr>
<tr><td>CLI</td><td>✅ <code>protoarray compile</code></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ <code>pbjs</code>, <code>pbts</code> (protobufjs-cli)</td><td>✅ <code>protoc-gen-es</code> plugin via <code>buf</code>/<code>protoc</code></td><td>✅ <code>protoc-gen-ts_proto</code> plugin via <code>protoc</code>/<code>buf</code></td><td>❌ none</td><td>✅ <code>thrift</code> compiler (native, separate install)</td><td>✅ <code>flatc</code> (native binary, not on npm)</td><td>✅ <code>capnp-es</code> (shells out to C++ <code>capnpc</code>)</td><td>✅ <code>bebopc</code> (npm <code>bebop-tools</code>)</td><td>✅ <code>ttsc</code> / <code>ttsx</code> (official peer, samchon/ttsc)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ <code>ion</code> (amazon-ion/ion-cli, Rust)</td></tr>
</tbody>
</table>

</div>

✅ built in, or in an official package of the same project (named) · ⚠️ partial, opt-in, with a caveat, or through a third-party package (named) · ❌ not built in · 🔜 planned by the maintainers, no code yet · — does not apply. Every cell was checked against the source of the published package in October 2026.

1. capnp-es is the maintained fork (unjs) of capnp-ts; its README calls it alpha quality. capnp-ts itself was revived in 2026 (0.9.3).
2. The browser builds in <code>etc/browser/</code> still <code>require('buffer')</code>, <code>util</code> and <code>stream</code>; the README assumes browserify. It cannot run where <code>new Function</code> is blocked (see noEval).
3. The <code>browser</code> field maps to lib/nodejs/lib/thrift/browser.js, which still requires <code>util</code> (thrift.js) and uses <code>Buffer</code> in every protocol; the README suggests webpack.
4. <code>require('buffer').Buffer</code> (schemapack.js:6); the README relies on browserify/webpack 4 adding the shim, which webpack 5 no longer does.
5. <code>index.js:470</code> compiles every serializer (EvalError in a realm without code generation). A <code>mode: 'standalone'</code> module runs there, but <code>anyOf</code>/<code>oneOf</code>/<code>if</code> also need <code>inlineValidators: true</code> or Ajv compiles at runtime.
6. <code>Type.encode/decode/verify</code> and the message constructor are compiled by <code>util.codegen</code> (<code>src/util/codegen.js:53,55</code>, <code>Function(source)</code>); with <code>--disallow-code-generation-from-strings</code> reflection throws <code>EvalError</code>, while a <code>pbjs -t static-module</code> file on <code>protobufjs/minimal</code> runs.
7. lib/types.js:732 (every type's branch constructor), 2200, 2275, 2295, 2310, 2342, 2434 (record constructor, checker, reader, skipper, writer, resolver). Under <code>node --disallow-code-generation-from-strings</code> even <code>require('avsc')</code> throws EvalError (lib/containers.js:26 builds a type at load). No no-eval mode exists.
8. schemapack.js:375-376; under <code>--disallow-code-generation-from-strings</code> <code>build</code> throws EvalError (tested).
9. From the 4th read of a record structure the reader is compiled with <code>new Function</code> (<code>unpack.js:501</code>), also by the default <code>unpack</code> on a payload that defines records in-message. A throw is caught and code generation is switched off for the process (still a CSP violation report). <code>msgpackr/index-no-eval</code> (a UMD build, <code>dist/index-no-eval.cjs</code>) never calls it.
10. <code>decode.js:47</code> runs <code>new Function('')</code> when the module loads (a CSP report even if records are never used) and compiles record readers from the 4th read (<code>decode.js:532</code>). If the probe throws, records use the slow path. <code>cbor-x/index-no-eval</code> never calls it.
11. The README's security notice: schemas are compiled into code, so a schema from a peer is not safe to build.
12. protoarray's encode trusts its values and checks only what the wire is built from (shapes, a union's discriminator, a list of differences); validating the values is metaschema's, on the same definition, so its cost is opt-in.
13. Only <code>required</code> and array shapes throw. <code>pattern</code>, <code>minimum</code>, <code>enum</code> and <code>format</code> are ignored, <code>'false'</code> in a boolean → <code>true</code>, and a <code>const</code> field writes the constant whatever the value.
14. <code>toBinary</code> throws on <code>"abc"</code>, <code>3.7</code> or 2^40 in an int32 (<code>cannot encode field t.Msg.age to binary: invalid int32: 3.7</code>) but writes a number in a string field as <code>"42"</code>; <code>create()</code> checks nothing; <code>reflect().set</code> type-checks; rule validation is the separate <code>@bufbuild/protovalidate</code>.
15. <code>encode</code> throws on <code>"abc"</code> or <code>3.7</code> in an int32 (<code>invalid int32: NaN</code>) but writes a number in a string field as <code>"42"</code>; <code>fromJSON</code> coerces (<code>age: "abc"</code> → <code>NaN</code>).
16. Generated <code>write()</code> calls <code>output.writeI32(this.x)</code> unchecked (binary.js <code>writeI32</code> uses bit operations; 1.7 → 1). Required fields are checked only by the constructor when <code>args</code> is given; <code>writeString(42)</code> throws.
17. Tested: <code>"abc"</code> in a <code>short</code> reads back 0, 70000 reads back 4464, 1.9 reads 1. Only <code>(required)</code> presence is checked, by <code>builder.requiredField</code> in the generated <code>endX()</code>.
18. Tested: an object in a Text field is stored as <code>"[object Object]"</code>, <code>null</code> as <code>"null"</code>; an Int64 setter throws a raw TypeError for a number.
19. Tested on the generated-code shape: a missing struct field writes 0, a number in a string field writes <code>""</code>, <code>null</code> throws a raw TypeError. The dynamic <code>RecordWriter</code> checks shapes, enums and missing fields, not scalar types.
20. <code>build(schema, false)</code> drops them: a string in a <code>uint8</code> field then encodes as 0. With checks on, 3.7 in an int field becomes 3, NaN passes float checks, a missing string throws Node's ERR_INVALID_ARG_TYPE.
21. <code>uneval</code> writes JavaScript source text instead. The README lists stability of the format between devalue versions as a non-goal.
22. README lists human-readable output as a non-goal: <code>{a:'x'}</code> travels as <code>[{"a":1},"x"]</code>.
23. No port found; the format is not specified and may change between versions (README non-goals).
24. Python in the same repo (PyPI <code>compress-json-python</code>); PHP and Rust are third-party (README).
25. Ordinary typed arrays serialize their whole backing <code>ArrayBuffer</code>, bytes outside a <code>subarray</code> included (README); Node Buffers are copied first (src/operations.js:83).
26. undefined, null and a missing key travel as null and decode as null (or the default): every key of the schema is present after decode.
27. Any well-formed value comes back; checking its shape is left to the program.
28. Validate with Ajv (already a dependency) against the same schema.
29. <code>5</code> annotated <code>map</code> throws <code>TypeError: number 5 is not iterable</code>; a garbage <code>Date</code> string becomes Invalid Date; the text <code>null</code> throws a destructuring <code>TypeError</code>.
30. Bad indices and unknown tags throw <code>Error('Invalid input')</code>/<code>Unknown type</code>, but <code>["BigInt","abc"]</code>, <code>["RegExp","("]</code>, <code>["URL","x"]</code> throw raw SyntaxError/TypeError, <code>Temporal.*</code> tags throw ReferenceError on Node 24, and <code>["Date",5]</code> is accepted as a Date.
31. A row missing a value throws <code>RangeError: Invalid array length</code>; <code>unpack('abc')</code> returns <code>[]</code>, a string key count returns <code>[ &lt;1 empty item&gt; ]</code>, <code>null</code> throws a TypeError.
32. Out-of-range or invalid refs decode to <code>undefined</code> silently, a self-reference overflows the stack, <code>decompress(null)</code> throws <code>c is not iterable</code>.
33. Truncation throws <code>RangeError: premature EOF</code>; but a known scalar field is read by its schema type whatever wire type arrives (<code>dist/esm/from-binary.js:168-183</code>): an int32 writer's <code>08 02 10 03</code> decodes as <code>name: "\u0010\u0003"</code>, <code>age: 0</code>, silently.
34. Truncation, negative sizes and bad type ids (<code>Invalid type: 127</code>) are errors; a missing required field is not (it reads as <code>null</code>).
35. Tested: a buffer cut in half decodes to <code>{ hp: 0, name: "" }</code>, an out-of-bounds root offset to all defaults, no error. <code>ByteBuffer</code> reads <code>bytes_[i]</code> without bounds checks (<code>ts/byte-buffer.ts</code>); the C++ <code>Verifier</code> is not ported.
36. Library errors (<code>CAPNP-TS019</code>, <code>TS024</code>) for bad pointers, but an empty buffer and a huge Text length throw raw <code>RangeError</code>s, and the frame header is trusted before its size check (see limits).
37. Tested: a truncated buffer throws DataView <code>RangeError</code>; a string length past the end decodes to <code>"A\u0000"</code>.
38. A truncated buffer throws Node's ERR_OUT_OF_RANGE or silently shortens the last string; a <code>buffer</code> field whose length prefix exceeds the payload returns stale process memory (<code>allocUnsafe</code>, schemapack.js:86; tested).
39. Truncation gives "Unexpected end of MessagePack data". In 3 000 random byte mutations 1–5% escaped as raw TypeError/RangeError/SyntaxError (e.g. <code>read(...).map is not a function</code>, a pointer ext without a reference map); the reserved byte 0xC1 decodes to a <code>C1</code> sentinel object instead of an error.
40. Truncation gives "Unexpected end of CBOR data". In 3 000 random byte mutations 5–7% escaped as raw TypeError/RangeError (e.g. "Cannot create property 'slowReads' on string", "byte length of Float32Array should be a multiple of 4"); a record key that is a BigInt reaches <code>JSON.stringify</code> and throws a TypeError.
41. Truncated, garbage and huge-length inputs all throw <code>Unable to deserialize cloned data.</code>; there is no shape to check.
42. IonSpan.js:165-170 returns EOF (-1) past the end instead of throwing: a 55-byte value cut to 13-27 bytes loads as <code>null</code>, cut to 52 bytes loads with a different timestamp. The text parser rejects truncated input.
43. V8's <code>JSON.parse</code> does not recurse, but <code>JSON.stringify</code> of the result throws <code>RangeError</code> past ~6 200 levels, as may any recursive consumer.
44. <code>maxDepth</code> (default 100) limits the schema, not data; encoding a 100 000-deep recursive value throws a raw <code>RangeError</code>.
45. Deep <code>json</code> alone parses (<code>JSON.parse</code>); a 100 000-deep <code>meta.values</code> tree overflows the recursive <code>traverse</code> (<code>dist/plainer.js:8</code>).
46. <code>hydrate</code> (src/parse.js:71) recurses: a 14 KB flat payload of ~2,200 nested arrays (Node 24 default stack) throws a raw <code>RangeError: Maximum call stack size exceeded</code>; <code>stringify</code> and <code>uneval</code> overflow too on deep values.
47. <code>decode</code> ↔ <code>decodeArray</code>/<code>decodeObject</code> recurse (dist/core.js:16-51); a chain of ~3,200 nested arrays throws a raw RangeError on Node 24.
48. A 100 001-byte recursive list throws <code>Maximum call stack size exceeded</code> from <code>fromBuffer</code>; <code>toBuffer</code>/<code>isValid</code> of a deep or cyclic value overflow the same way.
49. Accessors are lazy and do not recurse, but generated <code>unpack()</code> does: a 100 000-deep chain throws <code>RangeError</code>, and a crafted negative uoffset (accepted: <code>readInt32</code> is signed) makes a cycle that overflows too.
50. Reads do not recurse and the traversal limit stops a pointer cycle (<code>CAPNP-TS022</code>), but the nesting limit defaults to <code>MAX_INT32</code>: <code>setRoot</code>/<code>copyFrom</code> of a 100 000-deep message overflows the stack.
51. Not run through the transform (it needs ttsc): a decoder transcribed from <code>ProtobufDecodeProgrammer.go</code> overflows at 100 000 levels; no depth option exists.
52. Recursive <code>read()</code> with no depth limit. <code>checkedRead</code> marks any RangeError <code>incomplete</code> (<code>unpack.js:225</code>), so <code>UnpackrStream</code> treats a deep message as a partial one: it emits nothing, buffers, and stalls until <code>maxIncompleteBufferSize</code> (64 MB) is exceeded. <code>pack</code> of a deep value also overflows.
53. Recursive <code>read()</code> with no depth limit. <code>checkedRead</code> marks any RangeError <code>incomplete</code> (<code>decode.js:239</code>), so <code>DecoderStream</code> treats a deep message as a partial one: it emits nothing and keeps buffering, with no size cap. <code>encode</code> of a deep value also overflows.
54. Measured on a hand-built nested array with the default stack; <code>v8.serialize</code> itself throws <code>RangeError</code> past ~3 280 levels.
55. <code>load</code> of 100 000 nested lists or s-expressions, and <code>dumpText</code>/<code>dumpBinary</code> of a deep or cyclic value, throw <code>Maximum call stack size exceeded</code>. The raw <code>Reader</code> cursor steps in 100 000 levels fine.
56. Plain objects are safe and <code>meta</code> paths through <code>__proto__</code> are rejected, but a value typed as a registered class is built with <code>Object.assign</code> (<code>dist/transformer.js:138</code>), whose <code>__proto__</code> setter replaces the instance's prototype.
57. <code>o[hlist[++ki]] = hlist[i++]</code> on a literal <code>{}</code> (js/jsonh.js:64): <code>[1,"__proto__",{"isAdmin":true}]</code> decodes to a record that inherits <code>isAdmin</code> (tested).
58. <code>o[k] = v</code> on a literal <code>{}</code> (dist/core.js:33): a payload with key <code>__proto__</code> yields an object that inherits the attacker's properties (tested).
59. Binary decode assigns map entries with <code>obj[key] = value</code> (<code>build/src/main.js:1223</code>): a <code>map&lt;string, Item&gt;</code> entry keyed <code>__proto__</code> makes the decoded map inherit from the attacker's message; Struct keys hit the same path (with <code>useMapType</code> the decoded Struct object's prototype is replaced). <code>fromJSON</code> uses <code>defineProperty</code> and is safe.
60. lib/types.js:1833-1838 assigns <code>val[key]</code> on <code>{}</code>: the key disappears and the decoded map inherits the payload's object (same in <code>fromString</code>). No global pollution.
61. Generated decode assigns <code>output[entry.key] = entry.value</code> on <code>{}</code> (<code>native/core/programmers/protobuf/ProtobufDecodeProgrammer.go:379-397</code>); reproduced with the real <code>_ProtobufReader</code>. The JSON path parses with <code>JSON.parse</code> and is safe.
62. Fields live in <code>Object.create(null)</code> (dom/Struct.js:10), so <code>get('__proto__')</code> works and nothing global is touched. <code>toJSON()</code> copies them onto <code>Object.create(Struct.prototype)</code> with <code>obj[key] =</code>: <code>__proto__</code> replaces the prototype and the fields after it vanish (<code>JSON.stringify</code> gives <code>{}</code>).
63. parse reads a whole text with JSON.parse, so the text a program accepts is its own limit; the stream parsers hold at most maxLength characters of one item (16 MiB by default).
64. A sparse array's declared length is not allocated (src/operations.js:181), so <code>[[-7,4294967295]]</code> is cheap.
65. A 171-byte payload of arrays that each reference the previous one twice decompresses to 6.3 MB of JSON (20 levels); each level doubles it.
66. No message, string or array size limits.
67. A 4-byte payload decodes into an array of 1 000 000 nulls (<code>array&lt;null&gt;</code> with a count only).
68. It counts pointer objects per Message, so one legit Message re-read ~4.2 M times throws. The segment count in the frame header is allocated (<code>Array.from</code>, <code>BlZmb8ia.mjs:818</code>) before it is checked: 8 bytes claiming 2^32-1 segments start a multi-billion-element allocation.
69. A <code>bool[]</code> length prefix is trusted: 13 bytes decoded into a 100 000 000-element array in 1.2 s (up to 2^32 possible).
70. A 4-byte payload for a <code>buffer</code> field yields a 268 MB Buffer.
71. Array/map lengths are checked against the remaining bytes (no allocation from a small header), but there is no option for string, array, map or depth limits.
72. Process-wide, not per decoder; defaults 112 810 000 / 16 810 000. <code>maxObjectSize</code>, documented in the README, is never read by the decoder, record objects bypass <code>maxMapSize</code>, and there is no string or depth limit.

<!-- comparison:end -->

## Exports

```js
const {
  Schema,
  encode, decode, stringify, parse, encodeEach, decodeEach,
  SchemaDefinitionError, EncodeError, DecodeError,
} = require('@alexify/protoarray');
const { resolve } = require('@alexify/protoarray/resolve');
const { SchemaRegistry } = require('@alexify/protoarray/registry');
const { parseLines, parseItems /* … */ } = require('@alexify/protoarray/stream');
const { toSource } = require('@alexify/protoarray/standalone');
const { compatible, baseline, restore } = require('@alexify/protoarray/evolve');
const { toBinary, fromBinary } = require('@alexify/protoarray/binary');
```

```ts
import { Schema, type Decoded, type Snapshot } from '@alexify/protoarray';
```

The [API reference](https://protoarray.vercel.app/api/exports) lists every member.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
