# Standalone Modules

protoarray compiles each schema into specialised functions with `new Function`. Where compiling
source text is forbidden (a `Content-Security-Policy` without `'unsafe-eval'`, Cloudflare Workers,
Vercel Edge), it falls back to the closures backend, which is correct but slower (see
[Runtimes](/guide/runtimes)). A standalone module brings the generated code along instead: it is
written once, at build time, and the runtime loads it like any other module.

## protoarray compile

```sh
protoarray compile src/schemas.js --out src/schemas.compiled.js
```

The command loads a module of schemas (CommonJS or ES), takes the schemas it exports and writes a
module with their code and the code of every schema they reach: embedded ones, ones referenced by
name, recursion. Options:

| Option | |
| --- | --- |
| `--out <file>` | where to write; stdout without it |
| `--format cjs \| esm` | the module format, `cjs` by default |
| `--runtime import \| inline` | what the module needs at runtime, `import` by default (below) |
| `--only A,B` | the named exports only |

A module whose export is one schema gives a module with that schema as its default export;
otherwise the schemas keep their export names.

## toSource

The command is a wrapper around `toSource` from `@alexify/protoarray/standalone`, for a build
script of your own:

```js
const fs = require('node:fs');
const { toSource } = require('@alexify/protoarray/standalone');
const { User, Order } = require('./schemas.js');

fs.writeFileSync('schemas.compiled.js', toSource({ User, Order }, { format: 'esm' }));
```

`toSource(schema)` writes one schema as the default export, `toSource({ A, B })` named exports.
`register()` from the same subpath adds `schema.toSource(options)`.

## The two runtimes

| `runtime` | The module | Exports |
| --- | --- | --- |
| `'import'` (default) | imports `@alexify/protoarray` and `@alexify/protoarray/standalone` | real `Schema` instances: the whole API, `instanceof` the package's errors |
| `'inline'` | carries the source of the package's error classes, type table, layouts and base64, and imports nothing | objects with `name`, `id`, `keys`, `layout`, `encode`, `decode`, `stringify`, `parse`, `check` |

With `import`, each schema is built from its definition as usual, with the generated codec passed
as the `compiled` option; its `backend` is `'standalone'`. The definition is checked against the
code: a module older than its definition throws `SchemaDefinitionError` `ERR_COMPILED_MISMATCH`
when it loads, so a stale build fails loudly instead of misreading payloads. What a standalone
schema derives at runtime (`schema.list`, the codec of `check` when the module has none) uses the
closures backend where code generation is blocked.

`inline` suits a runtime where even the package itself is unwelcome. Its errors are classes of the
module's own, so tell them by `name` and `code`, not by `instanceof`.

Either way the module never compiles source text, and its schemas run at the speed of the codegen
backend: on the benchmark's nested record, ×1.5 faster to `stringify` and ×1.85 faster to `parse`
than `JSON` of the keyed object, where the closures backend a runtime without code generation
would otherwise use is about as fast as `JSON` (×1.5 and ×2 slower than the module).

## What it does not write

- A schema from `Schema.resolve`: it is built at runtime from two schemas; write the writer and
  the reader, and resolve them at runtime.
- A schema built from a metaschema `Schema`: write the one `fromMetaschema` builds.
- A custom `fingerprint` function: the module carries each schema's `id` as it was computed, and
  the schemas it derives at runtime (`list`) use the default fingerprint.

Regenerate the module whenever a definition changes; the `ERR_COMPILED_MISMATCH` check is there
for the times one forgets.
