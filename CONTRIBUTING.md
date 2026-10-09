# Contributing

Thanks for helping improve protoarray. This page covers the rules that are easy to break by
accident; [CLAUDE.md](CLAUDE.md) describes how the codebase fits together.

## Getting set up

```bash
pnpm install
pnpm test
```

There is no build step. What you edit in `src/` is what ships.

## The rules that are not negotiable

**1. No runtime dependencies.** `package.json` has no `dependencies` key, and it stays that way.
When a small helper is needed, copy it into `src/` with an attribution comment. devDependencies are
fine.

**2. Plain CommonJS.** `require`/`module.exports`, no `import`/`export`, no TypeScript syntax, no
`'use strict'`. Built-in modules use the `node:` prefix, and relative requires include `.js`.

**3. No Node builtins in `src/`.** Everything under `src/` runs in browsers too.
`tests/unit/platform.test.js` fails if a builtin is required there. If a platform-specific module
is ever needed, it goes in a runtime twin mapped through the `package.json` `browser` field.

**4. A public API change touches three files together:** `src/index.js`, `index.d.ts` and a test
(plus a `tests/types` assertion for anything new). `tests/unit/export-parity.test.js` fails when
the runtime exports and the declarations drift apart.

## Tests

Node's built-in `node:test`, no external framework.

- `tests/unit/*.test.js`: one file per area. Run one with `node --test tests/unit/codec.test.js`.
- `tests/types/*.test-d.ts`: `tsd` assertions against `index.d.ts`.

`pnpm run test:coverage` enforces 98% lines and statements, 90% branches and 100% functions.

New behavior needs a test that fails without the change. For a bug fix, the test should describe
the bug, not the implementation.

## Before opening a PR

```bash
pnpm run lint
pnpm run format
pnpm test
pnpm run test:types
pnpm run check:dts
```

`prepublishOnly` runs lint, format check, coverage, tsd and `check:dts`. Treat that as the merge
gate.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat(scope):`, `fix(scope):`, `test:`, `docs:`).
