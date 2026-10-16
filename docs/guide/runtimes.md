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

protoarray asks the runtime once, when the first schema that may use generated code is built, and
falls back to a second backend built from closures. Nothing changes in the API; `schema.backend`
says which one is in use:

```js
const User = Schema.from(snapshot);
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
Schema.from(source, { codegen: false }); // closures, everywhere
Schema.from(source, { codegen: true });  // codegen, or ERR_CODEGEN_UNAVAILABLE
```

The runtime is asked once, when the first schema that may use generated code is built: a program
that builds every schema with `{ codegen: false }`, or loads them from a
[standalone module](/guide/standalone), never calls `new Function`, so even a report-only CSP
reports nothing. `{ codegen: false }` is also the way to compare the two.

## What the fallback costs

Closures cannot write object literals, so decoded objects start as a copy of a template with the
schema's keys (which keeps their hidden class stable) and are filled one property at a time. On a
typical record the closures backend stays within 10% of `JSON.stringify` and `JSON.parse` of the
keyed object, a little ahead on one record and a little behind on a list; the codegen backend is
×1.5 and ×1.8. The cost of closures grows with the number of fields, about 40 ns per field on
decode against a few in generated code, so a sparse record of 70 fields decodes about 15 times
slower than with codegen. The payload is identical either way; in a fresh process, loading the
package takes about 4 ms and building a first schema about 2 ms with either backend, a few
microseconds once warm (`pnpm bench` prints a cold-start table).

A very wide record makes a large function: about 200 to 500 bytes of source a field, 4 ms to build
for 1,000 fields and 16 ms for 3,000. It still decodes two to ten times faster than closures do,
so the automatic choice stays codegen however wide a record is.

## Without code generation, at its speed

Where `new Function` is blocked, a [standalone module](/guide/standalone) brings the generated code
along: `protoarray compile` (or `toSource`) writes the code of your schemas into a module at build
time, and the runtime loads it like any other module. Its schemas run at the speed of the codegen
backend under a strict CSP, in Workers or at the edge.

## How stringify writes the text

`stringify` is `JSON.stringify` of the wire, or the same text written by generated code as it
encodes, without the intermediate array. Which is faster depends on the engine: since V8 12
(Node.js 22, Chrome 126) `JSON.stringify` has a fast path that writes strings and floats faster
than JavaScript can, while records of booleans, enums, flags, dates, integers and decimals still
go faster by hand everywhere. The `stringify` option picks:

| `stringify` | Writes the text by hand | Measured against the native path |
| --- | --- | --- |
| `'auto'` (default) | records whose leaves are booleans, enums, flags, dates, integers or decimals | ×1.0 to ×1.85 on Node.js 18 to 24 |
| `'builder'` | any schema with the codegen backend, but for a `flat` or `columns` collection and an interned schema, whose text is their wire's | ×1.2 to ×1.8 on Node.js 20; down to ×0.7 on string-heavy records on Node.js 22 and 24 |
| `'native'` | never | — |

The text is the same either way, byte for byte, and so are the errors: a property-based test holds
them together. Collections of more than 64 records always go through `JSON.stringify`. The closures
backend always does.

## What a bundle carries

`pnpm size` bundles each entry with esbuild, minified, and CI holds the core under its budget:

| Entry | min+gzip |
| --- | ---: |
| `@alexify/protoarray` (Node.js and browser entries) | 21.4 KB, 21.5 KB |
| `@alexify/protoarray/registry`, over the core (it brings `resolve`) | +2.5 KB |
| `@alexify/protoarray/resolve`, over the core | +1.9 KB |
| `@alexify/protoarray/stream`, over the core | +1.8 KB |
| `@alexify/protoarray/standalone`, over the core | +2.4 KB |

metaschema is not part of any of them: protoarray never requires it. A program that defines its
schemas brings metaschema itself, the core or the 10.3 KB `./definition` entry that builds schemas
without validating them; a client that receives snapshots needs none of it (see
[metaschema and protoarray](/guide/metaschema)).

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
