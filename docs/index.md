---
layout: home

title: protoarray
titleTemplate: Compact positional payloads for JavaScript

hero:
  name: protoarray
  text: Compact positional payloads for JavaScript
  tagline: Send objects as positional arrays and let a shared schema map every position back to its key. A zero-dependency alternative to Protocol Buffers for Node.js and browsers.
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
  - icon: 🗺️
    title: Schema-driven
    details: "A schema lists the keys and their positions. The client and the server share it, so the payload carries only values."
    link: /guide/why
    linkText: The idea
  - icon: 🪶
    title: Zero dependencies
    details: "No runtime dependencies, no code generation and no build step. The payload is still plain JSON, so any transport that carries JSON carries it."
    link: /guide/getting-started
    linkText: Installation
  - icon: 🌐
    title: Node.js and browsers
    details: "One CommonJS package with ESM named imports and hand-written TypeScript typings, for Node.js 18+ and any bundler."
    link: /api/exports
    linkText: API
---
