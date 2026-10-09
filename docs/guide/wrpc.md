# With wrpc

[`@alexify/wrpc`](https://wrpc.vercel.app/) sends JSON packets over WebSocket, HTTP, SSE and
more. Its packet `codec` option takes an object with `encode(packet) → text` and
`decode(text) → packet`, so a protoarray schema plugs in through `stringify` and `parse`:

```js
const { Schema } = require('@alexify/protoarray');

const Packet = new Schema('Packet', {
  type: { enum: ['call', 'callback', 'event', 'ping', 'pong'] },
  id: '?string',
  method: '?string',
  args: '?json',
  result: '?json',
  error: '?json',
  name: '?string',
  data: '?json',
});

const codec = {
  encode: (packet) => Packet.stringify(packet),
  decode: (text) => Packet.parse(text),
};
```

Both sides must use the same codec. The packet schema above keeps the envelope positional and
leaves the method arguments as `json`; to go further, give each method its own schema for `args`
and `result` and encode them inside the envelope.

::: warning
A `Schema` itself has `encode` and `decode` methods, so wrpc's structural check accepts it as a
codec, but those return arrays, not text. Always wrap `stringify` and `parse` as above.
:::

A `type`-discriminated union (`[tag, ...fields]`) is on the roadmap; until then the envelope
carries every field of every packet type as optional slots, which trailing trimming keeps short.
