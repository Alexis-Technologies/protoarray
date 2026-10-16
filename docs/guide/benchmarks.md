# Benchmarks

`pnpm bench:compare` runs the same payloads through JSON, protoarray and the usual JavaScript
codecs and prints these tables; `pnpm bench:report` writes them here. Every (library, scenario)
pair runs in a fresh process, and an adapter has to round-trip the scenario's value through its own
format before it is timed. Speed is end to end: an object to text or bytes, and bytes back to an
object. msgpackr and cbor-x run their pure JavaScript paths, which is what a browser gets.

<!-- bench:compare:start -->

**single** — one record: 10 fields, nested address, tags, 2 orders

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,379,640 (×1.00) | 959,977 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,049,171 (×1.49) | 1,688,759 (×1.76) | 135 | 134 | 110 |
| protoarray (closures) | 1,500,700 (×1.09) | 1,054,956 (×1.10) | 135 | 134 | 110 |
| protoarray (codegen, metaschema check) | 1,131,512 (×0.82) | 1,673,102 (×1.74) | 135 | 134 | 110 |
| protoarray (standalone, inline) | 2,040,150 (×1.48) | 1,653,086 (×1.72) | 135 | 134 | 110 |
| protobufjs | 1,297,138 (×0.94) | 1,434,026 (×1.49) | 115 | 127 | 117 |
| avsc | 1,644,596 (×1.19) | 1,798,371 (×1.87) | 97 | 111 | 101 |
| msgpackr | 1,229,830 (×0.89) | 729,451 (×0.76) | 206 | 207 | 173 |
| msgpackr (records, shared structures) | 1,482,145 (×1.07) | 2,652,598 (×2.76) | 108 | 124 | 112 |
| @msgpack/msgpack | 752,480 (×0.55) | 684,807 (×0.71) | 198 | 200 | 166 |
| cbor-x (records) | 787,143 (×0.57) | 685,970 (×0.71) | 215 | 218 | 187 |
| fast-json-stringify (encode) + JSON.parse | 1,728,148 (×1.25) | 955,091 (×0.99) | 266 | 212 | 178 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,450 (×1.00) | 924 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 1,977 (×1.36) | 1,469 (×1.59) | 140,738 | 30,666 | 26,946 |
| protoarray (closures) | 1,423 (×0.98) | 968 (×1.05) | 140,738 | 30,666 | 26,946 |
| protoarray (codegen, metaschema check) | 1,098 (×0.76) | 1,458 (×1.58) | 140,738 | 30,666 | 26,946 |
| protoarray (columns) | 2,051 (×1.41) | 1,519 (×1.64) | 138,758 | 27,412 | 21,053 |
| protoarray (standalone, inline) | 2,010 (×1.39) | 1,485 (×1.61) | 140,738 | 30,666 | 26,946 |
| protoarray (columns, delta + intern) | 2,219 (×1.53) | 1,696 (×1.84) | 114,965 | 24,574 | 19,799 |
| protobufjs | 1,306 (×0.90) | 1,385 (×1.50) | 120,459 | 31,414 | 28,985 |
| avsc | 1,377 (×0.95) | 1,813 (×1.96) | 101,839 | 29,895 | 27,334 |
| msgpackr | 1,187 (×0.82) | 776 (×0.84) | 210,061 | 34,139 | 30,555 |
| msgpackr (records, shared structures) | 1,517 (×1.05) | 2,942 (×3.18) | 112,274 | 30,957 | 28,370 |
| @msgpack/msgpack | 762 (×0.53) | 717 (×0.78) | 202,061 | 33,895 | 30,367 |
| cbor-x (records) | 1,352 (×0.93) | 2,340 (×2.53) | 125,051 | 31,582 | 29,016 |
| fast-json-stringify (encode) + JSON.parse | 1,576 (×1.09) | 897 (×0.97) | 271,215 | 33,793 | 29,133 |

**sparse** — 20 optional fields, 3 present

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 6,847,095 (×1.00) | 4,861,717 (×1.00) | 33 | 53 | 36 |
| protoarray (codegen) | 7,246,764 (×1.06) | 7,688,319 (×1.58) | 23 | 43 | 27 |
| protoarray (closures) | 3,076,062 (×0.45) | 2,415,547 (×0.50) | 23 | 43 | 27 |
| protoarray (codegen, metaschema check) | 2,210,841 (×0.32) | 7,597,929 (×1.56) | 23 | 43 | 27 |
| protoarray (standalone, inline) | 7,136,228 (×1.04) | 7,415,471 (×1.53) | 23 | 43 | 27 |
| protobufjs | 5,558,833 (×0.81) | 9,393,232 (×1.93) | 11 | 31 | 15 |
| avsc | 1,459,783 (×0.21) | 3,635,058 (×0.75) | 28 | 35 | 23 |
| msgpackr | 6,139,841 (×0.90) | 6,766,730 (×1.39) | 21 | 41 | 25 |
| msgpackr (records, shared structures) | 6,034,294 (×0.88) | 12,744,271 (×2.62) | 9 | 29 | 13 |
| @msgpack/msgpack | 5,242,558 (×0.77) | 3,465,625 (×0.71) | 19 | 39 | 23 |
| cbor-x (records) | 3,103,691 (×0.45) | 3,613,254 (×0.74) | 27 | 47 | 31 |
| fast-json-stringify (encode) + JSON.parse | 14,396,199 (×2.10) | 4,615,718 (×0.95) | 33 | 53 | 36 |

