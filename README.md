# protoarray

[![npm](https://img.shields.io/npm/v/%40alexify%2Fprotoarray)](https://www.npmjs.com/package/@alexify/protoarray)
[![CI](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/protoarray/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fprotoarray)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-protoarray)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://protoarray.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fprotoarray)](./LICENSE)

**Compact positional payloads for JavaScript.** Send objects as positional arrays and let a schema
shared by the client and the server map every position back to its key. A zero-dependency
alternative to Protocol Buffers for Node.js and browsers.

> 🚧 **Work in progress.** The schema format and the API are being designed. `encode` and `decode`
> are exported today as placeholders that throw.

```js
// The idea:
{ name: 'Alex', age: 27 }   // '{"name":"Alex","age":27}'  24 bytes as JSON
['Alex', 27]                // '["Alex",27]'               11 bytes as JSON
```

Both sides share a schema that says position `0` is `name` and position `1` is `age`, so the keys
never travel over the wire.

### 📖 [Read the documentation →](https://protoarray.vercel.app/)

## Why protoarray

- **Smaller payloads.** Keys are not repeated in every message, only the values travel.
- **Still JSON.** The payload is a plain JSON array, so it goes through any transport and storage
  that already handle JSON, and stays readable in logs.
- **No toolchain.** No `.proto` files, no compiler, no generated code. A schema is a plain
  JavaScript value.
- **Zero dependencies.** CommonJS with ESM named imports and hand-written TypeScript typings, no
  build step, one package for Node.js and browsers.

## Installation

```bash
pnpm add @alexify/protoarray
# or
npm install @alexify/protoarray
```

Requires Node.js 18 or newer. Works in browsers through any bundler.

## Exports

```js
const { encode, decode } = require('@alexify/protoarray');
```

```js
import { encode, decode } from '@alexify/protoarray';
```

The [API reference](https://protoarray.vercel.app/api/exports) lists every member.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
