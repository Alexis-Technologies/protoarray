# Compression

protoarray does not compress: its job is to remove the structure that carries no information,
and to do it in a form that `JSON.parse` reads faster. Compression belongs to the transport,
where every browser and Node.js already have it natively, and where it is free in bytes of
library code.

## What survives compression

Measured on a record with ten fields, a nested address and tags (Node 24, `node:zlib`):

| Records | Layout | raw | gzip -6 | brotli -11 | zstd -19 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | keyed JSON | 236 | 202 | 162 | 188 |
| 1 | protoarray rows | 133 | 135 | 119 | 122 |
| 1000 | keyed JSON | 238,690 | 34,393 | 25,784 | 27,319 |
| 1000 | protoarray rows | 135,690 | 31,296 | 24,331 | 26,110 |
| 1000 | protoarray columns | 133,710 | 28,294 | 20,621 | 21,492 |

Three things to read from it:

- **Before compression, positional arrays are about 45% smaller** than keyed JSON, whatever the
  size. That is the number that matters for CPU time (`JSON.parse` is linear in bytes), for memory
  and for every channel without compression: small HTTP responses that servers do not compress,
  WebSocket frames without `permessage-deflate`, `localStorage`, logs, query strings.
- **After compression the gain depends on the message size.** A single record stays about 35%
  smaller after gzip, because there is nothing for the compressor to reuse. On a thousand records
  gzip already turns every repeated key into a two-byte back-reference, and rows are only 5–10%
  smaller; the [`columns` layout](/guide/collections#columns) gets that back to about 20%, because
  each column is a run of values the compressor can model.
- **Typed compaction keeps paying after compression.** An enum index or a timestamp is a shorter
  literal, and compressors cannot shorten literals the way they shorten repetitions: on the same
  thousand records, enum indexes, booleans and epoch timestamps instead of strings cut another 15%
  after gzip.

## Where to compress

- **HTTP:** `Content-Encoding: br`, `gzip` or `zstd`, negotiated by the server or the CDN. Nothing
  to do in the application.
- **WebSocket:** `permessage-deflate` in the server library.
- **In the application**, when there is no transport compression: `CompressionStream` is a global
  in Node.js 18+ and every evergreen browser:

```js
const compress = async (text, format = 'gzip') => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const bytes = await compress(User.list.stringify(users));
```

`gzip` and `deflate` are available everywhere; `brotli` in `CompressionStream` has reached Firefox,
Safari and Node.js 22.20+ but not Chrome; `zstd` only through `node:zlib`.

## Shared dictionaries

A schema both sides hold is a dictionary agreed in advance, which is also what zstd's trained
dictionaries and HTTP's Compression Dictionary Transport (`Available-Dictionary`, Chrome 130+)
do for the compressor: a few hundred bytes of typical records as a dictionary make even keyed JSON
compress to a third. The two compose: a positional payload with a dictionary is smaller still, and
protoarray works today in the browsers that do not support dictionary transport yet.