**typed** — enum, boolean and date heavy record

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 834,265 (×1.00) | 2,842,769 (×1.00) | 123 | 120 | 94 |
| protoarray (codegen) | 4,902,963 (×5.88) | 4,889,285 (×1.72) | 36 | 46 | 36 |
| protoarray (closures) | 3,544,886 (×4.25) | 3,118,648 (×1.10) | 36 | 46 | 36 |
| protoarray (codegen, metaschema check) | 2,760,797 (×3.31) | 4,891,759 (×1.72) | 36 | 46 | 36 |
| protoarray (standalone, inline) | 4,798,990 (×5.75) | 4,827,354 (×1.70) | 36 | 46 | 36 |
| protobufjs | 3,675,588 (×4.41) | 11,292,678 (×3.97) | 13 | 33 | 17 |
| avsc | 1,972,256 (×2.36) | 7,970,057 (×2.80) | 12 | 32 | 16 |
| msgpackr | 2,865,434 (×3.43) | 2,856,298 (×1.00) | 73 | 96 | 72 |
| msgpackr (records, shared structures) | 3,470,761 (×4.16) | 5,430,276 (×1.91) | 24 | 45 | 28 |
| @msgpack/msgpack | 1,179,235 (×1.41) | 1,586,430 (×0.56) | 71 | 92 | 71 |
| cbor-x (records) | 1,788,634 (×2.14) | 1,600,105 (×0.56) | 79 | 100 | 80 |
| fast-json-stringify (encode) + JSON.parse | 4,817,573 (×5.77) | 2,763,508 (×0.97) | 110 | 107 | 83 |

**strings** — long Cyrillic strings

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,579,204 (×1.00) | 1,359,276 (×1.00) | 816 | 266 | 229 |
| protoarray (codegen) | 1,813,023 (×1.15) | 1,718,041 (×1.26) | 785 | 230 | 207 |
| protoarray (closures) | 1,717,342 (×1.09) | 1,576,706 (×1.16) | 785 | 230 | 207 |
| protoarray (codegen, metaschema check) | 1,574,313 (×1.00) | 1,704,821 (×1.25) | 785 | 230 | 207 |
| protoarray (standalone, inline) | 1,813,963 (×1.15) | 1,699,374 (×1.25) | 785 | 230 | 207 |
| protobufjs | 581,850 (×0.37) | 513,099 (×0.38) | 777 | 233 | 211 |
| avsc | 491,773 (×0.31) | 782,934 (×0.58) | 774 | 231 | 210 |
| msgpackr | 858,013 (×0.54) | 216,481 (×0.16) | 800 | 263 | 234 |
| msgpackr (records, shared structures) | 880,431 (×0.56) | 241,954 (×0.18) | 775 | 230 | 206 |
| @msgpack/msgpack | 383,707 (×0.24) | 707,394 (×0.52) | 798 | 260 | 233 |
| cbor-x (records) | 722,607 (×0.46) | 246,036 (×0.18) | 806 | 269 | 241 |
| fast-json-stringify (encode) + JSON.parse | 1,324,028 (×0.84) | 1,347,612 (×0.99) | 816 | 266 | 229 |

**packets** — 100 wrpc packets: calls, callbacks and events

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 50,374 (×1.00) | 25,602 (×1.00) | 8,834 | 852 | 630 |
| protoarray (codegen) | 66,960 (×1.33) | 49,206 (×1.92) | 4,332 | 685 | 501 |
| protoarray (closures) | 48,712 (×0.97) | 27,053 (×1.06) | 4,332 | 685 | 501 |
| protoarray (codegen, metaschema check) | 34,316 (×0.68) | 49,236 (×1.92) | 4,332 | 685 | 501 |
| protoarray (standalone, inline) | 67,454 (×1.34) | 50,705 (×1.98) | 4,332 | 685 | 501 |
| protobufjs | 23,322 (×0.46) | 36,859 (×1.44) | 3,691 | 778 | 609 |
| avsc | 20,404 (×0.41) | 46,601 (×1.82) | 2,833 | 633 | 521 |
| msgpackr | 31,052 (×0.62) | 23,096 (×0.90) | 6,800 | 842 | 640 |
| msgpackr (records, shared structures) | 29,686 (×0.59) | 91,357 (×3.57) | 3,697 | 725 | 566 |
| @msgpack/msgpack | 25,189 (×0.50) | 21,495 (×0.84) | 6,400 | 804 | 614 |
| cbor-x (records) | 24,197 (×0.48) | 51,001 (×1.99) | 4,401 | 841 | 683 |

