# Exports

::: warning Work in progress
Both functions are placeholders: they throw until the protoarray format is implemented, and their
signatures will change with it.
:::

```js
const { encode, decode } = require('@alexify/protoarray');
```

## `encode(schema, value)`

Turns an object into a positional array described by `schema`.

```ts
function encode(schema: unknown, value: object): unknown[];
```

Throws `Error('encode is not implemented yet')`.

## `decode(schema, array)`

Turns a positional array back into the object described by `schema`.

```ts
function decode(schema: unknown, array: readonly unknown[]): object;
```

Throws `Error('decode is not implemented yet')`.
