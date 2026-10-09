# Security Policy

## Supported versions

Only the latest published version receives fixes.

| Version | Supported |
|---|---|
| 0.x | ✅ |

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

The protoarray format is still being designed, and this section will be completed with it. The
principles it is designed around:

- **Schemas are code.** A schema is a JavaScript value supplied by the application. Build schemas
  only from definitions you trust, the same as any other module you `require`.
- **Payloads are untrusted data.** A payload can come from anywhere. Decoding any input must not
  throw anything but a documented error, hang, consume unbounded resources, or write to
  `Object.prototype` or any other shared object.
