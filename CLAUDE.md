# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**protoarray** (npm package `@alexify/protoarray`) is a schema-based compact serialization library
for JavaScript, a lightweight alternative to Protocol Buffers. A payload such as
`{ name: 'Alex', age: 27 }` travels as the positional array `['Alex', 27]`; the client and the
server share a schema of keys and positions, so the receiver knows that position `0` is `name` and
position `1` is `age`. The payload is still plain JSON. It has zero runtime dependencies and runs
in Node.js ≥ 18 and browsers.

It is maintained by Alexis Technologies and set up like the sibling libraries
`@alexify/metaschema`, `@alexify/kerberos` and `@alexify/migronaut`. `origin` is
`Alexis-Technologies/protoarray`. The definition DSL is a subset of metaschema's, so one
definition can serve both libraries.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
node --test tests/unit/codec.test.js   # a single file
node --test --test-name-pattern="Layouts" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/, gated at 100 lines/statements/branches/functions per file
pnpm run test:types                # tsd: tests/types/*.test-d.ts against index.d.ts
pnpm run check:dts                 # tsc --noEmit --strict over index.d.ts on its own
pnpm run lint                      # oxlint src tests scripts bench
pnpm run format                    # oxfmt src tests scripts bench (format:check in CI)
pnpm size [--max-gzip <KB>]        # esbuild bundle sizes for index.js and browser.js; CI gates at 17 KB min+gzip
pnpm bench [filter] [--json] [--save] [--compare]   # engine ops/sec (median of 5 rounds ± spread), manual only; --save writes bench/baseline.json
pnpm bench:compare [--scenarios a,b] [--adapters x,y] [--save]   # against JSON, protobufjs, avsc, msgpackr, …
pnpm bench:report                  # renders bench/results/compare.json into README.md and docs/guide/benchmarks.md
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:types + check:dts. Treat it as the
pre-merge gate. There is no build step.

## No build step: CommonJS + hand-written types

- `src/` is plain CommonJS (`require`/`module.exports`) and ships as is. No TypeScript syntax, no
  `import`/`export`, no `'use strict'`.
- The root `index.js` is a one-line shim over `src/index.js`. `browser.js` intentionally mirrors
  it. Do not deduplicate the two (see "Platform").
- `src/index.js` lists every export **by name** (`module.exports = { Schema, encode, … }`), never by
  spreading module objects. cjs-module-lexer only sees named keys, and ESM
  `import { Schema } from '@alexify/protoarray'` depends on it.
- `index.d.ts` is the only source of the public types, written by hand. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports for both entries and imports every name from ESM.
  `tests/types/index.test-d.ts` (tsd) pins signatures and the `Infer`/`Input` inference.
  `check:dts` needs `--target es2022` because there is no tsconfig. `Infer`/`Input` are mapped and
  conditional types over the definition literal; `AnySchema` (not `Schema<any>`) is what
  `FieldDefinition` and `options.schemas` accept, because comparing two generic `Schema` types
  recurses through `list` and makes TypeScript give up ("excessively deep").
- `package.json` has a closed `exports` map (`types` first, then `browser`, then `default`) and a
  `files` allowlist: `index.js`, `index.d.ts`, `browser.js`, `src`, README, CHANGELOG, LICENSE and
  SECURITY.

## Zero dependencies

There is no `dependencies` key in `package.json`, and there won't be one. If a small helper is
needed, copy it into `src/` with an attribution header rather than adding a dependency.
devDependencies are fine (the comparative benchmark has several).

## Repository layout

