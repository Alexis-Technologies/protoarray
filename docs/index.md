---
layout: home

title: protoarray
titleTemplate: Schema-based serialization that stays JSON

hero:
  name: protoarray
  text: Schema-based serialization that stays JSON
  tagline: Objects travel as positional arrays, about half the bytes of JSON, faster than JSON.stringify and JSON.parse, and on records, strings and tagged messages faster to encode than the binary codecs. One metaschema definition validates the values and shapes the wire. No compiler, no dependencies, Node.js and browsers.
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
      text: Compare with alternatives
      link: /guide/comparison

features:
  - icon: 📦
    title: Half the bytes, still JSON
    details: "{ name: 'Alex', age: 27 } travels as ['Alex', 27]: the keys never repeat, both sides know them from the schema. The payload is plain JSON, so HTTP, WebSocket, brokers, logs and storage take it as it is."
    link: /guide/why
    linkText: How it works
  - icon: ⚡
    title: Fast as a binary codec
    details: "Native JSON.parse and JSON.stringify do the text, generated code the rest: ×1.5 encode and ×1.8 decode against JSON on a typical record, and the fastest encoder of the comparison on records, strings and tagged messages."
    link: /guide/benchmarks
    linkText: Benchmarks
  - icon: 🗺️
    title: One metaschema definition
    details: "The @alexify/metaschema definition that validates the values shapes the wire too: enums, dates, BigInts, bytes, decimals, flags, sets, maps, unions and references. Its snapshot is JSON a server hands to its clients."
    link: /guide/metaschema
    linkText: metaschema and protoarray
  - icon: 🔁
    title: Evolution and migrations
    details: "Append fields and older and newer peers keep reading each other. resolve() reads an old writer's payload into the current shape (renames, defaults, widened types), and a registry tags each payload with the id of its schema."
    link: /guide/resolve
    linkText: Migrations and the registry
  - icon: 🧱
    title: Layouts for lists
    details: "Columns, a flat stride or a presence mask for sparse records, ids written as differences and repeated strings interned: a list of a thousand records takes 58% fewer bytes than JSON, and the least after gzip of any format measured."
    link: /guide/collections
    linkText: Collections and layouts
  - icon: 🛡️
    title: Any runtime, even a strict CSP
    details: "Generated code where the runtime allows it, closures where it does not. protoarray compile writes your schemas into a module that runs at the speed of generated code with no eval: Workers, the edge, a strict CSP."
    link: /guide/standalone
    linkText: Standalone modules
  - icon: 🌊
    title: Streams
    details: "NDJSON and TransformStreams for Node.js and browsers, and parseItems to read the records of a long array as the text arrives, with a length limit for untrusted input."
    link: /guide/streaming
    linkText: Streaming
  - icon: 🪶
    title: Zero dependencies, about 22 KB
    details: "No runtime dependencies and about 22 KB min+gzip; the registry, resolve, streams and standalone modules are subpaths you import when you need them. CommonJS with ESM named imports, TypeScript types from the metaschema schema."
    link: /guide/runtimes
    linkText: Runtimes
---

<script setup>
import BenchCompare from './.vitepress/theme/components/BenchCompare.vue';
</script>

## Benchmarks

protoarray is measured against JSON and eleven JavaScript codecs on the same seven payloads, each
library in a fresh process and checked to give the value back before it is timed. The chart shows
a round trip, one encode and one decode; pick a scenario, or encode, decode and the payload sizes
on their own. protoarray is the fastest encoder on records, strings and tagged messages and has
the fastest round trip of one record, decodes faster than JSON on every payload and faster than
every codec on long strings, and writes about half the bytes of JSON. msgpackr's shared
structures decode faster on the other payloads, and mostly numeric ones are the honest
exception, where avsc and msgpackr lead.

<BenchCompare />

[Method, cold start, bundle size, release over release and the two backends →](/guide/benchmarks)
