# With wrpc

[`@alexify/wrpc`](https://wrpc.vercel.app/) sends JSON packets over WebSocket, HTTP, SSE and
more. Its packet `codec` option takes an object with `encode(packet) → text` and
`decode(text) → packet`, the same on both sides of the wire. Every wrpc packet carries its kind in
`type`, which is exactly what a protoarray union picks its branch by, so a packet travels as its
tag and its fields: `{ type: 'call', id: '7', method: 'chat/send', args: { text: 'hi' } }` becomes
`[0,"7","chat/send",{"text":"hi"}]`.

::: tip
An official codec will ship with wrpc itself. Until then, the schema below is the shape to build
one from, and the code after it is a codec that runs wrpc's own codec tests.
:::

```js
const { Schema } = require('@alexify/protoarray');
const { Schema: Definition } = require('@alexify/metaschema');

// wrpc 2 packets; `id` is a string, or a number from a 1.0 client.
const Packet = Schema.from(new Definition('Packet', {
  union: [
    {
      Struct: {},
      type: { enum: ['call'] },
      id: 'json',
      method: 'string',
      args: 'json',
      meta: 'json',
      'timeout?': 'number',
      'tp?': 'string',
      'ts?': 'string',
    },
    { Struct: {}, type: { enum: ['callback'] }, id: 'json', result: 'json', error: 'json' },
    {
      Struct: {},
      type: { enum: ['event'] },
      name: 'string',
      data: 'json',
      id: 'json',
      meta: 'json',
      'tp?': 'string',
      'ts?': 'string',
    },
    {
      Struct: {},
      type: { enum: ['subscribe'] },
      id: 'json',
      method: 'string',
      args: 'json',
      lastEventId: 'json',
      meta: 'json',
      'tp?': 'string',
      'ts?': 'string',
    },
    { Struct: {}, type: { enum: ['data'] }, id: 'json', eventId: 'json', data: 'json' },
    { Struct: {}, type: { enum: ['end'] }, id: 'json', error: 'json' },
    { Struct: {}, type: { enum: ['unsubscribe', 'cancel'] }, id: 'json' },
    {
      Struct: {},
      type: { enum: ['stream'] },
      id: 'json',
      'name?': 'string',
      'size?': 'number',
      'status?': { enum: ['end', 'terminate'] },
    },
    { Struct: {}, type: { enum: ['ping', 'pong'] }, enc: 'json', 'v?': 'number' },
  ],
  discriminator: 'type',
}));
const Batch = Packet.list;

const codec = {
  contentType: 'application/x-protoarray',
  encode: (value) => (Array.isArray(value) ? Batch.stringify(value) : Packet.stringify(value)),
  decode: (text) => {
    const wire = JSON.parse(text);
    // A packet starts with its tag, a number; a batch with a packet, an array.
    return wire.length === 0 || Array.isArray(wire[0]) ? Batch.decode(wire) : Packet.decode(wire);
  },
};
```

A few things to know:

- **A batch is an array of packets.** wrpc hands the codec either one packet or an array of them,
  and both come back the same way: a packet is an array that starts with a number, a batch an
  array of such arrays.
- **Only the fields in the schema travel.** protoarray drops the keys a schema does not have, so
  the schema has to list every field the wrpc version you run sends; that is the job the official
  codec will take over. A field a decoded packet does not have comes back as `null`, which wrpc
  reads as absent.
- **Branches and tags are positions.** Add packet types and fields at the end, as the
  [evolution rules](/guide/evolution#unions) say, and give both peers the same schema: a codec has
  no negotiation in wrpc. `Packet.id` can travel in your own handshake, or in a header, to check
  that they agree. A browser client that should not carry metaschema builds `Packet` from its
  snapshot instead (`Schema.from(snapshot)`, see [metaschema and protoarray](/guide/metaschema#from-a-snapshot)).
- **The kind first.** Every packet has `type` as its first key, which metaschema reads as the long
  form of a type, so each branch names its kind before it: `{ Struct: {}, type: … }`.
- **Payloads can be typed too.** `args`, `result` and `data` are `json` here, so they travel as
  plain JSON inside the packet. A method with a schema of its own can encode its arguments with it
  and send the array as `args`.
- **Binary data.** Under a codec wrpc hands `Uint8Array` values to `encode` as they are; a field
  declared as `bytes` carries them as base64.
- **Errors.** A frame that does not decode throws `DecodeError` (or a `SyntaxError` for text that
  is not JSON), which wrpc answers as a malformed packet.

::: warning
A `Schema` itself has `encode` and `decode` methods, so wrpc's structural check accepts it as a
codec, but those return arrays, not text. Always wrap `stringify` and `parse` as above.
:::

On 100 mixed calls, callbacks and events, this codec writes half the bytes of JSON and decodes
them about twice as fast; see the `packets` scenario in [Benchmarks](/guide/benchmarks).