```
index.js  browser.js  index.d.ts   root entry shims + hand-written types
src/
  index.js          public barrel (explicit named exports)
  schema.js         Schema class: options, plan → backend, list/id/stringify/parse/check
  plan.js           definition DSL → plan (node tree), canonical form, FNV-1a fingerprint
  types.js          scalar type table: wire and encode checks, conversions, shared by both backends
  runtime/          base64 twin for `bytes`: node.js (Buffer) and browser.js (toBase64/btoa)
  codegen.js        new Function backend (the only file that may compile source text)
  closures.js       no-eval backend, same semantics, used as the fallback and as the reference
  layouts.js        flat and columns layouts over a record codec
  codec.js          functional entry points over a Schema
  errors.js         SchemaDefinitionError, EncodeError, DecodeError, fail/nest helpers
tests/
  unit/*.test.js    node:test suites, one per area, every behavioural suite runs per backend
  support/          BACKENDS + normalize, the wire-format vectors, the random generator
  types/*.test-d.ts tsd assertions
scripts/size.js     bundle-size report and budget gate (CI smoke)
bench/              engine harness (bench.js), comparison (compare.js + compare/), report.js;
                    baseline.json and results/compare.json are snapshots
docs/               VitePress site (protoarray.vercel.app), not published
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

`new Schema(name, definition, options)` runs three steps once, at construction:

1. **`plan.js`** parses the definition into a plan: a tree of nodes (`struct`, `union`, `array`,
   `tuple`, `scalar`, `ref`). A struct node holds `fields` (`key`, `index`, `required`, `def`,
   `node`), `keys`, `sparse` and `tail` (the index where the trailing run of optional fields
   starts, the only part that may be trimmed off the wire). Scalar nodes come from `types.js` and
   carry `check` (the wire), `accept` (a value given to encode), `pack` and `unpack` (null for
   identity types). A `union` node holds the discriminator `key`, a `tag` enum over the values of
   all branches and `branches` (`node`, `first`, `count`, `source`): each branch is a fresh struct
   node without the discriminator, with `tag` (`key`, `position`, `keys`, `values`), always
   inlined from its plan so the union's options apply. A `Schema` used as a field embeds its
   plan node (for the canonical form) **with a `slot` to its compiled codec**; a name (`'User'`)
   becomes a `ref` node with the same kind of slot, which is also how self-recursion works (the
   slot is filled after the build). Both backends call a slot wherever one is present, so an
   embedded schema keeps its own options and layout and is compiled once; a root never keeps a
   slot (this schema's options apply to it), except a root `ref`, which aliases the referenced
   codec. Every slot also has a lazy `checker`: the codec `schema.check` runs. The plan also has a canonical string (`schema.toString()`, with a `?` prefix for an
   optional root scalar) and its fingerprint (`schema.id`: FNV-1a 32-bit, or the `fingerprint`
   option's function of the canonical string).
2. **A backend builds `{ encode, decode }` from the plan.** `codegen.js` emits one encode and one
   decode function per struct through `new Function` (array and object literals, so every decoded
   object has the hidden class an object literal would). `closures.js` composes closures over the
   same plan and objects start as a spread of a literal-shaped template, so their hidden class is
   still stable. The probe `new Function('return 1')` runs once at load; `{ codegen }` forces a
   backend, `{ codegen: true }` throws `ERR_CODEGEN_UNAVAILABLE` where it cannot be honoured, and
   in automatic mode a `codegen.build` that throws for one schema falls back to closures. Both
   backends must be indistinguishable: `tests/unit/parity.test.js` checks random schemas, values,
   corrupted values and corrupted wires, and every behavioural suite loops over
   `tests/support/backends.js`. `validate` is a direction (`schema.js` turns `true`/`'decode'`,
   `'encode'`, `'both'` and `false` into `{ encode, decode }` flags): decode checks are emitted
   only under `validate.decode`, encode checks only under `validate.encode` (codegen decides at
   generation time, closures through build-time flags), so a codec that does not ask for a check
   carries none and the default encode costs what 1.0 did. The codegen codec's source is
   reachable as `codec.source` through `schema[Symbol.for('alexify.protoarray.codec')]` (not
   public API), generated again on each read so a codec does not hold the text. In automatic
   mode the error that made `codegen.build` fall back to closures is kept behind
   `schema[Symbol.for('alexify.protoarray.fallback')]`.
3. **`layouts.js`** wraps the record codec when a collection uses `flat` or `columns`; `rows` is the
   codec of `{ array: Record }` itself. `schema.list` is `{ array: schema }` over the slot, so it
   compiles only the loop.

`schema.check(value)` runs a second codec, `schema[Symbol.for('alexify.protoarray.checker')]`,
built on first use from the same plan with validation on and `checking` set: it calls each slot's
`checker` instead of its `codec`, so embedded schemas and recursive references built with
`validate: false` are checked too.

`Schema.encode`/`decode` run the codec inside `boundary()` (`errors.js`): it puts the schema name
on `EncodeError`/`DecodeError` and turns a stack overflow (a recursive payload nested deeper than
the call stack, a cyclic value; told by the engine's message, so another `RangeError` passes
through) into `DecodeError` `structure`/`depth` or `EncodeError` `depth`. Nothing else may escape
`decode`: `types.js` conversions are total (a value with no wire form of its type passes through
without decode validation), and every check starts with `typeof` so in-process values (a BigInt
mask, a Symbol index) fail like wire values; a sparse mask is a non-negative 31-bit integer and a
union tag is checked in every mode. A converted type checks and converts in one call
(`checkedUnpack` on the wire, `checkedPack` on a value where the two share their work); an
identity type is checked inline. Encode always checks shape (`object`/`array`, an array is not a
record) and a union's discriminator (`union`); under `validate.encode` it also checks `required`,
`type` and `enum`, with paths built on error branches like decode's. An enum or union lookup
never turns the value into a property key, so `check()` throws nothing over the data.

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
behaviour); `{ validate: 'both' }` validates the values too. Errors are
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
  `no-console` everywhere but `scripts/` and `bench/`). Suppress a rule only for an intentional
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
- Bundle budget: 17 KB min+gzip for either entry (`pnpm size --max-gzip 17` in CI). Size does not
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
  are tested with the same cases; `normalize` from the same file turns Dates, BigInts and
  `Uint8Array`s into comparable objects. `tests/support/vectors.js` is the wire format as data and the source of the
  docs examples; add a vector when the format gains a rule.
- `tests/unit/parity.test.js` generates random definitions and values (`tests/support/generate.js`,
  seeded: unions, bytes, flags past 31 names, and every fifth schema 32–70 fields wide for sparse
  segments) and asserts the two backends agree on wires, decoded objects, key order and errors,
  on corrupted values (encode) and corrupted wires (decode). A failure prints the seed.
- `tests/unit/backend.test.js` stubs `globalThis.Function` before the first `require`, which is
  the only way to reach the probe's fallback branch; each test file is its own process.
  `schema.test.js` stubs `codegen.build` through the module object for the per-schema fallback,
  and `errors.test.js` stubs `codec.decode` through the codec symbol to reach the boundary's
  foreign-error and `InternalError` (SpiderMonkey stack overflow) branches.
- `schema.test.js` has the hostile-keys suite (quotes, backslashes, U+2028/2029, `${`, lone
  surrogates, `constructor`): the only test of the codegen escaping invariant. Build such strings
  with `String.fromCharCode` there: oxfmt unescapes ` ` in literals and oxlint then rejects
  the raw line separator.
- `pnpm test` passes the glob unquoted (`tests/unit/*.test.js`) so the shell expands it on Node
  18/20; Node ≥ 22 expands it itself, which is why CI runs Windows only on 22/24.
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
  the docs true to the code: the examples come from `tests/support/vectors.js`.
- The benchmark tables in README and `docs/guide/benchmarks.md` sit between
  `<!-- bench:compare:start -->` markers and are generated by `pnpm bench:report` from
  `bench/results/compare.json`; do not edit them by hand.

## Release process

Manual, as in the sibling repositories. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json`.
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Commit, then tag `vX.Y.Z`.
4. Run `pnpm run release` (`pnpm publish`, gated by `prepublishOnly`; `publishConfig.access` is
   public).
