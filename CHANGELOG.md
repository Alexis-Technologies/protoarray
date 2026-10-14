# Changelog

All notable changes to **`@alexify/protoarray`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-15

Unions for tagged messages such as wrpc's packets, binary data, fixed-point numbers, records and
flags past 31 slots, validation of the values given to encode on request, and `check`. Every 1.0
payload decodes the same way, a payload that uses none of the new constructs is byte for byte what
1.0 writes, and a 1.0 caller sees no change: encoding trusts its values by default, as it did.

### Added

- **Unions**, in metaschema's spelling: `{ union: [Call, Event], discriminator: 'type' }`, where
  every branch is a struct whose `type` field is a required enum. A value travels as `[tag, ...the
  other fields of its branch]`, the tag being the index of the discriminator value among the values
  of all branches, so wrpc-style packets (`{ type: 'call', id, method, args }`) lose both their keys
  and the repeated discriminator. A union can be the whole schema, a field or an array item;
  branches can be inline, `Schema` instances or names; `Infer` gives the union of the branches,
  narrowed by the discriminator. An unknown discriminator or tag is an `EncodeError` /
  `DecodeError` with code `union`, whatever `validate` says; a broken union is
  `SchemaDefinitionError` `ERR_INVALID_UNION`.
- **`schema.check(value)`** and `check(schema, value)`: the `EncodeError` that encoding the value
  with validation would throw, or `null`, without throwing over the data. It validates whatever
  `validate` the schema and the schemas it embeds were built with, through a codec compiled once on
  the first call.
- **Validation of the values given to encode, on request.** `validate` takes a direction: `true`
  (the default) or `'decode'` checks the wire on decode and trusts the values, as 1.0 did;
  `'both'` checks the values too: a missing required field or tuple element throws `EncodeError`
  `required`, a value of the wrong type (`NaN`, the infinities, an invalid date, anything but a
  `Uint8Array` for `bytes`) `type`, a value outside an enum `enum` (an exact match: `'20'` is not
  `20`), a `null` record in a `flat` or `columns` collection `type`, each with a path such as
  `orders[1].sku`; `'encode'` checks only the values; `false` trusts both sides. The checks are
  compiled into the codec, so one that does not ask for them carries none. A `date` accepts a
  `Date` or a timestamp, a `bigint` a BigInt, a safe integer or a string of digits.
- **Sparse records past 31 fields**: one `[mask, ...present values]` segment per 31 fields,
  trailing empty segments left off. Up to 31 fields the wire is the 1.0 form, so a sparse record
  can grow past 31 fields without breaking older decoders, which read the first segment.
- **`bytes`**: a `Uint8Array` (a `Buffer` or a subclass too) travels as standard base64 with
  padding and decodes as a plain `Uint8Array` with a buffer of its own, in Node.js as in browsers.
  Only canonical base64 decodes (the text must encode back to itself), the same on every platform.
  Node.js converts through `Buffer`, browsers through `Uint8Array.prototype.toBase64` where they
  have it and `btoa`/`atob` elsewhere: a runtime twin, `src/runtime/node.js` and
  `src/runtime/browser.js`, mapped by the package.json `browser` field.
- **Decimals**: `{ type: 'number', decimals: n }` (n from 0 to 15) travels as
  `Math.round(value × 10ⁿ)` and decodes as that integer ÷ 10ⁿ, so `19.99` is `1999` on the wire
  and `0.1 + 0.2` is `30`. It is a valid metaschema long form; 1.0 ignores the option, so a field
  using it needs 1.1 on both sides, and its canonical form (`number(2)`) gives it another id.
- **Flags past 31 names**: the bitmask becomes an array of 31-bit words once a name past 31 is
  set, and stays one integer while none is, so a decoder of up to 31 names keeps reading the
  payload until then. A 1.0 decoder does not read the array form: deploy decoders before setting
  the new names.
- **The fallback cause**: `schema[Symbol.for('alexify.protoarray.fallback')]` holds the error that
  made the automatic backend choice fall back to closures (a CSP's `EvalError`), off the public
  surface, so a fallback can be told from a choice.
- **Docs**: a [wrpc guide](https://protoarray.vercel.app/guide/wrpc) with a packet codec built on
  a union, and a `packets` scenario in the benchmarks (100 mixed wrpc packets).

### Changed

- **The bundle** is 10.8 KB (Node.js entry) and 10.9 KB (browser entry) min+gzip, up from 7.7 KB;
  the CI budget is 11 KB.
- A cyclic value, or one nested deeper than the call stack, throws `EncodeError` `depth` instead
  of a `RangeError`; any other `RangeError` passes through as it is.
- An array given where a record is expected is `EncodeError` `object`, like any other non-object.
- A sparse mask must be a non-negative 31-bit integer; a negative one is `DecodeError`
  `structure`.
- A struct whose first key is `union` holding an array is now a union, as metaschema reads it, and
  one whose first key is `union` holding anything else throws `ERR_UNKNOWN_TYPE` like any struct
  starting with a type name.
- **TypeScript**: `EncodeErrorCode` gains `required`, `type`, `enum`, `union` and `depth`, and
  `DecodeErrorCode` gains `union`, which an exhaustive `switch` over them will notice; a
  capitalised key holding plain metadata (`{ Entity: {}, … }`, metaschema's kind) is no longer a
  field in `Infer` and `Input`; `SchemaOptions.validate` is `boolean | 'decode' | 'encode' |
  'both'`. The typings need TypeScript 5.0 or newer, as in 1.0.
- The third constructor parameter of `EncodeError` is the detail of the message (the expected
  type), as `DecodeError`'s is, not the schema name.
- The closures backend encodes 9–26% faster than 1.0 (one loop per record shape, the type's own
  check per field), a validated `bytes` field decodes once instead of twice, and the generated
  source of a codegen codec is produced again when read through the codec symbol instead of
  being kept in memory.

### Fixed

- Decoding without validation no longer throws a `TypeError` for a BigInt in a `date` or `flags`
  slot, and leaves a non-number in a `date` slot as it is instead of making an invalid `Date`.
- `check`, and `encode` with its values checked, never throw a raw `TypeError` over the value: an
  enum or union lookup takes only strings and numbers, and only a real `Uint8Array` view (from any
  realm, a subclass included) is `bytes`, whatever its `Symbol.toStringTag` says.

### Upgrading from 1.0

Nothing changes by default: the wire is checked on decode and the values given to encode are
trusted, as before. To have `encode` check its values, build the schema with
`{ validate: 'both' }`; to check a value without throwing, call `schema.check(value)`. Code that
switches on `EncodeErrorCode` or `DecodeErrorCode` exhaustively needs the new codes.

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

[unreleased]: https://github.com/Alexis-Technologies/protoarray/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Alexis-Technologies/protoarray/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Alexis-Technologies/protoarray/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/Alexis-Technologies/protoarray/releases/tag/v0.0.1