**numeric** — 32 doubles (where binary formats shine)

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 323,546 (×1.00) | 479,268 (×1.00) | 764 | 406 | 392 |
| protoarray (codegen) | 403,512 (×1.25) | 735,638 (×1.53) | 582 | 309 | 295 |
| protoarray (closures) | 372,124 (×1.15) | 568,991 (×1.19) | 582 | 309 | 295 |
| protoarray (codegen, metaschema check) | 337,781 (×1.04) | 737,642 (×1.54) | 582 | 309 | 295 |
| protoarray (standalone, inline) | 426,501 (×1.32) | 691,578 (×1.44) | 582 | 309 | 295 |
| protobufjs | 700,770 (×2.17) | 1,893,492 (×3.95) | 305 | 328 | 304 |
| avsc | 1,961,794 (×6.06) | 3,114,374 (×6.50) | 256 | 279 | 260 |
| msgpackr | 1,107,674 (×3.42) | 449,157 (×0.94) | 409 | 429 | 376 |
| msgpackr (records, shared structures) | 1,411,341 (×4.36) | 3,452,899 (×7.20) | 289 | 312 | 280 |
| @msgpack/msgpack | 737,825 (×2.28) | 191,825 (×0.40) | 409 | 429 | 376 |
| cbor-x (records) | 714,132 (×2.21) | 440,909 (×0.92) | 416 | 435 | 355 |
| fast-json-stringify (encode) + JSON.parse | 1,845,786 (×5.70) | 484,920 (×1.01) | 764 | 406 | 392 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-16. Median of 5 rounds in a fresh process per library and scenario (the spread of the rounds is in bench/results/compare.json); bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

<!-- bench:compare:end -->

## Reading the numbers

- **Records and strings** are where JSON transports live, and where protoarray is the fastest
  text codec in the table and encodes faster than every binary one: `JSON.parse` and
  `JSON.stringify` are native, generated code adds tens of nanoseconds, and the positional array
  is less than half the bytes. protobufjs, @msgpack/msgpack and cbor-x decode strings byte by byte
  in JavaScript and fall behind; the binary codecs that decode records faster are listed below.
- **msgpackr with shared structures** is the binary equivalent of protoarray (a structure id plus
  the values) and decodes small records faster than `JSON.parse` can read text. On encoding
  protoarray is ahead.
- **Numbers** are the honest exception: a double prints as up to 17 characters and parses back
  through a decimal conversion, where avsc and protobufjs read 8 bytes. Use a binary codec for
  dense numeric payloads.
- **Tagged messages** (`packets`, 100 wrpc calls, callbacks and events): each library spells a
  union its own way, a protobuf `oneof`, an Avro union of records, protoarray's discriminated
  union. protoarray encodes fastest, writes half the bytes of JSON (and the fewest after brotli
  of any format here), and decodes about twice as fast as `JSON.parse`, level with avsc and
  cbor-x; msgpackr with shared structures decodes faster.
- **Validation.** The wire is checked on decode and the values given to encode are trusted, so
  the protoarray rows above encode the way protobufjs and msgpackr do, without checks, and decode
  with them. Checking the values is metaschema's: the `protoarray (codegen, metaschema check)` row
  in the full tables runs metaschema's `check` of the same schema before every encode, which is
  what validating each outgoing value costs.
- **Sizes**: protoarray's wire is JSON text; the binary codecs' bytes are before any base64 a
  text channel would add. After gzip or brotli the formats are close, and `columns` is the
  smallest on lists. With the id written as differences and the cities and tags interned
  (`protoarray (columns, delta + intern)`), the thousand records are another 17% smaller before
  compression and 6–10% after it, and encode and decode faster; interning the unique strings
  (names, emails) instead would make the gzip larger, since their table compresses worse than
  the strings in place.
- **Standalone modules**: `protoarray (standalone, inline)` is the same codec written into a module
  that carries its own runtime (see [Standalone Modules](/guide/standalone)): what a strict CSP or
  an edge runtime gets instead of the closures backend, at the speed of generated code.

`pnpm bench` is the engine harness for protoarray alone (both backends, every layout, against the
JSON of the keyed object), with `--save` and `--compare` to track a change on one machine. It also
measures the text builder against the native `stringify` path with the text read once, as sending
it would (see [Runtimes](/guide/runtimes#how-stringify-writes-the-text)), a resolved schema, an
inline standalone module, and `parseItems` against parsing the whole text.

Building a schema is no part of these tables. `Schema.from(definition, { metaschema })` has
metaschema read the definition first and protoarray read its snapshot after: two to four times the
time 1.x took to parse its own spelling of it (about 70 µs for the nested record with codegen, 40
µs with closures, once per schema). A schema built from a snapshot skips metaschema, about half of
that (34 µs); `pnpm bench` prints both and a cold start.
