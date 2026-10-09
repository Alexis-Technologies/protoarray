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
  ×1.7 decode on a typical record, ahead of protobufjs, msgpackr and @msgpack/msgpack in
  JavaScript (see [benchmarks](#benchmarks)).
- **Still JSON.** The payload is a plain JSON array, so it goes through any transport and storage
  that already handle JSON, compresses with gzip, brotli and zstd like JSON, and stays readable in
  logs.
- **No toolchain.** No `.proto` files, no compiler, no generated files. A schema is a plain
  JavaScript value, in the same DSL as [`@alexify/metaschema`](https://metaschema.vercel.app/).
- **Evolves safely.** Append fields at the end and old and new versions keep understanding each
  other; a fingerprint (`schema.id`) tells versions apart in a handshake.
- **Typed.** Hand-written TypeScript typings infer the object type from the definition literal.
- **Zero dependencies, about 7 KB min+gzip.** CommonJS with ESM named imports, no build step, one
  package for Node.js 18+ and browsers. Generated code where the runtime allows it, a closures
  fallback under a strict CSP or on edge runtimes.

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
| Scalars | `'string'`, `'number'`, `'boolean'`, `'bigint'`, `'date'` (epoch ms on the wire), `'json'` (anything) |
| Optional fields | `'?string'`, `'email?': 'string'` or `{ type: 'string', required: false }`; missing ones decode as `null` |
| Defaults | `{ type: 'number', default: 0 }` fills a missing slot on decode |
| Nested records | `address: { city: 'string' }` → a nested array |
| Collections | `{ array: 'string' }` travels as is; `{ array: Record }` becomes an array of arrays; `User.list` |
| Compact types | `{ enum: [...] }` → index, `{ flags: [...] }` → bitmask, `['number', 'number']` tuples |
| Sparse records | `{ sparse: true }` → `[mask, ...present values]` for records with many optional fields |
| Layouts | `{ layout: 'flat' }` (one array, fixed stride) or `'columns'` (transposed, best for compression) |
| References | a `Schema` by value, or by name (`'User'`) through `schemas` and for recursion |
| Validation | on by default on decode, with `DecodeError` codes and paths like `orders[1].sku` |
| Evolution | append-only positions; `{ strict: true }` rejects elements beyond the schema |

See the [guide](https://protoarray.vercel.app/guide/schema) for every form.

## Benchmarks

`pnpm bench:compare` runs the same payloads through JSON, protoarray and the usual JavaScript
codecs, in a fresh process per pair, after proving the round trip. Speed is end to end: object to
text or bytes and back.

<!-- bench:compare:start -->

**single** — one record: 10 fields, nested address, tags, 2 orders

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,384,218 (×1.00) | 982,920 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,054,885 (×1.48) | 1,660,983 (×1.69) | 135 | 134 | 110 |
| protobufjs | 1,412,521 (×1.02) | 1,463,368 (×1.49) | 115 | 127 | 117 |
| avsc | 1,727,757 (×1.25) | 1,820,438 (×1.85) | 97 | 111 | 101 |
| msgpackr (records, shared structures) | 1,494,853 (×1.08) | 2,621,503 (×2.67) | 108 | 124 | 112 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,528 (×1.00) | 921 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 2,006 (×1.31) | 1,491 (×1.62) | 140,738 | 30,666 | 26,946 |
| protobufjs | 1,298 (×0.85) | 1,370 (×1.49) | 120,459 | 31,414 | 28,985 |
| avsc | 1,423 (×0.93) | 1,790 (×1.94) | 101,839 | 29,895 | 27,334 |
| msgpackr (records, shared structures) | 1,529 (×1.00) | 2,894 (×3.14) | 112,274 | 30,957 | 28,370 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-09. Median of 5 runs; bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

<!-- bench:compare:end -->

protoarray is the fastest text codec on records and strings. Binary codecs win on payloads that
are mostly numbers (doubles print as long decimal strings), and msgpackr with shared structures
decodes small records faster; the full tables, including those, are in the
[benchmarks page](https://protoarray.vercel.app/guide/benchmarks).

## Exports

```js
const {
  Schema,
  encode, decode, stringify, parse,
  SchemaDefinitionError, EncodeError, DecodeError,
} = require('@alexify/protoarray');
```

```js
import { Schema, type Infer, type Input } from '@alexify/protoarray';
```

The [API reference](https://protoarray.vercel.app/api/exports) lists every member.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
