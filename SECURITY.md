# Security Policy

## Supported versions

Only the latest published minor version receives fixes.

| Version | Supported |
|---|---|
| 1.x | ✅ |

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

- **Schemas are code.** A schema is a JavaScript value supplied by the application. Build schemas
  only from definitions you trust, the same as any other module you `require`.
- **Payloads are untrusted data.** A payload can come from anywhere. What `decode` and `parse`
  guarantee for any input:
  - With the default `validate: true`, the only error they throw is `DecodeError`: for any JSON
    text, and for any in-process value as well (a `BigInt` as a sparse mask, a `Symbol` as an
    enum index). A payload of a recursive schema nested deeper than the call stack is reported as
    `DecodeError` with code `structure` ("nested too deeply"), not as a `RangeError`.
  - The array structure is checked even with `validate: false`. In that mode values are trusted
    and not checked; a value that has no wire form of its type is left as it is, never converted
    into something else and never read from a prototype.
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
  `src/codegen.js`. Schema content (keys, enum values, defaults) enters that source only through
  `JSON.stringify`, never concatenated raw, and the generated functions receive everything else as
  parameters. Where `new Function` is blocked, or if compiling one schema's function fails, the
  closures backend is used instead. Both backends run through the same test suite and a
  differential suite on random schemas and corrupted payloads.
- **Encoding** trusts the values it is given. It checks shape, not types: a record that is not an
  object, or a collection or tuple that is not an array, throws `EncodeError` with the path. A
  value nested deeper than the call stack throws a `RangeError`: it is the caller's own data.
