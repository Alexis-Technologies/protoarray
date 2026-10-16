# protoarray

[![npm](https://img.shields.io/npm/v/%40alexify%2Fprotoarray)](https://www.npmjs.com/package/@alexify/protoarray)
[![CI](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fprotoarray)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-protoarray)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://protoarray.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fprotoarray)](./LICENSE)

**Compact positional payloads for JavaScript.** Send objects as positional arrays and let a schema
shared by the client and the server map every position back to its key. A fast, zero-dependency
alternative to Protocol Buffers for Node.js and browsers: smaller than JSON, faster than JSON, and
still JSON. Schemas are [`@alexify/metaschema`](https://metaschema.vercel.app/)'s: one definition
validates with metaschema and travels with protoarray.

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

// The client: protoarray alone, about 21 KB
const User = Schema.from(await (await fetch('/schemas/user')).json());
```

### 📖 [Read the documentation →](https://protoarray.vercel.app/)

## Why protoarray

- **Smaller payloads.** Keys are not repeated in every message, only the values travel: about 45%
  fewer bytes on a typical record before compression, and still 5–35% fewer after gzip depending
  on the message size.
- **Faster than JSON.** A positional array is less work for `JSON.parse` and `JSON.stringify`,
  and the object is rebuilt by generated code with one hidden class per schema: ×1.5 encode and
  ×1.7 decode on a typical record. It encodes faster than every binary codec in JavaScript and
  decodes ahead of protobufjs and @msgpack/msgpack; msgpackr with shared structures and avsc
  decode records faster (see [benchmarks](#benchmarks)).
- **Still JSON.** The payload is a plain JSON array, so it goes through any transport and storage
  that already handle JSON, compresses with gzip, brotli and zstd like JSON, and stays readable in
  logs.
- **One schema, two jobs.** No `.proto` files, no compiler, no generated files: a schema is a
  [metaschema](https://metaschema.vercel.app/) definition, a plain JavaScript value. metaschema
  validates the values with it, protoarray carries them, and both read a reference, an optional
  field or a stored entity's id the same way.
- **Evolves safely.** Append fields at the end and old and new versions keep understanding each
  other; a fingerprint (`schema.id`) tells versions apart in a handshake. For changes that break
  the rules, `resolve` reads and writes another version by name, Avro-style, and a registry
  wraps payloads as `[id, payload]`.
- **Typed.** A schema takes its TypeScript types from the metaschema schema it is built from;
  hand-written typings for TypeScript 5.0 or newer.
- **Zero dependencies, about 21 KB min+gzip.** protoarray requires nothing, metaschema included:
  it recognises a metaschema schema by its brand and reads its snapshot, and takes the metaschema
  module as an option (`{ metaschema }`) only to read a raw definition. CommonJS with ESM named
  imports, no build step, one package for Node.js 18+ and browsers; the registry, resolve,
  streaming and standalone extras are subpaths of 1.8–2.5 KB each. Generated code where the
  runtime allows it, and under a strict CSP or on edge runtimes either a closures fallback or a
  standalone module generated at build time.

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
| Standalone modules | `protoarray compile` writes the generated code of your schemas into a module, for a strict CSP and edge runtimes, with no metaschema at runtime (`@alexify/protoarray/standalone`) |
| Validation | the wire on decode by default: `DecodeError` with codes, paths like `orders[1].sku` and the schema name; the values before encode with metaschema's `check` and `parse` |
| Evolution | append-only positions; `{ strict: true }` rejects elements beyond the schema; `schema.id` or your own `fingerprint` tells versions apart |

See the [guide](https://protoarray.vercel.app/guide/schema) for every form, and
[Migrating from 1.x](https://protoarray.vercel.app/guide/migrating-from-1) for the upgrade: the
wire did not change.

## Benchmarks

`pnpm bench:compare` runs the same payloads through JSON, protoarray and the usual JavaScript
codecs, in a fresh process per pair, after proving the round trip. Speed is end to end: object to
text or bytes and back.

<!-- bench:compare:start -->

**single** — one record: 10 fields, nested address, tags, 2 orders

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,417,812 (×1.00) | 982,136 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,082,841 (×1.47) | 1,726,288 (×1.76) | 135 | 134 | 110 |
| protobufjs | 1,383,211 (×0.98) | 1,495,901 (×1.52) | 115 | 127 | 117 |
| avsc | 1,656,205 (×1.17) | 1,851,547 (×1.89) | 97 | 111 | 101 |
| msgpackr (records, shared structures) | 1,465,051 (×1.03) | 2,728,598 (×2.78) | 108 | 124 | 112 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,552 (×1.00) | 912 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 2,003 (×1.29) | 1,515 (×1.66) | 140,738 | 30,666 | 26,946 |
| protobufjs | 1,328 (×0.86) | 1,412 (×1.55) | 120,459 | 31,414 | 28,985 |
| avsc | 1,364 (×0.88) | 1,823 (×2.00) | 101,839 | 29,895 | 27,334 |
| msgpackr (records, shared structures) | 1,502 (×0.97) | 3,001 (×3.29) | 112,274 | 30,957 | 28,370 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-16. Median of 5 rounds in a fresh process per library and scenario (the spread of the rounds is in bench/results/compare.json); bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

<!-- bench:compare:end -->

protoarray is the fastest text codec on records and strings. Binary codecs win on payloads that
are mostly numbers (doubles print as long decimal strings), and msgpackr with shared structures
decodes small records faster; the full tables, including those, are in the
[benchmarks page](https://protoarray.vercel.app/guide/benchmarks).

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
```

```ts
import { Schema, type Decoded, type Snapshot } from '@alexify/protoarray';
```

The [API reference](https://protoarray.vercel.app/api/exports) lists every member.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
