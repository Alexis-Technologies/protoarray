# Runtimes and CSP

protoarray compiles each schema into specialised functions with `new Function`: array and object
literals that V8 turns into packed arrays and objects with one shared hidden class. That is where
most of the speed comes from.

Some runtimes forbid compiling source text:

| Runtime | `new Function` |
| --- | --- |
| Node.js, Deno, Bun | allowed (unless started with `--disallow-code-generation-from-strings`) |
| Browsers without a CSP | allowed |
| Browsers with `Content-Security-Policy: script-src` without `'unsafe-eval'` | blocked, `EvalError` |
| Cloudflare Workers, Vercel Edge Runtime | blocked |
| React Native (Hermes) | allowed by default |

protoarray probes once, when the module loads, and falls back to a second backend built from
closures. Nothing changes in the API; `schema.backend` says which one is in use:

```js
const User = Schema.from({ id: 'number', name: 'string' });
User.backend; // 'codegen' where allowed, 'closures' under a strict CSP
```

The probe only proves that source text compiles. If the runtime still refuses one schema's
function, that schema falls back to closures on its own, and the error that caused it is kept off
the public surface, so a fallback can be told from a choice when something looks slower than it
should:

```js
User[Symbol.for('alexify.protoarray.fallback')]; // undefined, or the EvalError the runtime threw
```

Both backends produce the same wire, the same objects in the same key order and the same errors;
the test suite runs every case through both and a property-based suite checks them against each
other on random schemas.

## Choosing explicitly

```js
Schema.from(definition, { codegen: false }); // closures, everywhere
Schema.from(definition, { codegen: true });  // codegen, or ERR_CODEGEN_UNAVAILABLE
```

`{ codegen: false }` is the way to run under a report-only CSP without a violation report, or to
compare the two.

## What the fallback costs

Closures cannot write object literals, so decoded objects start as a copy of a template with the
schema's keys (which keeps their hidden class stable) and are filled one property at a time. On a
typical record the closures backend stays within 10% of `JSON.stringify` and `JSON.parse` of the
keyed object, a little ahead on one record and a little behind on a list; the codegen backend is
×1.5 and ×1.7. The cost of closures grows with the number of fields, about 40 ns per field on
decode against a few in generated code, so a sparse record of 70 fields decodes about 15 times
slower than with codegen. The payload is identical either way; building a schema takes about a
millisecond in a fresh process with either backend (`pnpm bench` prints a cold-start table).

## Node.js versions and browsers

Node.js 18 and newer; the test matrix runs 18, 20, 22 and 24. Browsers need `Symbol.for`,
`Object.create(null)`, spread and `??`, which every evergreen browser has had for years. The
browser bundle is the same code: `package.json` maps `index.js` to `browser.js`.

One file differs between the two: the base64 of the `bytes` type. In Node.js,
`src/runtime/node.js` uses `Buffer` from `node:buffer`; the `browser` field of `package.json`
maps it to `src/runtime/browser.js`, which uses `Uint8Array.prototype.toBase64` and
`Uint8Array.fromBase64` where the platform has them and `btoa`/`atob` elsewhere (every browser,
Deno, Bun, Workers, React Native 0.74+). It looks them up when a `bytes` value is converted, so a
realm without them loads the package and fails only on `bytes`. Bundlers that read the `browser`
field (esbuild, webpack, Vite, Rollup with its node-resolve plugin and `browser: true`, Wrangler)
pick the browser half; the `browser` export condition alone only swaps the entry point, the twin
is mapped by the field. Deno and Bun run the Node half.
