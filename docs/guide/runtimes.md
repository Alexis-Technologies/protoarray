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
typical record the closures backend encodes about 10% faster than `JSON.stringify` of the keyed
object and decodes at the same speed as `JSON.parse`; the codegen backend is ×1.5 and ×1.7. The
payload is identical either way.

## Node.js versions and browsers

Node.js 18 and newer; the test matrix runs 18, 20, 22 and 24. Browsers need `Symbol.for`,
`Object.create(null)`, spread and `??`, which every evergreen browser has had for years. The
browser bundle is the same code: `package.json` maps `index.js` to `browser.js`, and nothing in
the package requires a Node builtin.
