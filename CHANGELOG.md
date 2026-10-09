# Changelog

All notable changes to **`@alexify/protoarray`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-09

The first release of the format: objects travel as positional JSON arrays under a schema both
sides share, so keys never go over the wire and `JSON.parse` has less to do.

### Added

- **`Schema`**: `new Schema(name, definition, options?)`, `Schema.from(definition, options?)` and
  `Schema.keys([...])` compile a definition once into a codec with `encode`, `decode`,
  `stringify` and `parse`, plus `keys`, `id` (a fingerprint of the canonical form), `list` (the
  same records as rows), `backend`, `layout` and `toString()`.
- **Definition DSL**, a subset of `@alexify/metaschema`: `'string'`, `'number'`, `'boolean'`,
  `'bigint'`, `'json'`, the new `'date'`, optional fields as `'?type'`, `'key?'` or
  `{ type, required: false }`, `default` values, nested structs, `{ array: T }`, tuples,
  `{ enum: [...] }`, the new `{ flags: [...] }`, schemas used by value, references by name
  (`'User'`) through `options.schemas` or the schema's own name for recursion.
- **Wire rules**: one field per position in declaration order; `undefined`, `null` and a missing
  key all travel as `null`; trailing `null`s are trimmed; `enum` travels as its index, `date` as
  epoch milliseconds, `bigint` as a decimal string, `flags` as a bitmask; decoded objects carry
  every key in schema order with `null` for what was missing.
- **Layouts**: `{ sparse: true }` encodes a struct as `[mask, ...present values]`;
  `{ layout: 'flat' | 'columns' }` for collections of records next to the default rows.
- **Validation on decode** (default on, `{ validate: false }` to trust the wire): structure, types,
  required fields and enum ranges, reported as `DecodeError` with a `code` and a path such as
  `orders[1].sku`; `{ strict: true }` rejects elements beyond the schema. `EncodeError` for a
  value that is not an object, `SchemaDefinitionError` for a broken definition or options.
- **Two backends**: generated code through `new Function` where the runtime allows it, composed
  closures otherwise (CSP without `unsafe-eval`, Cloudflare Workers, Vercel Edge); `{ codegen }`
  picks one explicitly. Both are run through the same test suite and a property-based parity
  suite.
- **Schema evolution** by construction: append fields at the end, never reorder; a newer decoder
  reads older payloads (missing fields are `null` or their default), an older decoder ignores
  the extra positions of newer ones.
- **TypeScript**: `Infer<D>` (what decode returns) and `Input<D>` (what encode accepts) inferred
  from the definition literal, with `const` type parameters.
- **Benchmarks**: `pnpm bench` for the engine and `pnpm bench:compare` against JSON, protobufjs,
  avsc, msgpackr, @msgpack/msgpack, cbor-x and fast-json-stringify, with payload sizes raw, gzip
  and brotli; `pnpm bench:report` writes the tables into the README and the docs.
- **Documentation site** at [protoarray.vercel.app](https://protoarray.vercel.app/): schema,
  types, optional fields, collections, evolution, errors, TypeScript, runtimes, compression,
  wrpc, wire format and the API reference.

### Changed

- The placeholder `encode(schema, value)` and `decode(schema, array)` now take a `Schema`
  instance; `stringify` and `parse` join them.
- The bundle-size gate moved from 4 KB to 8 KB min+gzip; the library is 7.1 KB.

## [0.0.1] - 2026-10-09

### Added

- **Package scaffold** set up like the other Alexis libraries: plain CommonJS with no build step,
  a hand-written `index.d.ts`, a closed `exports` map with a `browser` entry, and zero runtime
  dependencies.
- **Tooling:** pnpm, oxlint and oxfmt, `node:test` suites with c8 coverage gates, tsd type tests,
  an export-parity check between the runtime and `index.d.ts`, bundle tests through esbuild, a
  bundle-size budget (`pnpm size`) and a zero-dependency benchmark harness (`pnpm bench`).
- **CI** on GitHub Actions and a VitePress documentation site at
  [protoarray.vercel.app](https://protoarray.vercel.app/).

[1.0.0]: https://github.com/Alexis-Technologies/protoarray/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/Alexis-Technologies/protoarray/releases/tag/v0.0.1
