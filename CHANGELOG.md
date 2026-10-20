# Changelog

All notable changes to **`@alexify/protoarray`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The binary wire**, `@alexify/protoarray/binary`: `toBinary(schema, value)` gives the bytes of
  a value as a `Uint8Array`, `fromBinary(schema, bytes)` the value back, `register()` installs
  them as `schema.toBinary` and `schema.fromBinary`, for a schema or its `list`. The same plan is
  compiled a second time, by the backend the schema runs (generated code through the one compile
  primitive of `codegen.js`, closures elsewhere; both write the same bytes), with the schema's
  `validate` on decode and the same errors and paths. A record is a header of presence bits (the
  booleans in it) and its fields; integers, dates and decimals are zigzag varints, a `number` a
  float64, an enum index a byte, a string UTF-8 up to 21 characters and UTF-16 past them (copied,
  not transcoded), the rest as in the wire format page. Both sides need the same schema. Interned
  strings, lists of differences, the `flat` and `columns` layouts and a schema from `resolve` have
  no binary form (`SchemaDefinitionError` `ERR_NO_BINARY_FORM`, naming the place); the registry,
  streaming and standalone modules stay on the text wire. See The Binary Wire in the guide and the
  benchmarks.

### Changed

- The runtime twins (`src/runtime/node.js`, `browser.js`) carry the string functions of the
  binary wire next to base64 (Buffer's in Node.js, `TextDecoder` and loops in a browser), and
  `DecodeError` `structure` has a `bytes` detail ("is not a Uint8Array").

## [2.0.0] - 2026-10-16

2.0 hands the definition of a schema to `@alexify/metaschema` and keeps the wire to protoarray.
Schemas are metaschema's: protoarray reads the snapshot a metaschema `Schema` or `Model` writes
(format 1, plain JSON) into the plan its backends compile, so one definition validates with
metaschema and travels with protoarray, and a client that receives a snapshot needs no
metaschema at all. protoarray still depends on nothing: metaschema is recognised by its brand,
and injected through an option where a definition has to be read. The options that shape the
wire (`delta`, `intern`, `sparse`, `layout`) name their places by path; checking the values
given to encode is metaschema's. Versions that cannot follow the append-only rules read each
other through `resolve` and a registry of schemas by id; collections stream item by item and
shrink further with delta-encoded integers and interned strings; generated code can be written
into a module for runtimes without code generation. The wire did not change: a schema of the
same shape writes the same wire as in 1.x and every 1.x payload decodes the same way; its
canonical form and id are the same too, unless it references another schema by name or a name
in it holds the canonical form's punctuation (see Changed).

### Removed

- **The definition DSL.** A plain object is no longer a protoarray definition: `new Schema(name,
  definition)` and `Schema.from(definition)` read a metaschema `Schema`, a metaschema `Model`'s
  entity, a snapshot, or a definition with metaschema injected (`{ metaschema }`). Definition
  errors are metaschema's (its own `SchemaDefinitionError`).
- **`options.schemas`**: a reference by name reaches an entity of a metaschema `Model` (or of the
  snapshot), and a schema reaches its own name for a recursion.
- **`Schema.keys`**: a struct of `any` fields, `{ x: 'any', y: 'any' }`, is the same schema.
- **Checking the values given to encode**: `validate: 'encode' | 'both' | 'decode'`,
  `schema.check(value)` and `check(schema, value)`. `validate` is a boolean again and only says
  whether the wire is checked on decode; encode trusts its values, as 1.0 did, and metaschema's
  `check` and `parse` validate them (`schema.source` is the metaschema Schema it was built from).
  Encode still throws for what has no wire at all: a value of the wrong shape, a union's
  discriminator outside the union, a cycle, a value a list of differences cannot hold.
- **A protoarray `Schema` used by value inside a definition**: embed the metaschema schema (it is
  inlined, with the options of the schema around it), or reference an entity by name (it keeps the
  options given for it in `entities`).
- **`schema.definition`**: `schema.snapshot` is what it was read from, `schema.source` the
  metaschema Schema, if any.

### Added

- **Schemas from metaschema.** `Schema.from(metaschemaSchema, options?)` builds the schema of a
  metaschema `Schema` (`toSnapshot()`, metaschema 3.4 or newer), typed by its Standard Schema
  props; `Schema.from(snapshot, options?)` from a snapshot, with `entity` naming the entity of a
  model's; `Schema.from(definition, { metaschema })` from a definition, reading it with the
  metaschema module given (`@alexify/metaschema` or `@alexify/metaschema/definition`, which does
  not validate); `Schema.from(schema, options?)` the same schema with other options; and
  `Schema.fromModel(modelOrSnapshot, options?)` every entity of a `Model`, by name, references
  between them reaching one another, a recursion between two entities included. Every form of
  metaschema's language has its wire form: `integer`, `any`, `unknown` and `null`; sets (the
  array of their elements), maps (flat key-value pairs), dictionaries (their keys as JSON keys);
  tuples of any elements; `bytes`, `flags` and `decimals`, built in to metaschema since 3.4;
  aliases of types down their chain; calculated fields and functions left out. A reference
  travels as metaschema's check reads it: a stored kind's id, a memory kind's record, as the
  field's `embed` says, or as the new option `references: 'kind' | 'embed' | 'id'` says for every
  reference. A custom type with a check of its own travels as the wire type the new option
  `types` gives it. A stored kind's id field (`<entity>Id`) is a trailing optional field, as in
  metaschema.
