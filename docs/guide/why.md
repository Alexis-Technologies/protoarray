# Why protoarray?

::: warning Work in progress
protoarray is being designed. The idea below is settled; the schema format and the API are not.
`encode` and `decode` are exported today as placeholders that throw.
:::

## The idea

A JSON payload repeats every key in every message:

```js
JSON.stringify({ name: 'Alex', age: 27 });
// '{"name":"Alex","age":27}'  (24 bytes)
```

When the client and the server already agree on the shape, the keys carry no information. protoarray
sends only the values, in a fixed order:

```js
JSON.stringify(['Alex', 27]);
// '["Alex",27]'  (11 bytes)
```

A schema shared by both sides records that position `0` is `name` and position `1` is `age`, so
the receiver turns the array back into the object it describes.

## Compared with JSON

- **Smaller payloads.** Keys are dropped from the wire, which matters most for many small messages
  and for arrays of records with the same shape.
- **Faster to parse.** A positional array is less work for `JSON.parse` than the same values with
  keys. Run `pnpm bench` in the repository to see the reference numbers on your machine.
- **Same transport.** The result is still JSON, so it goes through HTTP, WebSocket, message brokers
  and storage that already handle JSON.

## Compared with Protocol Buffers

- **No toolchain.** No `.proto` files, no compiler and no generated code. A schema is a plain
  JavaScript value.
- **No dependencies.** protoarray has no runtime dependencies and works the same in Node.js and
  browsers.
- **Readable on the wire.** The payload stays JSON, so it can be logged and inspected as is. The
  trade-off is that it is not a binary format.
