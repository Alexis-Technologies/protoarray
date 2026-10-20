# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**protoarray** (npm package `@alexify/protoarray`) is a fast, zero-dependency schema-based compact
serialization library for JavaScript, a lightweight alternative to Protocol Buffers. A payload such as
`{ name: 'Alex', age: 27 }` travels as the positional array `['Alex', 27]`; the client and the
server share a schema of keys and positions, so the receiver knows that position `0` is `name` and
position `1` is `age`. The payload is still plain JSON. It has zero runtime dependencies and runs
in Node.js ≥ 18 and browsers.

It is maintained by Alexis Technologies and set up like the sibling libraries
`@alexify/metaschema`, `@alexify/kerberos` and `@alexify/migronaut`. `origin` is
`Alexis-Technologies/protoarray`. **Since 2.0 schemas are metaschema's:** protoarray has no
definition DSL of its own; it reads the snapshot (format 1) a metaschema `Schema` or `Model`
writes (`toSnapshot()`, `toJSON()`, metaschema ≥ 3.4) into its plan, so one definition validates
with metaschema and travels with protoarray. 1.0 and 1.1 (on npm) had their own DSL; the wire,
the canonical form and the ids did not change.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
node --test tests/unit/codec.test.js   # a single file
node --test --test-name-pattern="Layouts" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/ and bin/, gated at 100 lines/statements/branches/functions per file
pnpm run test:types                # tsd: tests/types/*.test-d.ts against index.d.ts and the subpath d.ts files
pnpm run check:dts                 # tsc --noEmit --strict over every d.ts on its own
pnpm run lint                      # oxlint src tests scripts bench bin
pnpm run format                    # oxfmt src tests scripts bench bin (format:check in CI)
pnpm size [--max-gzip <KB>]        # esbuild bundle sizes of index.js and browser.js, and what each subpath adds; CI gates the core at 22 KB min+gzip
node bin/protoarray.js compile <module> [--out f] [--format cjs|esm] [--runtime import|inline] [--only A,B]   # the CLI
pnpm bench [filter] [--json] [--save] [--compare]   # engine ops/sec (median of 5 rounds ± spread), manual only; --save writes bench/baseline.json
pnpm bench:compare [--scenarios a,b] [--adapters x,y] [--no-cold-start] [--save]   # against JSON and 11 codecs, plus the cold start; --save merges into bench/results/compare.json
pnpm bench:releases [--ref v1.0.0] # a release (a tag, via git archive) or the current tree on the compare scenarios, both backends; merges into bench/results/releases.json
pnpm size:compare [--save]         # browser bundle of one record's round trip per library, bench/results/size.json
pnpm bench:report                  # the SVG charts (docs/public/benchmarks/) and the tables of README.md and docs/guide/benchmarks.md
pnpm docs:comparison               # renders docs/comparison.json (the feature matrix) into README.md and docs/guide/comparison.md
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:types + check:dts. Treat it as the
pre-merge gate. There is no build step.

## No build step: CommonJS + hand-written types

- `src/` is plain CommonJS (`require`/`module.exports`) and ships as is. No TypeScript syntax, no
  `import`/`export`, no `'use strict'`.
- The root `index.js` is a one-line shim over `src/index.js`. `browser.js` intentionally mirrors
  it. Do not deduplicate the two (see "Platform"). The subpaths `registry.js`, `resolve.js`,
  `stream.js`, `standalone.js` and `binary.js` are one-line shims over `src/` modules of the same names, each
  with its own d.ts; they hold what the core does not need, as free functions with the schema
  first, and `register()` installs the methods (`Schema.prototype`, or `Schema.resolve`,
  non-enumerable). Their d.ts declare those methods by module augmentation of `Schema`.
- `src/index.js` lists every export **by name** (`module.exports = { Schema, encode, … }`), never by
  spreading module objects. cjs-module-lexer only sees named keys, and ESM
  `import { Schema } from '@alexify/protoarray'` depends on it.
- `index.d.ts` is the only source of the public types, written by hand. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports for both entries and imports every name from ESM.
  `tests/types/*.test-d.ts` (tsd) pin signatures and the inference. `check:dts` needs `--target
  es2022` because there is no tsconfig. **The typings import nothing of metaschema** (not even
  types: a consumer without it must compile): `Schema<Output, Input>` takes its types from a
  source's Standard Schema props (`'~standard'.types`, read by their shape: `Typed`, `InputOf`,
  `OutputOf`), the output through `Decoded<T>` (optional keys present and `| null`, as decode
  gives them); a snapshot or a definition is `Schema<unknown>` unless a type argument says more.
  The tsd tests import `@alexify/metaschema` (a devDependency) to build typed sources. `AnySchema`
  (not `Schema<any>`) is what registries and free functions accept; the free functions are typed
  after the schema's methods (`Parameters<S['encode']>`).
