# protoarray

[![npm](https://img.shields.io/npm/v/%40alexify%2Fprotoarray)](https://www.npmjs.com/package/@alexify/protoarray)
[![CI](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fprotoarray)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-protoarray)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://protoarray.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fprotoarray)](./LICENSE)

**Compact positional payloads for JavaScript.** Send objects as positional arrays and let a schema
shared by the client and the server map every position back to its key. A zero-dependency
alternative to Protocol Buffers for Node.js and browsers: smaller than JSON, faster than JSON, and
still JSON.

```js
const { Schema } = require('@alexify/protoarray');

const User = new Schema('User', {
  id: 'number',
  name: 'string',
  role: { enum: ['admin', 'editor', 'viewer'] },
  address: { city: 'string', zip: '?string' },
  tags: { array: 'string' },
  email: '?string',
});

User.encode({ id: 1, name: 'Alex', role: 'editor', address: { city: 'Kyiv' }, tags: ['a'] });
// [1, 'Alex', 1, ['Kyiv'], ['a']]

User.decode([1, 'Alex', 1, ['Kyiv'], ['a']]);
// { id: 1, name: 'Alex', role: 'editor', address: { city: 'Kyiv', zip: null }, tags: ['a'], email: null }

User.stringify(user); // '[1,"Alex",1,["Kyiv"],["a"]]'  — JSON.stringify of the array
User.parse(text);     // the object back, validated
```

Both sides share the schema, so the keys never travel: position `0` is `id`, position `1` is
`name`, and so on. The enum travels as its index, missing optional fields as `null`, and trailing
`null`s are trimmed.

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
- **No toolchain.** No `.proto` files, no compiler, no generated files. A schema is a plain
  JavaScript value, in the same DSL as [`@alexify/metaschema`](https://metaschema.vercel.app/).
- **Evolves safely.** Append fields at the end and old and new versions keep understanding each
  other; a fingerprint (`schema.id`) tells versions apart in a handshake. For changes that break
  the rules, `Schema.resolve` reads and writes another version by name, Avro-style, and a registry
  wraps payloads as `[id, payload]`.
- **Typed.** Hand-written TypeScript typings (5.0 or newer) infer the object type from the
  definition literal.
- **Zero dependencies, about 20 KB min+gzip.** CommonJS with ESM named imports, no build step, one
  package for Node.js 18+ and browsers; the registry, streaming, metaschema and standalone extras
  are subpaths of 0.4–2 KB each. Generated code where the runtime allows it, and under a strict CSP
  or on edge runtimes either a closures fallback or a standalone module generated at build time.

## Installation

```bash
pnpm add @alexify/protoarray
# or
npm install @alexify/protoarray
```

Requires Node.js 18 or newer. Works in browsers through any bundler.

## Features

| Feature | How |
| --- | --- |
| Scalars | `'string'`, `'number'`, `'integer'`, `'boolean'`, `'bigint'`, `'date'` (epoch ms on the wire), `'bytes'` (base64), `'json'`, `'any'`, `'unknown'` (anything), `'null'` |
| Optional fields | `'?string'`, `'email?': 'string'` or `{ type: 'string', required: false }`; missing ones decode as `null` |
| Defaults | `{ type: 'number', default: 0 }` fills a missing slot on decode |
| Nested records | `address: { city: 'string' }` → a nested array |
| Collections | `{ array: 'string' }` travels as is; `{ array: Record }` becomes an array of arrays; `User.list`; `{ set }`, `{ map }` and `{ object }` dictionaries; tuples of any elements |
| Compact types | `{ enum: [...] }` → index, `{ flags: [...] }` → bitmask, `{ type: 'number', decimals: 2 }` → scaled integer, `'bytes'` → base64, `['number', 'number']` tuples |
| Unions | `{ union: [Call, Event], discriminator: 'type' }` → `[tag, ...fields]`, metaschema's discriminated union |
| Sparse records | `{ sparse: true }` → `[mask, ...present values]` for records with many optional fields |
| Layouts | `{ layout: 'flat' }` (one array, fixed stride) or `'columns'` (transposed, best for compression) |
| Delta and interning | `delta: true` writes integers as differences (a columns field, or a list); `intern: true` writes strings of few values as indexes into one table per message |
| Migrations | `Schema.resolve(writer, reader)` reads and writes another version by name, with `aliases`; `SchemaRegistry` keeps versions by id and wraps payloads as `[id, payload]` |
| Streaming | `encodeEach`/`decodeEach`; NDJSON, `TransformStream`s and the items of a large array read as they arrive (`@alexify/protoarray/stream`) |
| metaschema | one definition for both libraries; a translator from a metaschema `Schema` or `Model` and custom types for `bytes` and `flags` (`@alexify/protoarray/metaschema`) |
| Standalone modules | `protoarray compile` writes the generated code of your schemas into a module, for a strict CSP and edge runtimes (`@alexify/protoarray/standalone`) |
| References | a `Schema` by value, or by name (`'User'`) through `schemas` and for recursion; it keeps its own options and layout |
| Validation | the wire on decode by default, the values on encode with `{ validate: 'both' }`: `EncodeError` and `DecodeError` with codes, paths like `orders[1].sku` and the schema name; `schema.check(value)` returns the error or `null` |
| Evolution | append-only positions; `{ strict: true }` rejects elements beyond the schema; `schema.id` or your own `fingerprint` tells versions apart |

See the [guide](https://protoarray.vercel.app/guide/schema) for every form.

## Benchmarks

`pnpm bench:compare` runs the same payloads through JSON, protoarray and the usual JavaScript
codecs, in a fresh process per pair, after proving the round trip. Speed is end to end: object to
text or bytes and back.

<!-- bench:compare:start -->

**single** — one record: 10 fields, nested address, tags, 2 orders

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,396,349 (×1.00) | 954,196 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,053,665 (×1.47) | 1,678,585 (×1.76) | 135 | 134 | 110 |
| protobufjs | 1,376,940 (×0.99) | 1,461,801 (×1.53) | 115 | 127 | 117 |
| avsc | 1,745,837 (×1.25) | 1,821,063 (×1.91) | 97 | 111 | 101 |
| msgpackr (records, shared structures) | 1,480,975 (×1.06) | 2,676,271 (×2.80) | 108 | 124 | 112 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,457 (×1.00) | 913 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 1,999 (×1.37) | 1,512 (×1.66) | 140,738 | 30,666 | 26,946 |
| protobufjs | 1,302 (×0.89) | 1,390 (×1.52) | 120,459 | 31,414 | 28,985 |
| avsc | 1,376 (×0.94) | 1,806 (×1.98) | 101,839 | 29,895 | 27,334 |
| msgpackr (records, shared structures) | 1,564 (×1.07) | 2,868 (×3.14) | 112,274 | 30,957 | 28,370 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-15. Median of 5 rounds in a fresh process per library and scenario (the spread of the rounds is in bench/results/compare.json); bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

<!-- bench:compare:end -->

protoarray is the fastest text codec on records and strings. Binary codecs win on payloads that
are mostly numbers (doubles print as long decimal strings), and msgpackr with shared structures
decodes small records faster; the full tables, including those, are in the
[benchmarks page](https://protoarray.vercel.app/guide/benchmarks).

## Exports

```js
const {
  Schema,
  encode, decode, stringify, parse, check, encodeEach, decodeEach,
  SchemaDefinitionError, EncodeError, DecodeError,
} = require('@alexify/protoarray');
const { SchemaRegistry } = require('@alexify/protoarray/registry');
const { parseLines, parseItems /* … */ } = require('@alexify/protoarray/stream');
const { fromMetaschema, fromModel, types } = require('@alexify/protoarray/metaschema');
const { toSource } = require('@alexify/protoarray/standalone');
```

```js
import { Schema, type Infer, type Input } from '@alexify/protoarray';
```

The [API reference](https://protoarray.vercel.app/api/exports) lists every member.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
