# Security Policy

## Supported versions

Only the latest published minor version of a supported major receives fixes.

| Version | Supported |
|---|---|
| 2.x | ✅ |
| 1.x | ❌ (upgrade: [Migrating from 1.x](https://protoarray.vercel.app/guide/migrating-from-1); the wire is the same) |

Node.js: the package declares `engines.node >= 18` and CI runs 18, 20, 22 and 24. A line that
Node.js itself no longer maintains stays in the matrix while it passes; a failure specific to an
end-of-life line does not block a release.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Alexis-Technologies/protoarray/security/advisories/new),
or by email to <dolid.sasha@gmail.com>.

Include, as far as you can:

- what an attacker can do, and what they need in order to do it;
- the affected version and Node.js version (or browser);
- a minimal reproduction.

You can expect an acknowledgement within a few days, and an assessment of severity and a fix
timeline once the report is confirmed.


## Threat model

- **Definitions are code.** A schema is defined in `@alexify/metaschema`, as a JavaScript value
  supplied by the application, and metaschema reads it. Build schemas only from definitions you
  trust, the same as any other module you `require`.
- **A snapshot is data, and it defines your wire.** A snapshot (`schema.toSnapshot()`,
  `model.toJSON()`) is plain JSON, so it can come from a file, a build step or the network: a
  server may hand its schemas to its clients. protoarray reads it as untrusted input:
  - its format, the entity asked for and every form in it are checked, and a broken one throws
    `SchemaDefinitionError` (`ERR_INVALID_SNAPSHOT`, or the code of the form) with the path; what
    breaks the reader where no check of its own does (a getter that throws, in a snapshot built
    in process) is `ERR_INVALID_SNAPSHOT` too, the error as its `cause`;
  - nesting is limited per entity (64 levels), and the entities a reference reaches are read from
    a list, not by a recursion, so neither a deep snapshot nor a long chain of references exhausts
    the stack; references that lead back to themselves with no record between them are refused;
  - `__proto__` and integer-like keys are refused (`ERR_RESERVED_KEY`, `ERR_INTEGER_KEY`), as is
    `__proto__` as an enum value or a flag name and an integer-like flag name; entities, types
    and the `types` option are looked up as own properties only;
  - keys, enum values, defaults and type names reach generated code only through
    `JSON.stringify`.

  What the reader cannot check is intent: a peer that sends a snapshot decides the schema the
  receiver encodes and decodes with, which fields it has, which are required, and what they decode
  to. Accept snapshots only from a peer you trust to define your wire (your own server, over an
  authenticated channel, or your own build), and bound their size as any input. Reading is linear
  in the snapshot; computing a schema's id takes time in proportion to the entities it reaches by
  reference, all of them, so a dense graph of entities costs more than its size (a 2.6 MB
  snapshot of 1,200 entities, each reaching up to a thousand others, takes about 3 s).
- **Payloads are untrusted data.** A payload can come from anywhere. What `decode` and `parse`
  guarantee for any input:
  - Whatever `validate` is set to, the only error they throw is `DecodeError`: for any JSON text,
    and for any in-process value as well (a `BigInt` as a sparse mask or in a list of
    differences, a `Symbol` as an enum index, an array as a bitmask, a negative mask). A payload
    of a recursive schema nested deeper than the call stack is `DecodeError` `structure` ("nested
    too deeply"); where the stack ends differs between backends and engines, so set `maxDepth`
    (512 is reached by both everywhere) to refuse a deep payload at the same level on either, and
    sooner. The one exception is the platform's: a
    `bytes` field in a realm with neither `Uint8Array.fromBase64` nor `atob` throws a
    `ReferenceError` (see [Runtimes](https://protoarray.vercel.app/guide/runtimes)). The
    registry's `decode` and `parse` give the same guarantee: an envelope whose id the reader
    cannot read, unknown or of a version it cannot resolve, is `DecodeError` `schema`.
  - The array structure, a sparse mask and a union tag are checked even with `validate: false`.
    In that mode values are trusted and not checked; a value that has no wire form of its type is
    left as it is, never converted into something else and never read from a prototype.
  - Nothing is written to `Object.prototype` or any other shared object. `__proto__` is rejected
    as a key, as an enum value and as a flag name when the schema is built, decoded objects are
    built from literals with the schema's own keys, and a dictionary's `__proto__` key stays an
    own property.
  - `message`, `path` and `code` are safe to log: the one part of the payload they hold is a
    dictionary's key in a path, written as a plain name or as a quoted JSON string cut to 64
    characters, so never a line break or an escape sequence; an envelope's id is the error's
    `id`, not part of its message. A path keeps 64 levels at most, both of its ends. The `cause`
    may quote the payload (the `SyntaxError` of `JSON.parse`, the scanner of a stream naming a
    character): log it with care.
  - Work is linear in the size of the input: one pass, one allocation per array, no backtracking;
    an error deep in a payload costs as much as the levels it goes through. Bound the size of a
    payload on the transport: a `bigint` field accepts a decimal string of any length, and
    `BigInt()` grows faster than linearly with it.
  - Arrays of scalars and `json` values are returned by reference from the array `decode` was
    given.
- **Streams.** `parseLines`, `parseStream` and `parseItems` hold one line or one item at a time,
  never the whole payload, and no more than `maxLength` characters of it (16 MiB by default): a
  longer one is `DecodeError` `structure` at its index. They give the guarantees of `decode`
  above. A stream that is read through `getReader()` is cancelled when the consumer stops early.
- **Code generation.** The codegen backend compiles source text with `new Function` in one place,
  `src/codegen.js`, and only once a schema may use it: a program that builds its schemas with
  `{ codegen: false }`, or loads them from a generated module, never tries (no CSP report).
  Schema content (keys, enum values, defaults), from a definition or from a snapshot, enters that
  source only through `JSON.stringify`, never concatenated raw, and the generated functions
  receive everything else as parameters. Where `new Function` is blocked, or if compiling one
  schema's function fails, the closures backend is used instead. Both backends run through the
  same test suite and a differential suite on random schemas and corrupted payloads.
- **Generated modules and the CLI.** A module `toSource` or `protoarray compile` writes is code:
  load it as you would any module of yours. Its `compiled` codecs are trusted as given, and
  `ERR_COMPILED_MISMATCH` says a module is stale (another schema, another version of
  protoarray), not that it is intact. `protoarray compile` loads (and so runs) the module it is
  given, with `require` or `import`: compile only modules you would run.
- **Encoding** trusts the values it is given, the way 1.0 did: it checks shape, not types. A
  record that is not an object (an array is not one), a collection or tuple that is not an array,
  a set or a map of the wrong kind (told by its brand, not by a tag it claims), a union value whose
  discriminator is not one of its values, a value a `delta` list cannot hold and a number a
  `decimals` field cannot scale to a safe integer throw `EncodeError` with the path; a cyclic
  value, or one nested deeper than the call stack (or than `maxDepth` levels of a recursion), is
  `EncodeError` with code `depth`. Everything else travels as it is given, or as `null` where it
  has no wire form of its type (a `BigInt` or a `Symbol` as a date). Validate untrusted values
  before encoding them with metaschema's `check` or `parse` (`schema.source`), which apply every
  rule of the definition. A conversion that throws on its own over an unchecked value (`+value`
  on an object with a throwing `Symbol.toPrimitive`) is the caller's own error and passes through
  as it is.
