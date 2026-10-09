# Getting Started

::: warning Work in progress
The protoarray format is being designed. The package can be installed, but `encode` and `decode`
are placeholders that throw `encode is not implemented yet` and `decode is not implemented yet`.
:::

## Installation

```bash
pnpm add @alexify/protoarray
# or
npm install @alexify/protoarray
```

Node.js 18 or newer, or any browser through a bundler. The package has no runtime dependencies.

## Importing

```js
const { encode, decode } = require('@alexify/protoarray');
```

```js
import { encode, decode } from '@alexify/protoarray';
```

See [Why protoarray?](/guide/why) for the idea behind the format and the [API](/api/exports) for
the current exports.
