# Changelog

All notable changes to **`@alexify/protoarray`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Encoding validates by default.** `validate` (default `true`) now covers encode as well as
  decode: a missing required field or tuple element throws `EncodeError` `required`, a value of the
  wrong type (including `NaN`, the infinities and invalid dates) `type`, a value outside an enum
  `enum`, and a `null` record in a `flat` or `columns` collection `type`, each with a path such as
  `orders[1].sku`. Under 1.0 these travelled as `null` or as they were and failed only on the
  receiving side. `{ validate: false }` keeps the 1.0 behaviour; the checks are compiled out of a
  trusting codec.
- A cyclic value, or one nested deeper than the call stack, throws `EncodeError` `depth` instead
  of a `RangeError`.

### Fixed

- Decoding without validation no longer throws a `TypeError` for a BigInt in a `date` or `flags`
  slot, and leaves a non-number in a `date` slot as it is instead of making an invalid `Date`.

## [1.0.0] - 2026-10-14

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
  `{ enum: [...] }` of any size, the new `{ flags: [...] }` of up to 31 names, schemas used by
  value, references by name (`'User'`) through `options.schemas` or the schema's own name for
  recursion.
- **Wire rules**: one field per position in declaration order; `undefined`, `null` and a missing
  key all travel as `null`; trailing `null`s are trimmed; `enum` travels as its index, `date` as
  epoch milliseconds, `bigint` as a decimal string, `flags` as a bitmask; decoded objects carry
  every key in schema order with `null` for what was missing.
- **Layouts**: `{ sparse: true }` encodes a struct as `[mask, ...present values]`;
  `{ layout: 'flat' | 'columns' }` for collections of records next to the default rows.
- **Validation on decode** (default on, `{ validate: false }` to trust the wire): structure, types,
  required fields and enum ranges, reported as `DecodeError` with a `code`, a path such as
  `orders[1].sku` and the `schema` name; `{ strict: true }` rejects elements beyond the schema.
  Whatever the input, `decode` and `parse` throw nothing but `DecodeError`: a recursive schema's
  payload nested deeper than the call stack is a `structure` error, and without validation a
  value with no wire form of its type is passed through, never converted. `EncodeError` (with
  `code`, `path` and `schema`) for a record that is not an object or a collection or tuple that
  is not an array; `SchemaDefinitionError` for a broken definition or options.
- **Schemas inside schemas**: a `Schema` used by value or by name is called through its own
  compiled codec, so it keeps its own options, `layout` and `sparse` and is compiled once;
  `schema.list` reuses the codec and the name the same way.
- **`fingerprint` option**: `(canonical) => string` replaces the default FNV-1a 32-bit `id` with
  any synchronous function of the canonical form, for registries that need more than 32 bits.
- **Two backends**: generated code through `new Function` where the runtime allows it, composed
  closures otherwise (CSP without `unsafe-eval`, Cloudflare Workers, Vercel Edge); `{ codegen }`
  picks one explicitly, and in automatic mode a schema whose function the runtime still rejects
  falls back to closures. Both are run through the same test suite and a property-based parity
  suite. The generated source is kept on the codec, reachable through
  `Symbol.for('alexify.protoarray.codec')`, for debugging.
- **Schema evolution** by construction: append fields at the end, never reorder; a newer decoder
  reads older payloads (missing fields are `null` or their default), an older decoder ignores
  the extra positions of newer ones.
- **TypeScript**: `Infer<D>` (what decode returns) and `Input<D>` (what encode accepts) inferred
  from the definition literal, with `const` type parameters.
- **Benchmarks**: `pnpm bench` for the engine (the median of five rounds, with its spread) and
  `pnpm bench:compare` against JSON, protobufjs, avsc, msgpackr, @msgpack/msgpack, cbor-x and
  fast-json-stringify, with payload sizes raw, gzip and brotli; `pnpm bench:report` writes the
  tables into the README and the docs.
- **Documentation site** at [protoarray.vercel.app](https://protoarray.vercel.app/): schema,
  types, optional fields, collections, evolution, errors, TypeScript, runtimes, compression,
  wrpc, wire format and the API reference.

### Changed

- The placeholder `encode(schema, value)` and `decode(schema, array)` now take a `Schema`
  instance; `stringify` and `parse` join them.
- The bundle-size gate moved from 4 KB to 8 KB min+gzip; the library is 7.7 KB.

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

[unreleased]: https://github.com/Alexis-Technologies/protoarray/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Alexis-Technologies/protoarray/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/Alexis-Technologies/protoarray/releases/tag/v0.0.1
