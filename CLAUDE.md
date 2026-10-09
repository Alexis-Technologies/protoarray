# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**protoarray** (npm package `@alexify/protoarray`) is a schema-based compact serialization library
for JavaScript, a lightweight alternative to Protocol Buffers. A payload such as
`{ name: 'Alex', age: 27 }` travels as the positional array `['Alex', 27]`; the client and the
server share a schema of keys and positions, so the receiver knows that position `0` is `name` and
position `1` is `age`. The payload is still plain JSON. It has zero runtime dependencies and runs
in Node.js ≥ 18 and browsers.

**Status: the format is being designed.** `encode` and `decode` are exported as placeholders that
throw (`src/codec.js`); their signatures in `index.d.ts` are provisional. The package, its tooling,
tests and docs are already wired around those two names.

It is maintained by Alexis Technologies and set up like the sibling libraries
`@alexify/metaschema`, `@alexify/kerberos` and `@alexify/migronaut`. `origin` is
`Alexis-Technologies/protoarray`.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
node --test tests/unit/codec.test.js   # a single file
node --test --test-name-pattern="Bundle" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/, gated at 98 lines/statements, 90 branches, 100 functions
pnpm run test:types                # tsd: tests/types/*.test-d.ts against index.d.ts
pnpm run check:dts                 # tsc --noEmit --strict over index.d.ts on its own
pnpm run lint                      # oxlint src tests scripts bench
pnpm run format                    # oxfmt src tests scripts bench (format:check in CI)
pnpm size [--max-gzip <KB>]        # esbuild bundle sizes for index.js and browser.js; CI gates at 4 KB min+gzip
pnpm bench [filter] [--json] [--save] [--compare]   # ops/sec harness, manual only; --save writes bench/baseline.json
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:types + check:dts. Treat it as the
pre-merge gate. There is no build step.

## No build step: CommonJS + hand-written types

- `src/` is plain CommonJS (`require`/`module.exports`) and ships as is. No TypeScript syntax, no
  `import`/`export`, no `'use strict'`.
- The root `index.js` is a one-line shim over `src/index.js`. `browser.js` intentionally mirrors
  it. Do not deduplicate the two (see "Platform").
- `src/index.js` lists every export **by name** (`module.exports = { encode, decode }`), never by
  spreading module objects. cjs-module-lexer only sees named keys, and ESM
  `import { encode } from '@alexify/protoarray'` depends on it.
- `index.d.ts` is the only source of the public types, written by hand. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports for both entries and imports every name from ESM.
  `tests/types/index.test-d.ts` (tsd) pins signatures. `check:dts` needs `--target es2022` because
  there is no tsconfig.
- `package.json` has a closed `exports` map (`types` first, then `browser`, then `default`) and a
  `files` allowlist: `index.js`, `index.d.ts`, `browser.js`, `src`, README, CHANGELOG, LICENSE and
  SECURITY.

## Zero dependencies

There is no `dependencies` key in `package.json`, and there won't be one. If a small helper is
needed, copy it into `src/` with an attribution header rather than adding a dependency.
devDependencies are fine.

## Repository layout

```
index.js  browser.js  index.d.ts   root entry shims + hand-written types
src/
  index.js          public barrel (explicit named exports)
  codec.js          encode/decode placeholders
tests/
  unit/*.test.js    node:test suites, one per area
  types/*.test-d.ts tsd assertions
scripts/size.js     bundle-size report and budget gate (CI smoke)
bench/              zero-dependency ops/sec harness; baseline.json is a snapshot for --compare
docs/               VitePress site (protoarray.vercel.app), not published
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

To be written with the format. Open design questions: the schema format (keys and positions),
nested objects and arrays of records, optional and missing fields, and schema versioning between
clients and servers.

## Platform

protoarray is pure JavaScript: **nothing under `src/` may require a Node builtin**
(`tests/unit/platform.test.js` enforces this), so the same code runs in Node.js and browsers.
`browser.js` is mapped in through the `package.json` `browser` field (`./index.js → ./browser.js`)
and the `browser` condition in `exports`. If a platform-specific module is ever needed, add a
runtime twin (`src/runtime/node.js` + `src/runtime/browser.js` with one interface, as in
`@alexify/metaschema`), map it in the `browser` field, and narrow the platform test to it.
`pnpm size` bundles `browser.js` with `platform: 'browser'`, so a leaked builtin fails CI.

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
- `pnpm test` passes the glob unquoted (`tests/unit/*.test.js`) so the shell expands it on Node
  18/20; Node ≥ 22 expands it itself, which is why CI runs Windows only on 22/24.
- `tests/unit/bundle.test.js` builds `browser.js` and `index.js` with esbuild in memory (minified
  and not) and calls the API through the result, so the shipped files keep working after a
  consumer's bundler. It runs in `pnpm test` on every matrix leg; esbuild supports Node 18.
- `tests/unit/scripts.test.js` runs `scripts/size.js` with a budget it always meets and one it
  never can.
- New behavior needs a test that fails without the change.

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
  the docs true to the code.

## Release process

Manual, as in the sibling repositories. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json`.
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Commit, then tag `vX.Y.Z`.
4. Run `pnpm run release` (`pnpm publish`, gated by `prepublishOnly`; `publishConfig.access` is
   public).
