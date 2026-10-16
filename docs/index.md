---
layout: home

title: protoarray
titleTemplate: Compact positional payloads for JavaScript

hero:
  name: protoarray
  text: Compact positional payloads for JavaScript
  tagline: Send objects as positional arrays and let a shared schema map every position back to its key. Smaller than JSON, faster than JSON, still JSON. A fast, zero-dependency alternative to Protocol Buffers for Node.js and browsers.
  image:
    src: /logo-mark.svg
    alt: protoarray
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why protoarray?
      link: /guide/why
    - theme: alt
      text: View on GitHub
      link: https://github.com/Alexis-Technologies/protoarray

features:
  - icon: 📦
    title: Objects in, arrays out
    details: "{ name: 'Alex', age: 27 } travels as ['Alex', 27]. Keys are not repeated in every message: both sides already know them from the schema."
    link: /guide/why
    linkText: How it works
  - icon: ⚡
    title: Faster than JSON
    details: "A positional array is less work for JSON.parse and JSON.stringify, and generated code rebuilds objects with one hidden class per schema: ×1.5 encode, ×1.7 decode on a typical record."
    link: /guide/benchmarks
    linkText: Benchmarks
  - icon: 🗺️
    title: Schemas from metaschema
    details: "One @alexify/metaschema definition validates the values and shapes the wire: scalars, optional fields, nested records, collections, enums, dates, flags, unions and references. Its snapshot is plain JSON a server can hand to its clients."
    link: /guide/metaschema
    linkText: metaschema and protoarray
  - icon: 🔁
    title: Evolves safely
    details: "Append fields at the end and old and new versions keep understanding each other. A fingerprint tells versions apart in a handshake."
    link: /guide/evolution
    linkText: Compatibility rules
  - icon: 🪶
    title: Zero dependencies
    details: "About 21 KB min+gzip, no build step, metaschema not required: a client builds its schemas from snapshots. Generated code where the runtime allows it, a closures fallback or a standalone module under a strict CSP."
    link: /guide/runtimes
    linkText: Runtimes
  - icon: 🌐
    title: Node.js and browsers
    details: "One CommonJS package with ESM named imports and hand-written TypeScript typings that take a schema's types from the metaschema schema it is built from."
    link: /guide/typescript
    linkText: TypeScript
---
