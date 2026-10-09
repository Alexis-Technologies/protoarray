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
pnpm run test:coverage             # c8 over src/, gated at 98 lines/statements, 90 branches, 100 functions
pnpm run test:types                # tsd: tests/types/*.test-d.ts against index.d.ts
pnpm run check:dts                 # tsc --noEmit --strict over index.d.ts on its own
pnpm run lint                      # oxlint src tests scripts bench
pnpm run format                    # oxfmt src tests scripts bench (format:check in CI)
pnpm size [--max-gzip <KB>]        # esbuild bundle sizes for index.js and browser.js; CI gates at 8 KB min+gzip
pnpm bench [filter] [--json] [--save] [--compare]   # engine ops/sec, manual only; --save writes bench/baseline.json
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
  schema.js         Schema class: options, plan → backend, list/id/stringify/parse
  plan.js           definition DSL → plan (node tree), canonical form, FNV-1a fingerprint
  types.js          scalar type table: wire checks and conversions, shared by both backends
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

1. **`plan.js`** parses the definition into a plan: a tree of nodes (`struct`, `array`, `tuple`,
   `scalar`, `ref`). A struct node holds `fields` (`key`, `index`, `required`, `def`, `node`),
   `keys`, `sparse` and `tail` (the index where the trailing run of optional fields starts, the
   only part that may be trimmed off the wire). Scalar nodes come from `types.js` and carry
   `check`, `pack` and `unpack` (null for identity types). A `Schema` used as a field embeds its
   plan node; a name (`'User'`) becomes a `ref` node that calls the referenced schema's codec
   through a slot, which is also how self-recursion works (the slot is filled after the build).
   The plan also has a canonical string (`schema.toString()`) and its FNV-1a fingerprint
   (`schema.id`).
2. **A backend builds `{ encode, decode }` from the plan.** `codegen.js` emits one encode and one
   decode function per struct through `new Function` (array and object literals, so every decoded
   object has the hidden class an object literal would). `closures.js` composes closures over the
   same plan and objects start as a spread of a literal-shaped template, so their hidden class is
   still stable. The probe `new Function('return 1')` runs once at load; `{ codegen }` forces a
   backend, `{ codegen: true }` throws `ERR_CODEGEN_UNAVAILABLE` where it cannot be honoured. Both
   backends must be indistinguishable: `tests/unit/parity.test.js` checks random schemas, values
   and corrupted wires, and every behavioural suite loops over `tests/support/backends.js`.
3. **`layouts.js`** wraps the record codec when a collection uses `flat` or `columns`; `rows` is the
   codec of `{ array: Record }` itself.

Wire rules (normative in `docs/guide/wire-format.md`, as data in `tests/support/vectors.js`):
one field per position in declaration order; `undefined`, `null` and a missing key travel as
`null`; trailing `null`s are trimmed; `enum` → index, `date` → epoch ms, `bigint` → decimal
string, `flags` → bitmask; `json` is never required; a sparse struct is `[mask, ...present]`;
decode assigns every key in schema order and gives `null` (or the default) for what was missing;
extra trailing elements are ignored unless `{ strict: true }`.

Decode validates by default (structure, types, required, enum range) and throws `DecodeError`
with a path like `orders[1].sku`. Paths are built only on error branches: generated code embeds
static keys and loop indices in the throw, nested calls re-throw through `nest()` which prepends
the key. `{ validate: false }` skips type checks but never the `Array.isArray` structure checks.

## Platform

protoarray is pure JavaScript: **nothing under `src/` may require a Node builtin**
(`tests/unit/platform.test.js` enforces this), so the same code runs in Node.js and browsers.
`browser.js` is mapped in through the `package.json` `browser` field (`./index.js → ./browser.js`)
and the `browser` condition in `exports`. If a platform-specific module is ever needed, add a
runtime twin (`src/runtime/node.js` + `src/runtime/browser.js` with one interface, as in
`@alexify/metaschema`), map it in the `browser` field, and narrow the platform test to it.
`pnpm size` bundles `browser.js` with `platform: 'browser'`, so a leaked builtin fails CI.

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
- Bundle budget: 8 KB min+gzip for either entry (`pnpm size --max-gzip 8` in CI); the library is
  about 7 KB. Measure after any change to `src/`.

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
  are tested with the same cases; `normalize` from the same file turns Dates and BigInts into
  comparable objects. `tests/support/vectors.js` is the wire format as data and the source of the
  docs examples; add a vector when the format gains a rule.
- `tests/unit/parity.test.js` generates random definitions and values (`tests/support/generate.js`,
  seeded) and asserts the two backends agree on wires, decoded objects, key order and errors,
  including on corrupted wires. A failure prints the seed.
- `tests/unit/backend.test.js` stubs `globalThis.Function` before the first `require`, which is
  the only way to reach the probe's fallback branch; each test file is its own process.
- `pnpm test` passes the glob unquoted (`tests/unit/*.test.js`) so the shell expands it on Node
  18/20; Node ≥ 22 expands it itself, which is why CI runs Windows only on 22/24.
- `tests/unit/bundle.test.js` builds `browser.js` and `index.js` with esbuild in memory (minified
  and not) and round-trips a schema through both backends, comparing as JSON because the browser
  bundle runs in another realm. It runs in `pnpm test` on every matrix leg.
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
