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
    `SchemaDefinitionError` (`ERR_INVALID_SNAPSHOT`, or the code of the form) with the path,
    never a `TypeError` or a `RangeError` from inside the reader;
  - nesting and chains of type aliases are limited, so a deep snapshot cannot exhaust the stack;
  - `__proto__` and integer-like keys are refused (`ERR_RESERVED_KEY`, `ERR_INTEGER_KEY`), as is
    `__proto__` as an enum value or a flag name; entities and types are looked up as own
    properties only;
  - keys, enum values and defaults reach generated code only through `JSON.stringify`.

  What the reader cannot check is intent: a peer that sends a snapshot decides the schema the
  receiver encodes and decodes with, which fields it has, which are required, and what they decode
  to. Accept snapshots only from a peer you trust to define your wire (your own server, over an
  authenticated channel, or your own build), and bound their size as any input: compiling a schema
  takes time and memory in proportion to it.
- **Payloads are untrusted data.** A payload can come from anywhere. What `decode` and `parse`
  guarantee for any input:
  - Whatever `validate` is set to, the only error they throw is `DecodeError`: for any JSON text,
    and for any in-process value as well (a `BigInt` as a sparse mask, a `Symbol` as an enum
    index, an array as a bitmask, a negative mask). A payload of a recursive schema nested deeper
    than the call stack is reported as `DecodeError` with code `structure` ("nested too deeply"),
    not as a `RangeError`. The one exception is the platform's: a `bytes` field in a realm with
    neither `Uint8Array.fromBase64` nor `atob` throws a `ReferenceError` (see
    [Runtimes](https://protoarray.vercel.app/guide/runtimes)).
  - The array structure, a sparse mask and a union tag are checked even with `validate: false`.
    In that mode values are trusted and not checked; a value that has no wire form of its type is
    left as it is, never converted into something else and never read from a prototype.
  - Nothing is written to `Object.prototype` or any other shared object. `__proto__` is rejected
    as a key, as an enum value and as a flag name when the schema is built, and decoded objects
    are built from literals with the schema's own keys.
  - Error messages carry the path and the expected type, never a value from the payload, so they
    are safe to log. `EncodeError` and `DecodeError` also carry the schema name.
  - Work is linear in the size of the input: one pass, one allocation per array, no backtracking.
    Bound the size of a payload on the transport: a `bigint` field accepts a decimal string of any
    length, and `BigInt()` grows faster than linearly with it.
  - Arrays of scalars and `json` values are returned by reference from the array `decode` was
    given.
- **Code generation.** The codegen backend compiles source text with `new Function` in one place,
  `src/codegen.js`. Schema content (keys, enum values, defaults), from a definition or from a
  snapshot, enters that source only through `JSON.stringify`, never concatenated raw, and the
  generated functions receive everything else as parameters. Where `new Function` is blocked, or
  if compiling one schema's function fails, the closures backend is used instead. Both backends
  run through the same test suite and a differential suite on random schemas and corrupted
  payloads.
- **Encoding** trusts the values it is given, the way 1.0 did: it checks shape, not types. A
  record that is not an object (an array is not one), a collection or tuple that is not an array,
  a set or a map of the wrong kind, a union value whose discriminator is not one of its values and
  a value a `delta` list cannot hold throw `EncodeError` with the path; a cyclic value, or one nested deeper than the call stack, is
  `EncodeError` with code `depth`. Everything else travels as it is given, or as `null` where it
  has no wire form of its type. Validate untrusted values before encoding them with metaschema's
  `check` or `parse` (`schema.source`), which apply every rule of the definition. A conversion that
  throws on its own over an unchecked value (`+value` on an object with a throwing
  `Symbol.toPrimitive`) is the caller's own error and passes through as it is.