- **The snapshot is read as untrusted input**: its format, entity and every form are checked,
  nesting is limited, a `__proto__` or integer-like key is refused (`ERR_RESERVED_KEY`,
  `ERR_INTEGER_KEY`), and a broken one is `SchemaDefinitionError` `ERR_INVALID_SNAPSHOT` with the
  path, so a snapshot sent by a server can define a client's schemas.
- **Options by path**, named as the errors name a place (`address.city`, `orders[].sku`,
  `scores{}`, `pair[1]`, `''` for the root): `sparse: true | paths` and `layout: layout | { path:
  layout }` reach structs and collections inside a record (such a collection is compiled as a codec
  of its own), `intern: true | paths` and `delta: paths` (see below). A path that names no place
  of the schema, or a place of another kind, is `ERR_INVALID_OPTIONS`. `entities` gives the
  entities a reference reaches options of their own.
- **`@alexify/protoarray/resolve`**: `resolve(writer, reader, options?)` reads what `writer` wrote
  as `reader` objects and writes `reader` objects the way `writer` does, for versions that the
  append-only rules cannot bridge; `register()` installs it as `Schema.resolve`. Its wire, id,
  canonical form and layout are the writer's; its keys, key order, types and defaults the
  reader's. Fields match by key, by the reader's `aliases` (metaschema's own option) or by the
  `aliases` option, keyed by reader path (`'address.city': 'town'`, `'orders[].sku'`). The reader
  may drop writer fields (skipped on decode, null on encode), add optional or defaulted ones,
  reorder and rename, widen `integer` to `number` or `bigint` and `decimals` to more decimals or a
  plain number, read an enum by value (a dropped value becomes the default, null when optional,
  an error otherwise), an enum as a string and a string as an enum, flags by name, and anything as
  `json`; union branches pair up by their discriminator values. What cannot be read throws
  `SchemaDefinitionError` `ERR_INCOMPATIBLE`. The result is compiled by the same backends,
  recursion included, so it runs at the speed of a schema of its own.
- **`@alexify/protoarray/registry`**: `SchemaRegistry`, schemas by id and by name, and the
  envelope `[id, payload]` that tells a receiver which version wrote a payload.
  `registry.decode(envelope, reader?)` reads it as its writer wrote it or as any reader schema
  (through `resolve`, once per pair), `registry.encode(schema, value, { as: id })` writes for a
  peer on another version, `stringify` and `parse` do the same with text, and
  `SchemaRegistry.from(modelOrSnapshot, options?)` holds every entity of a model. An unknown id is
  a `DecodeError` with the new code `schema`, a value that is not `[id, payload]` a `structure`
  error; two different schemas under one id (a fingerprint too narrow for the registry) throw
  `ERR_ID_COLLISION` when added.
- **`@alexify/protoarray/standalone`**: a schema's generated code as the source of a module, for
  runtimes that forbid compiling source text (a strict CSP, Cloudflare Workers, Vercel Edge),
  where schemas otherwise run on the slower closures backend. `toSource(schemas, { runtime,
  format })` writes a CommonJS or ES module with the code of the schemas given and every entity
  they reach: one schema as the default export, a record of them as named exports. `runtime:
  'import'` (the default) imports this package and builds real `Schema` instances from the
  snapshots they were read from with the new `{ compiled }` option, whose `backend` is
  `'standalone'`; `runtime: 'inline'` carries its own runtime (the source of the package's error
  classes, type table, layouts and base64) and imports nothing. Neither needs metaschema. A
  generated module compiles no source text while it loads: an `import` module embeds only the
  entities its schemas reach (as `JSON.parse` of their text), with the generated codec of each
  one, of a collection in a layout of its own and of the records of a rows collection (for the
  stream helpers); `{ compiled }` throws `ERR_COMPILED_MISMATCH` when the snapshot no longer
  matches the code, and the module itself when it was generated by another version of protoarray
  (generate it again). `register()` adds `schema.toSource(options)`.
- **The `protoarray` command**: `protoarray compile <module> [--out <file>] [--format cjs|esm]
  [--runtime import|inline] [--only <A,B>]` loads a module (CommonJS or ES) of protoarray schemas,
  metaschema Schemas or metaschema Models (their entities by name; a Model as the whole module
  too) and writes their standalone module. `--out` makes the directory it names and never writes
  over the module it reads; an error names its code, schema and field, a module that does not load
  its file and line. Exit codes: 0 done (`--help` included), 1 not compiled, 2 a wrong command
  line.
- **`stringify` writes the text itself where that is faster**: generated code builds the JSON
  text as it encodes instead of encoding an array and handing it to `JSON.stringify`. The text is
  the text of the wire, byte for byte (a property-based test holds the two together). The new
  option `stringify` says when: `'auto'` (the default) for records whose leaves are booleans,
  enums, flags, dates, integers or decimals, nested records of them included, which measured ×1.0
  to ×1.85 against the native path on Node.js 18 to 24; `'builder'` for any schema, which pays on
  older engines (×1.2 to ×1.8 on Node.js 20) but is up to 30% slower on string-heavy records since
  Node.js 22, whose `JSON.stringify` got a fast path; `'native'` never. Collections longer than 64
  records always take `JSON.stringify`.
- **Streaming.** `schema.encodeEach(values)` and `schema.decodeEach(arrays, options?)` (and the
  free functions of the same names) convert an iterable lazily, a generator for an iterable and
  an async generator for an async one; an error names the index of its value (`[3].name`). The
  `@alexify/protoarray/stream` subpath adds, without any Node builtin:
  - `stringifyLines(schema, values)` and `parseLines(schema, source, options?)`: NDJSON, one
    payload per line, from a string, an iterable or async iterable of strings or UTF-8 bytes, or a
    `ReadableStream`; CRLF and blank lines are accepted, invalid UTF-8 and a line that is not JSON
    are `DecodeError` `json`;
  - `stringifyStream(schema)` and `parseStream(schema, options?)`: the same as `TransformStream`s;
  - `stringifyItems(collection, values)` and `parseItems(collection, source, options?)`: one large
    JSON array of a collection in rows or flat, written a piece per item and read item by item
    while the text arrives, with the collection's rules for null items and errors that name the
    item;
  - `register()`, which installs the six as methods of `Schema`.

  A value that is not iterable is `EncodeError` `iterable` or `DecodeError` `structure`. A
  parser holds one line or one item at a time and no more than `maxLength` characters of it (16
  MiB by default, `Infinity` the longest string the engine builds): a longer one is
  `DecodeError` `structure` at its index, the lines or items before it read. A source may also
  be the whole text as bytes; a byte order mark is dropped; an empty chunk changes nothing; a
  `ReadableStream` read through its reader is cancelled when the consumer stops early. An item's
  text comes from the generated writer of its record where it has one.
- **`delta`**, opt-in by path: an `integer`, a `number`, a `date` or decimals column of a `columns`
  collection travels as its first value and the differences between neighbours (`[100, 1, 2]` for
  ids 100, 101, 103; nulls keep their places), and a list of them anywhere does the same
  (`delta: ['ids', '[].at']`). Only integers have exact differences, so a value that is not one is
  an `EncodeError` `type`. The canonical form marks it (`id:integer~`, `~[date]`), so it changes
  the id.
- **`intern`**, opt-in: `{ intern: true }` for every string of the schema, or the paths of the
  strings to intern. The payload becomes `[table, body]`: the message's distinct interned strings
  in the order they first appear, then the usual wire with each of them as its index. One table
  serves the whole message, the entities it reaches, the records of a collection and recursion
  included. A broken table is a `DecodeError` `structure`, an index outside it `type`. The
  canonical form marks it (`city:string*`).
- **`maxDepth`**, opt-in: `{ maxDepth: 512 }` has every entity a recursion goes through count its
  levels and refuse a value or a payload nested deeper (`EncodeError` `depth`, `DecodeError`
  `structure`, with the path), at the same depth on either backend and in generated modules,
  before the stack runs out. By default nothing is counted, as in 1.x: the call stack is the
  limit, which the closures backend reaches sooner than generated code (on Node.js 24, about
  1,800 levels of a linked list against 3,500). A schema without a recursion is never
  wrapped; one with a limit encodes about 8% and decodes about 3.5% slower on deep trees. The
  entities a reference reaches, a `list` and a resolved schema (the reader's) take it.

### Changed

- **The id covers the entities a schema references.** `schema.id` is the fingerprint of the
  canonical form followed by the canonical form of every other entity the schema reaches by
  reference (`;Address={city:string}`, by name); the `fingerprint` option receives that text. A
  reference prints as a name, so in 1.x two versions whose referenced schema changed had one id,
  and a registry or `resolve` took them for one version and misread the payload. A schema that
  references no other schema (a recursion to its own name included) keeps its 1.x id; one that
  does gets a new one. `toString()` is unchanged.
- **TypeScript**: a schema is typed by the metaschema Schema it is built from, through its
  Standard Schema props (`~standard.types`) read by their shape: `Schema<Output, Input>`, the
  output as decode gives it (`Decoded<T>`: every key present, the missing ones `null`), the input
  as metaschema's. The definition-literal types (`Definition`, `Infer`, `Input`, `Encoded`,
  `FieldDefinition` and their kin) are gone. `EncodeErrorCode` loses `required` and `enum`;
  `SchemaErrorCode` gains `ERR_INVALID_SNAPSHOT`, `ERR_COMPILED_MISMATCH`, `ERR_ID_COLLISION` and
  `ERR_UNKNOWN_SCHEMA`; `DecodeError` gains `id`, `SchemaDefinitionError` `cause`; `Backend` gains
  `'standalone'`.
- `encode`, `decode`, `stringify` and `parse` as free functions are typed after the methods of
  the schema they get (`Parameters`/`ReturnType`), which accepts any schema or collection.
- **The core is larger**, about 21.5 KB min+gzip (the bundle budget is 22 KB): the wire forms of
  metaschema's whole language, the text builder, the compaction options and the assembly of a
  snapshot's entities. The registry, streaming, resolve and standalone extras are subpaths that
  add 1.8 to 2.5 KB each to a bundle that uses them.
- **The entities of one snapshot are read together, then compiled**: every entity a reference
  reaches is read from a list (a chain of thousands of entities reads in linear time and never
  exhausts the stack), whether a payload carries a string table and whether a recursion goes
  through an entity are then decided over the whole graph, and each is compiled last, an alias
  after the entity it stands for. An entity in a recursion with interned strings writes one wire,
  whichever entity is built first. An alias (an entity that is a reference to another) encodes,
  decodes, resolves and has the keys and layout of what it stands for; references that come back
  to themselves with no record between them are `ERR_INVALID_SNAPSHOT`.
- **Names in the canonical form**: a key, an enum value, a flag name, a discriminator or an entity
  name that holds the form's punctuation (`:,{}[]()|?=@;*~<>`), begins with a quote or is empty
  prints as a JSON string, and so does a string enum value that reads as a number (`enum("1")`
  against `enum(1)`): two schemas that printed the same with different wires now have different
  ids. Every 1.x form without such names is unchanged. The list of a recursive schema has the id
  of its canonical form again, as in 1.x.
- **Paths**: a dictionary's key, which the payload gives, is written as a plain name or as a quoted
  JSON string cut to 64 characters (`scores["a b"]`), the same on both backends; a record's key
  that holds a path's punctuation (`.`, brackets, braces), begins with a quote or is empty is
  quoted the same way (`["a.b"].c`), in the paths of options too; a column of a `columns`
  collection is named by its field (`[].price`, was `[2]`). A path keeps 64 levels at most, both
  ends, and is written once: an error deep in a payload no longer costs an error per level.
- **Errors**: the registry's `decode` and `parse` throw only `DecodeError`; an envelope's id is
  the error's `id` and no longer part of its message (`Value is not of a schema this reader can
  read`), and a version the reader cannot resolve is that error too, the `ERR_INCOMPATIBLE` its
  `cause` (tried once per pair). Writing `as` an id the registry does not know is
  `ERR_UNKNOWN_SCHEMA`. A union without a discriminator is `ERR_INVALID_UNION`, `sparse` on a
  union's branch `ERR_INVALID_OPTIONS`. An error in an entity a reference reached says which
  (`(reached from "A" at "b")`); an enum's expected values are its first 16; what breaks the
  reader unchecked is `ERR_INVALID_SNAPSHOT` with the error as its `cause`; `throw null` from a
  getter passes through encode as it is. The error classes declare their constructors.
- **Options are checked**: `entities` names entities of the snapshot, each one's options are
  checked whether a reference reaches it or not and may not hold `entity`, `entities` or
  `metaschema`, and one an entity leaves undefined is the shared one; `layout: 'rows'` takes an
  array; an `aliases` path of `resolve` names a field of the reader; `fingerprint` returns a
  non-empty string; `entity` with a metaschema Schema names its own entity; a flag name like an
  integer is `ERR_INTEGER_KEY`. A schema keeps copies of the lists and records it was built
  with.
- **Values**: a `decimals` number that scales past the safe integers (NaN and the infinities
  too) is `EncodeError` `type` whatever `validate` says, since no decoder reads its wire; a
  validated `date` decodes whole milliseconds within ±8.64e15 only, in lists of differences too;
  a `BigInt` or a `Symbol` as a date encodes as `null`; a Map, a Set or a Date is told by its
  brand, not by a tag it claims; a safe integer given to a `bigint` field travels as its decimal
  string; the text builder calls `toJSON` once, as `JSON.stringify` does (a BigInt's too). A
  default of another type than its field is metaschema's, never decoded; a hole in a list of the
  snapshot is a missing element. A schema built again for another entity of its snapshot has no
  metaschema `source`.
- **resolve**: a root scalar that only changes its optionality resolves; a writer's union branch
  whose values the reader partly dropped resolves, the dropped ones a `DecodeError` `union`; a
  resolved schema is no input of `resolve` or of a registry (`ERR_SCHEMA_EXPECTED`); a resolved
  schema has the writer's id whatever its fingerprint, and the reader's `stringify`; long enums
  and many branches resolve in linear time; interned strings inside a recursion resolve; a chain
  of references too long for the stack is `ERR_INCOMPATIBLE`, not a `RangeError`.
- **Code generation is tried once a schema may use it**: `{ codegen: false }` and the schemas of
  a generated module never call `new Function`, so a strict or report-only CSP reports nothing.
  `stringify` is as fast as in 1.1 where it writes through `JSON.stringify`, and no text writer
  is generated for the records of a flat or columns collection.

### Upgrading from 1.x

The wire did not change: a 2.0 schema of the shape of a 1.x schema writes its payloads and has
its id (unless it references another schema by name, whose shape the id now covers, or a name in
it holds the canonical form's punctuation, which it now quotes), so the two versions talk to each
other. What changes is how a schema is defined:

- Define the schema in metaschema and build the protoarray schema from it:
  `Schema.from(new metaschema.Schema('User', definition))`, or keep the definition literal and
  inject metaschema: `Schema.from(definition, { metaschema })`. The spelling of the 1.x DSL is
  metaschema's, so most definitions stay as they are.
- `'?User'` with `options.schemas` becomes an entity of a `Model` (`Schema.fromModel(model)`);
  a schema reaches its own name without one.
- Reading as metaschema does differs where 1.x went its own way: a reference to a stored kind
  (`Entity`, …) travels as its id unless the field says `embed: true` (or the option
  `references: 'embed'`); a stored kind adds its trailing id field (`<entity>Id`, `id` when
  anonymous), which replaces a field of that name and moves when a field is appended after it, so
  declare it (`userId: '?string'`) to keep its position; a struct whose first key is a type name
  needs a kind first, `{ Struct: {}, type: … }`.
- A protoarray schema used by value with its own `layout` or `sparse` becomes the path option of
  the schema around it, `{ layout: { items: 'flat' } }`.
- `Schema.keys(['x', 'y'])` becomes a definition of `any` fields.
- `{ validate: 'both' }` and `check()` become metaschema's `check` or `parse` before `encode`.

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

[unreleased]: https://github.com/Alexis-Technologies/protoarray/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Alexis-Technologies/protoarray/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/Alexis-Technologies/protoarray/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Alexis-Technologies/protoarray/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/Alexis-Technologies/protoarray/releases/tag/v0.0.1