- `package.json` has a closed `exports` map (`.`: `types`, `browser`, `default`; each subpath:
  `types`, `default`), a `bin` (`protoarray` → `bin/protoarray.js`) and a `files` allowlist: the
  root shims and d.ts files, `bin`, `src`, README, CHANGELOG, LICENSE and SECURITY.
  `export-parity.test.js` checks every subpath against the map, the list and `check:dts`.

## Zero dependencies

There is no `dependencies` key in `package.json`, and there won't be one, **nor a
`peerDependencies` one** (Alex's decision, 2026-10-15). Another library reaches protoarray by
dependency injection through options, or by a structural contract, never by a require:
metaschema's objects are told by their global brand (`Symbol.for('alexify.metaschema.brand')`,
`FOREIGN` in `plan.js`) and their public methods called (`toSnapshot()`, `toJSON()`), and a raw
definition is read by the metaschema module the caller passes (`{ metaschema }`).
`platform.test.js` fails on a require or import of `@alexify/metaschema` in `src/`, `bin/` or the
d.ts files. If a small helper is needed, copy it into `src/` with an attribution header.
devDependencies are fine (metaschema for the tests, the comparative benchmark's libraries).

## Repository layout

```
index.js  browser.js  index.d.ts   root entry shims + hand-written types
registry.js resolve.js stream.js standalone.js binary.js (+ .d.ts)   subpath shims + types
bin/protoarray.js   the CLI: `protoarray compile` (Node, outside src/)
src/
  index.js          public barrel (explicit named exports)
  schema.js         Schema class: sources (metaschema Schema/Model, snapshot, `{ metaschema }`),
                    options, the assembly of a snapshot's entities, plan → backend,
                    list/id/stringify/parse, fromModel, encodeEach/decodeEach, `compiled`
  snapshot.js       metaschema snapshot (format 1) → plan, the options by path, hardening
  plan.js           the plan's node typedefs, slots, canonical form, FNV-1a fingerprint
  resolve.js        writer plan × reader plan → resolved plan; resolve()/register() (./resolve)
  types.js          scalar type table (a closed kernel): checks, conversions, bridges, interned
                    strings, delta lists, recipes; shared by both backends
  runtime/          platform twin: base64 for `bytes` and the strings of the binary wire (UTF-8
                    read, UTF-16 both ways); node.js (Buffer) and browser.js (a closed kernel)
  codegen.js        new Function backend (the only file that may compile source text), the builder
  closures.js       no-eval backend, same semantics, used as the fallback and as the reference
  layouts.js        flat/columns layouts, delta columns, the interned root (a closed kernel)
  codec.js          functional entry points over a Schema
  errors.js         SchemaDefinitionError, EncodeError, DecodeError, fail/nest helpers (a closed kernel)
  registry.js       SchemaRegistry and the [id, payload] envelope (./registry)
  stream.js         NDJSON, TransformStreams, stringifyItems/parseItems (./stream)
  standalone.js     toSource (both wires), the import runtime, the inline kernel, register
                    (./standalone)
  binary.js         toBinary/fromBinary/register: the same schema on the binary wire (./binary);
                    the codec kept on the schema (or carried by a standalone module), the backend
                    the schema runs
  binary/           wire.js (Writer/Reader kernel over the runtime twin: varints, header bitsets,
                    strings), generate.js (generated backend through codegen.compile),
                    closures.js (the no-eval twin and reference, same bytes and errors),
                    inspect.js (what has no binary form, whether a plan reads float64s; shared
                    with standalone.js, which must not pull closures.js)
tests/
  unit/*.test.js    node:test suites, one per area, every behavioural suite runs per backend
  support/          BACKENDS + normalize, define/named/model (metaschema injected), the
                    wire-format vectors, the random generator and its translate
  fixtures/         modules of metaschema schemas for the CLI tests, golden-1x.json
  types/*.test-d.ts tsd assertions
scripts/size.js     bundle-size report and budget gate (CI smoke)
scripts/size-compare.js   cross-library bundle sizes; scripts/comparison.js renders the feature matrix
bench/              engine harness (bench.js), comparison (compare.js + compare/: adapters, scenarios,
                    measure, releases-worker), releases.js, report.js + report/ (model.mjs: the
                    chart models, svg.mjs: README images); baseline.json and results/*.json are
                    snapshots (results/binary.json is the run of the spike that decided ./binary,
                    kept as it was for the docs)
docs/               VitePress site (protoarray.vercel.app), not published; comparison.json is the
                    data of the feature matrix, .vitepress/theme/components/Bench*.vue the charts
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

`new Schema(name?, source, options)` runs three steps once, at construction:

1. **`snapshot.js`** reads the source's snapshot into a plan. The source (`sourceOf` in
   `schema.js`) is a metaschema Schema (`toSnapshot()`), a Model (`toJSON()` and `entity`), a
   protoarray schema built again with other options (its `snapshot`), a snapshot object, or a
   definition read by the injected `{ metaschema }`. The plan is a tree of nodes (`struct`,
   `union`, `array` (a `Set` with `container: 'set'`), `map`, `dict`, `tuple`, `scalar`, `ref`).
   A struct node holds `fields` (`key`, `index`, `required`, `def`, `node`, `aliases`), `keys`,
   `sparse` and `tail` (the index where the trailing run of optional fields starts, the only part
   that may be trimmed off the wire). Scalar nodes come from `types.js` and carry `check` (the
   wire), `pack` and `unpack` (null for identity types). A `union` node holds the discriminator
   `key`, a `tag` enum over the values of all branches and `branches` (`node`, `first`, `count`,
   `source`): each branch is a fresh struct node without the discriminator, with `tag` (`key`,
   `position`, `keys`, `values`). A reference to an entity that travels as the record (`embed`,
   `references`, the store of the target's kind, as metaschema's check decides) becomes a `ref`
   node with a **`slot`** to that entity's compiled codec: the entities of one snapshot are built
   together in an *assembly*, in three steps (`assemble`): every entity a reference reaches is
   read first, from a list (`unitOf`, `readUnit`: a slot is a placeholder until its entity is
   compiled, so a chain of references is no recursion); `analyse` then decides over the whole
   graph whether each payload carries a string table (`slot.interned`, read by `internedIn`) and,
   with Tarjan's components (`cyclic`), which entities a recursion goes through; `ordered`
   compiles each, an alias (a root `ref`) after what it stands for, a cycle of aliases refused.
   With `maxDepth` (opt-in) the codec of a recursive entity is `layouts.guarded`: it counts
   nesting levels and refuses past the limit, so both backends fail at the same depth before the
   stack runs out; by default, and for schemas without a recursion, nothing is wrapped and the
   stack is the limit (`boundary` turns its overflow into a depth error). An entity's own options come from `entities` over the
   shared ones (`SHARED`); `INHERITED` is what a nested layout, a `list` and a resolved schema
   take. An error in an entity a reference reached names it (`via`). A collection inside a record with a
   layout of its own (`layout: { path }`) is compiled as a root of its own (the module-private
   `PLANNED` option) and called through a slot too, as is the item codec of `schema.list`. Both
   backends call a slot wherever one is present; a root never keeps one, except a root `ref`,
   which aliases the referenced codec. The options that shape the wire name their places by path
   (`placesOf`): the reader marks each place it meets and reports a path that names none. The
   snapshot is untrusted input: every form is checked, nesting is limited (64), `__proto__` and
   integer-like keys are refused. The plan also has a canonical string (`schema.toString()`, with
   a `?` prefix for an optional root scalar; a reference prints as `@Name`; a name or a value with
   the form's punctuation prints as a JSON string, `print` in `plan.js`) and a *signature*
   (`signature` in `plan.js`, `schema[Symbol.for('alexify.protoarray.signature')]`): the
   canonical string followed by `;Name=<canonical>` for every other entity reached by reference,
   by name. `schema.id` is the fingerprint of the signature (FNV-1a 32-bit, or the `fingerprint`
   option's function of it, the default one hashed a piece at a time, `identify`), so a changed
   referenced entity changes the id; `resolve` and the registry compare signatures without
   writing them out (`schema[SAME](other)`, over the reached entities each schema keeps, not
   their text). Without references to other entities the signature is the
   canonical string, and both are what 1.x computed from its own DSL:
   `tests/fixtures/golden-1x.json` holds them to it.
2. **A backend builds `{ encode, decode }` from the plan.** `codegen.js` emits one encode and one
   decode function per struct through `new Function` (array and object literals, so every decoded
   object has the hidden class an object literal would). `closures.js` composes closures over the
   same plan and objects start as a spread of a literal-shaped template, so their hidden class is
   still stable. The probe `new Function('return 1')` runs once, when the first schema that may
   use generated code is built (`codegen.available()`), never for `{ codegen: false }` or a
   `compiled` codec, so such a program triggers no CSP report; `{ codegen }` forces a
   backend, `{ codegen: true }` throws `ERR_CODEGEN_UNAVAILABLE` where it cannot be honoured, and
   in automatic mode a `codegen.build` that throws for one schema falls back to closures. Both
   backends must be indistinguishable: `tests/unit/parity.test.js` checks random schemas, values,
   corrupted values and corrupted wires, and every behavioural suite loops over
   `tests/support/backends.js`. `validate` (a boolean, `{ decode }` inside) says whether decode
   checks the wire; encode trusts its values (checking them is metaschema's: `schema.source`), and
   checks only what the wire is built from (shapes, a union's discriminator, depth, the values of a
   list of differences). The codegen codec's source is
   reachable as `codec.source` through `schema[Symbol.for('alexify.protoarray.codec')]` (not
   public API), generated again on each read so a codec does not hold the text. In automatic
   mode the error that made `codegen.build` fall back to closures is kept behind
   `schema[Symbol.for('alexify.protoarray.fallback')]`.
3. **`layouts.js`** wraps the record codec when a collection uses `flat` or `columns` (a `columns`
   field with `delta` is written as differences there); `rows` is the codec of `{ array: Record }`
   itself. `schema.list` is `{ array: schema }` over the slot, so it compiles only the loop. A plan
   that reaches an interned string (`intern`, through slots too) gets the `withTable` root: the
   message's string table lives in the holder `INTERN` of `types.js` for one call, so interned
   slots are ordinary converted scalars to both backends; `Schema` calls isolate a nested root
   call (`isolated`), and a codec without intern is unchanged.

**`resolve(writer, reader)`** (`resolve.js`, the `./resolve` subpath; `register()` installs
`Schema.resolve`) walks the two plans together into a third one, compiled like any plan: a
resolved struct keeps the writer's fields in wire order, each with the reader's `key` (null:
skipped on decode, null on encode) and `required`/`def`, plus `order` (the reader's key order) and
`extras` (reader fields the writer lacks). Scalar conversions are `bridge` nodes of `types.js`.
Schema boundaries (references, nested layouts, the roots) resolve once per pair; a pair met again
while in progress is a recursion that calls a codec compiled for it, and so is a layout inside a
record. The resolved root prints as its writer (`text`) and keeps the writer's id and
fingerprint; it is built through the module-private `INTERNAL` option of `schema.js`, which the
subpath requires (as it does `SETTINGS`).

**The text builder** (`codegen.js`): with `builder` set, generated code has a `stringify` that
writes the JSON text as it encodes, with encode's checks and errors and the exact text of
`JSON.stringify` of the wire (toJSON with the positional key, `undefined` as `null`). Nested
records are written in place, unions and the root through functions; collections past `THRESHOLD`
records take `JSON.stringify`. `schema.js` sets `builder` for `stringify: 'builder'`, and for
`'auto'` only on records of converted types (`converted`), the only shape that wins against the
native path on every engine measured. Parity tests force it on random schemas.

**The binary wire** (`binary.js`, the `./binary` subpath; `register()` installs `toBinary` and
`fromBinary` on `Schema.prototype`): the same plan compiled a second time, into a writer and a
reader of bytes, on first use, kept on the schema under `Symbol.for('alexify.protoarray.binary')`
as `{ write, read, numbers, writer, reader, busy }`. The backend follows `schema.backend`:
`binary/generate.js` mirrors `codegen.js` (one `eN(w,o)`/`dN(r)` per struct, an object literal
on decode, a union as a switch, a slot as `H[k].write`/`.read` of the referenced schema's own
entry, registered before it is built so a recursion resolves) and compiles through
`codegen.compile`, the one primitive that turns source text into a function (the platform test's
count of `new Function(` stays two); `binary/closures.js` is the no-eval twin and the reference
`binary.test.js` holds it to on random schemas: same bytes, same errors and paths, with and
without validation, on corrupted values and bytes and every truncation. `validate` comes from the
schema; a union's tag is checked in every mode; decode bounds every read, count (by the bytes or
bits left) and bitmap, so no message allocates past its length. Encode trusts values but refuses
a string slot without a string and a `bytes` slot without a `Uint8Array` (`type`): the writer
measures them, and garbage would corrupt its position. A `null` root is `required`. `inspect`
refuses, before anything is built, what has no binary form (`ERR_NO_BINARY_FORM`, the place by
its path: `intern`, `delta`/`deltas`, a layout other than `rows`, a resolved plan); `readsNumbers`
walks the plan and the schemas its slots reach so the reader makes a DataView only when a float64
is read. One Writer and one Reader per schema, reset per call; `busy` is saved and restored around
a call so a re-entrant call (a `toJSON` of a json value) takes fresh ones. The wire: a struct
header of presence bits (required fields too) then the booleans' values, in whole bytes; zigzag
LEB128 exact over the safe integers (the sign in the low bit, never forming 2n); enum and tag as
a byte up to 256 values; a string's length doubled with its form in the low bit, UTF-8 up to 21
characters (`3 × 21 × 2 < 128`, one length byte), UTF-16 past them or for a lone surrogate,
read in either form at any length. Both sides need the same schema: nothing is trimmed or
tolerated. The registry envelope, streams and resolve stay on the text wire; a standalone module
written with `binary` carries the binary codec too (below).

**Standalone modules** (`standalone.js`): `errors.js`, `types.js`, `layouts.js` and
`runtime/browser.js` are closed functions (`kernel`) run once, so their source can be embedded.
Every scalar node and helper function of `types.js` carries a `recipe`, the expression that makes
it again; `toSource` runs `codegen.generate` (with the options `codecOptions` gives `build`) and
writes each helper as its recipe and each slot as a lazy reference to another schema of the module.
The `import` runtime embeds each snapshot once and builds its entities together,
`Schema.fromModel(snapshot, { entities: { E: { …options, compiled } } })` (checked against the
canonical form, `backend: 'standalone'`), so references reach the module's own compiled schemas
and nothing is compiled while it loads: the embedded snapshot is cut to the entities the module
reaches (`trimmed`, as `JSON.parse` of its text), an entity built again with other options gets
its members' codecs (`R.compiled`), a rows collection carries its record's codec (`compiled.items`)
and a nested layout's own codec is built only if called (`compileNested`); a collection inside a
record with a layout of its own is written in place (`R.nested`). An import module checks the
runtime it was written against (`R.check(ABI)`; bump `ABI` when the recipes, the slots or the
module's shape change, and the check refuses any other number). The `inline` runtime embeds the
kernels and the `inline` kernel of `standalone.js`, which does Schema's work around a codec.
Neither needs metaschema. With `binary: true` (`--binary`) `toSource` runs
`binary/generate.generate` on each schema's plan (after `binary/inspect.inspect` refused what has
no binary form, a reached entity included) and writes the codec next to the text one: in an
import module as `compiled.binary`, which `binary.js`'s `entryOf` takes instead of building
(`isCompiled` in `schema.js` validates it, `R.compiled` hands it to the members of an entity built
again), with `R.slot`'s `write`/`read` reading the carried codec of the referenced schema; in an
inline module with the embedded wire kernel (`(wire.kernel)(base64)`, the browser runtime twin)
and `numbers`, the inline kernel wrapping `toBinary`/`fromBinary` as `binary.js` does (one
writer and reader, `busy` for a re-entrant call; no `finally`, whose throw branch c8 cannot
cover). Without the option nothing of the binary wire is written.

`Schema.encode`/`decode` run the codec inside `boundary()` (`errors.js`): it puts the schema name
on `EncodeError`/`DecodeError`, writes their path and message once from the trail `nest` added
to (`settle`: an error deep in a payload is one error, its path cut to 64 levels), and turns a
stack overflow (told by the engine's message, so another `RangeError` passes through) into
`DecodeError` `structure`/`depth` or `EncodeError` `depth`. A path segment of a record's key with
a path's punctuation is quoted (`step`), a dictionary's key from the payload always unless it is a
plain name (`member`, cut to 64 characters), the same in both backends. Nothing else may escape
`decode`: `types.js` conversions are total (a value with no wire form of its type passes through
without decode validation), and every check starts with `typeof` so in-process values (a BigInt
mask, a Symbol index) fail like wire values; a sparse mask is a non-negative 31-bit integer and a
union tag is checked in every mode. A converted type checks and converts in one call
(`checkedUnpack` on the wire, `checkedPack` on a value where the two share their work); an
identity type is checked inline. Encode checks shape (`object`/`array`, an array is not a
record; a Map, a Set, a Date by its brand), a union's discriminator (`union`), the values of a
list of differences and a `decimals` number past the safe integers (`type`, the `always` nodes),
with
paths built on error branches like decode's; nothing else: the values are trusted. An enum or
union lookup never turns the value into a property key.

Wire rules (normative in `docs/guide/wire-format.md`, as data in `tests/support/vectors.js`):
one field per position in declaration order; `undefined`, `null` and a missing key travel as
`null`; trailing `null`s are trimmed; `enum` → index (any number of values), `date` → epoch ms,
`bigint` → decimal string, `bytes` → canonical base64, `{ type: 'number', decimals: n }` →
`Math.round(v × 10ⁿ)`, `flags` → bitmask (an array of 31-bit words past 31 names), a union →
`[tag, ...branch fields]`; `json` is never required; a sparse struct is `[mask, ...present]`, one
such segment per 31 fields;
decode assigns every key in schema order and gives `null` (or the default) for what was missing;
extra trailing elements are ignored unless `{ strict: true }`.

By default the wire is validated on decode and the values given to encode are trusted (1.0's
behaviour; metaschema's `check`/`parse` validate values before encode). Errors are
`EncodeError`/`DecodeError` with a path like `orders[1].sku`. Paths are built only on error
branches: generated code embeds static keys and loop indices in the throw, nested calls re-throw
through `nest()` which prepends the key. `{ validate: false }` skips type checks but never the
`Array.isArray` structure checks.

## Platform

protoarray is pure JavaScript: **nothing under `src/` may require a Node builtin** except
`src/runtime/node.js` (`tests/unit/platform.test.js` enforces this), so the same code runs in
Node.js and browsers. `browser.js` is mapped in through the `package.json` `browser` field
(`./index.js → ./browser.js`) and the `browser` condition in `exports`; the same field maps the
runtime twin `src/runtime/node.js` (`Buffer`) to `src/runtime/browser.js` (`toBase64`/`fromBase64`
where the platform has them, `btoa`/`atob` looked up on use), as in `@alexify/metaschema`. Both
halves decode only canonical base64 (the text must encode back to itself), and the platform test
checks they agree with and without the native methods. `pnpm size` bundles `browser.js` with
`platform: 'browser'`, so a leaked builtin fails CI.

The subpaths follow the same rule: `stream.js` uses only the globals `TextDecoder`,
`TransformStream` and `ReadableStream` (all in Node.js 18), `binary/wire.js` is a closed kernel
over the runtime twin (whose Node half reaches Buffer's `utf8Slice`, `ucs2Write` and `ucs2Slice`
through `.call` on a plain Uint8Array, and whose browser half uses `TextDecoder` and loops, a
lone surrogate kept), `standalone.js` requires the browser
half of the base64 twin directly for its kernel, and only `bin/` (outside `src/`) uses Node
builtins. A kernel must stay closed: nothing but its parameters and standard globals, since its
source runs on its own in an inline module (`standalone.test.js` and `bundle.test.js` run such
modules in a `vm` realm without code generation, minified too).

Code generation lives in `src/codegen.js` only (the platform test greps for `Function(` and
`eval(`), behind two targeted `// oxlint-disable-next-line no-new-func` comments. Generated code
receives everything through parameters (`H`, `F`, `N`): a minifier renames module identifiers,
and `tests/unit/bundle.test.js` runs both backends through minified bundles to prove it. Schema
keys only ever reach generated source as `JSON.stringify(key)`; `__proto__` is rejected at parse
time.

## Conventions (oxlint/oxfmt + review)

- Formatting: 2 spaces, single quotes, semicolons, trailing commas, **100 columns**, LF
  (`.oxfmtrc.json`, `.editorconfig`). Lint: `.oxlintrc.json` (shared with the sibling libraries:
  the explicit rule list, plus the `correctness` and `suspicious` categories as errors and
  `no-console` everywhere but `scripts/`, `bench/` and `bin/`). Suppress a rule only for an intentional
  construct, with a targeted `// oxlint-disable-next-line <rule>`.
- Code style:
  - module-level functions are arrow functions assigned to `const`; classes and prototype objects
    use method shorthand; no `function` declarations;
  - `Object.create(null)` for dictionaries;
  - hot loops avoid destructuring and use index loops, not `forEach`;
  - prefer `const`; no `var`;
  - private class members with `#`.
- Built-ins with the `node:` prefix; relative requires always end in `.js`.
- Self-descriptive code; comments explain *why*, not what.
- Conventional Commits (`feat(scope):`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor!:`).
- Bundle budget: 22 KB min+gzip for either entry (`pnpm size --max-gzip 22` in CI). Size does not
  limit features: when a change needs more, raise the gate to the next whole KB above the measured
  size, in the same commit. Measure after any change to `src/`.

## Skills

`.claude/skills/` holds the seven [metaskills](https://github.com/metarhia/metaskills) v1.0.5
skills: `js-conventions`, `js-data-structures`, `data-structures`, `metautil-data-structures`,
`js-gof`, `error-handling` and `npm-publish`.

- **`js-conventions` is adapted to this toolchain:** oxlint/oxfmt instead of ESLint/Prettier,
  pnpm, 100 columns, plus a Modules section (CommonJS, no `'use strict'`, `node:` prefix, `.js` in
  relative requires). Its naming, best-practice and optimization rules are upstream's.
- **`npm-publish` is adapted to the release process below:** pnpm commands, the `prepublishOnly`
  gates, this CHANGELOG's format, docs and `pnpm pack` checks, and `pnpm run release`.
- **The other five are verbatim copies.**

Keep the two adapted skills in sync with this file when conventions or the release process
change. **This file wins** if they ever disagree.

## Testing notes

- Runner: Node's built-in `node:test` + `node:assert`. Suites use flat
  `test('Area: description', …)`; keep that style.
- Behavioural suites loop over `BACKENDS` from `tests/support/backends.js` so codegen and closures
  are tested with the same cases; `normalize` from the same file turns Dates, BigInts,
  `Uint8Array`s, Sets and Maps into comparable objects and keeps a `__proto__` key an own one.
  Suites build schemas through `tests/support/schema.js`: `define(definition, options)` and
  `named(name, definition, options)` inject metaschema (a devDependency), `model(entities,
  options, types)` builds a metaschema Model's entities for references by name.
  `tests/support/vectors.js` is the wire format as data (metaschema definitions and the options
  of the wire) and the source of the docs examples; add a vector when the format gains a rule.
- `tests/fixtures/golden-1x.json` holds what protoarray 1.x computed from its own DSL before 2.0
  removed it: the canonical form of every vector, and the canonical form, id and `stringify` text
  of 120 random schemas. `snapshot.test.js` holds 2.0 to it: the wire contract does not move.
  Do not regenerate it.
- `tests/unit/parity.test.js` generates random definitions and values (`tests/support/generate.js`,
  seeded: unions, bytes, flags past 31 names, sets, maps, dictionaries, tuples of records, delta
  and interned places, and every fifth schema 32–70 fields wide for sparse segments; a shape is
  drawn with `delta`/`intern` on its fields and `translate.js` turns it into the metaschema
  definition and the options by path) and asserts
  the two backends agree on wires, decoded objects, key order and errors, on corrupted values
  (encode) and corrupted wires (decode), with the builder forced too. A second test resolves each
  schema against a mutated reader (renamed through `aliases`, dropped, shuffled, extended) and
  checks the backends agree and every reader field holds the writer's value. A failure prints the
  seed.
- `standalone.test.js` runs generated modules (both runtimes) in a `vm` context created with
  `codeGeneration: { strings: false }`, the package bundled into it, and compares them with the
  schemas on the vectors and random definitions; it also runs the `inline` kernel in process,
  since c8 attributes code run from embedded source to the `vm` script, not to `src/`. Modules
  written with `binary` are held to `toBinary`/`fromBinary` of the schemas the same way (bytes,
  values, errors on cut and flipped messages), the random definitions without their `delta`/
  `intern` options, which have no binary form; `inlineOf(schema, true)` builds the inline
  kernel's binary codec in process, its slots reaching inline copies through a cache.
  `cli.test.js` runs `bin/protoarray.js` on `tests/fixtures/` (modules of metaschema schemas);
  generated files go to the gitignored `tests/.generated/`. `stream.test.js` splits payloads at
  every byte and character for the scanner.
- `tests/unit/backend.test.js` stubs `globalThis.Function` before the first schema is built,
  which is the only way to reach the probe's fallback branch, and counts that nothing probes
  before a schema may use generated code; each test file is its own process.
  `schema.test.js` stubs `codegen.build` through the module object for the per-schema fallback,
  and `errors.test.js` stubs `codec.decode` through the codec symbol to reach the boundary's
  foreign-error and `InternalError` (SpiderMonkey stack overflow) branches.
- `schema.test.js` has the hostile-keys suite (quotes, backslashes, U+2028/2029, `${`, lone
  surrogates, `constructor`): the only test of the codegen escaping invariant. Build such strings
  with `String.fromCharCode` there: oxfmt unescapes ` ` in literals and oxlint then rejects
  the raw line separator.
- `pnpm test` passes the glob unquoted (`tests/unit/*.test.js`) so the shell expands it on Node
  18/20; Node ≥ 22 expands it itself, which is why CI runs Windows only on 22/24.
- `tests/unit/binary.test.js` is the binary wire's suite: the vectors and the random schemas on
  both backends (identical bytes; corrupted values, corrupted bytes and every truncation give the
  same outcome; validation on and off), the wire kernel over both runtime twins, the refusals by
  path, the register and the codegen fallback (`codegen.compile` stubbed through the module
  object). A count read from the wire is bounded by the bytes (or bits) left: without it a
  corrupted count overflowed `(c + 7) >> 3` and looped for minutes, and garbage in a string or
  bytes slot made the writer's position NaN and doubled its buffer until the process was killed,
  which is why encode checks those two slots.
- `tests/unit/bundle.test.js` builds `browser.js` and `index.js` with esbuild in memory (minified
  and not) and round-trips a schema through both backends, comparing as JSON because the browser
  bundle runs in another realm. That realm is a `vm` context, which has no `btoa`/`atob` unless
  the test passes them in; one test loads the bundle without them, deleting the realm's native
  `Uint8Array` base64 too, so the `btoa`/`atob` branch stays the one under test on a Node that
  ships the native methods. It runs in `pnpm test` on every matrix leg.
- `platform.test.js` checks the runtime twins: same keys, the same base64 (and the same `null` for
  non-canonical text) from both, the browser one with a stand-in for `Uint8Array`'s native base64
  as well, which Node does not have yet; the missing-`atob` test deletes the native method too.
- `tests/unit/scripts.test.js` runs `scripts/size.js` with a budget it always meets and one it
  never can.
- New behavior needs a test that fails without the change. Coverage is 100% and there are no
  `c8 ignore` comments in `src/`: an unreachable branch is removed, not ignored.

## Documentation site

VitePress in `docs/`, deployed to Vercel (`vercel.json`) at `protoarray.vercel.app`. It is not
published to npm, and lint/format do not cover it.

- Only `docs/index.md` has frontmatter; links between pages are absolute and extensionless.
- `ignoreDeadLinks` is off, so `pnpm docs:build` failing on a dead link is a feature.
- The nav version label is read from `package.json`.
- The brand is a cyan "brackets" mark (`#0891B2`, `#22D3EE` on dark; a placeholder until a final
  logo): `docs/public/logo-mark*.svg`, `favicon.svg` (follows `prefers-color-scheme`),
  `favicon.png` and `logo.png` (the 1200×630 og:image, rendered from SVG with `rsvg-convert`).
- When behavior changes, update README and the matching docs page together. Keep example outputs in
  the docs true to the code: the examples come from `tests/support/vectors.js`. Examples define
  schemas in metaschema (`import { Schema as Definition } from '@alexify/metaschema'`).
- The benchmark tables in README and `docs/guide/benchmarks.md` sit between
  `<!-- bench:<name>:start -->` markers (`compare`, `coldstart`, `size`, `releases`, `engine`;
  `binary` in the docs only) and are generated by `pnpm bench:report` from
  `bench/results/*.json` and `bench/baseline.json`,
  with the SVG charts in `docs/public/benchmarks/` that the README embeds; do not edit them by
  hand. The docs render the same models (`bench/report/model.mjs`) interactively through the
  `Bench*.vue` components, so a chart and its table cannot disagree. Every adapter of the
  comparison declares `name`, `variant`, `package` and `family` and requires its library lazily
  (`load`), so the cold start measures only the library.
- The feature matrix in README and `docs/guide/comparison.md` sits between
  `<!-- comparison:start -->` markers and is generated by `pnpm docs:comparison` from
  `docs/comparison.json`: every cell was checked against the source of the published package
  (October 2026); edit the data, not the table.
- Diagrams are ```mermaid blocks (`vitepress-plugin-mermaid`). The plugin and the config ask Vite
  to pre-bundle mermaid's CommonJS dependencies, which must then resolve from the root: pnpm does
  not hoist them, so `@braintree/sanitize-url`, `cytoscape`, `cytoscape-cose-bilkent`, `dayjs`,
  `debug` and `fastdom` are devDependencies. A missing one breaks only `docs:dev` (a blank page,
  "does not provide an export named …"), not `docs:build`, so check the dev server too.

## Release process

Manual, as in the sibling repositories. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json`.
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Commit, then tag `vX.Y.Z`.
4. Run `pnpm run release` (`pnpm publish`, gated by `prepublishOnly`; `publishConfig.access` is
   public).
