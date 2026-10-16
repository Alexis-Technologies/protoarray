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
| JSON | 1,417,812 (×1.00) | 982,136 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,082,841 (×1.47) | 1,726,288 (×1.76) | 135 | 134 | 110 |
| protoarray (closures) | 1,499,018 (×1.06) | 1,070,681 (×1.09) | 135 | 134 | 110 |
| protoarray (codegen, metaschema check) | 1,152,290 (×0.81) | 1,745,096 (×1.78) | 135 | 134 | 110 |
| protoarray (standalone, inline) | 2,095,032 (×1.48) | 1,740,319 (×1.77) | 135 | 134 | 110 |
| protobufjs | 1,383,211 (×0.98) | 1,495,901 (×1.52) | 115 | 127 | 117 |
| avsc | 1,656,205 (×1.17) | 1,851,547 (×1.89) | 97 | 111 | 101 |
| msgpackr | 1,250,888 (×0.88) | 734,635 (×0.75) | 206 | 207 | 173 |
| msgpackr (records, shared structures) | 1,465,051 (×1.03) | 2,728,598 (×2.78) | 108 | 124 | 112 |
| @msgpack/msgpack | 769,124 (×0.54) | 702,602 (×0.72) | 198 | 200 | 166 |
| cbor-x (records) | 792,208 (×0.56) | 691,743 (×0.70) | 215 | 218 | 187 |
| fast-json-stringify (encode) + JSON.parse | 1,791,926 (×1.26) | 966,469 (×0.98) | 266 | 212 | 178 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,552 (×1.00) | 912 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 2,003 (×1.29) | 1,515 (×1.66) | 140,738 | 30,666 | 26,946 |
| protoarray (closures) | 1,428 (×0.92) | 991 (×1.09) | 140,738 | 30,666 | 26,946 |
| protoarray (codegen, metaschema check) | 1,107 (×0.71) | 1,543 (×1.69) | 140,738 | 30,666 | 26,946 |
| protoarray (columns) | 2,127 (×1.37) | 1,501 (×1.65) | 138,758 | 27,412 | 21,053 |
| protoarray (standalone, inline) | 2,017 (×1.30) | 1,497 (×1.64) | 140,738 | 30,666 | 26,946 |
| protoarray (columns, delta + intern) | 2,293 (×1.48) | 1,732 (×1.90) | 114,965 | 24,574 | 19,799 |
| protobufjs | 1,328 (×0.86) | 1,412 (×1.55) | 120,459 | 31,414 | 28,985 |
| avsc | 1,364 (×0.88) | 1,823 (×2.00) | 101,839 | 29,895 | 27,334 |
| msgpackr | 1,201 (×0.77) | 773 (×0.85) | 210,061 | 34,139 | 30,555 |
| msgpackr (records, shared structures) | 1,502 (×0.97) | 3,001 (×3.29) | 112,274 | 30,957 | 28,370 |
| @msgpack/msgpack | 771 (×0.50) | 725 (×0.79) | 202,061 | 33,895 | 30,367 |
| cbor-x (records) | 1,378 (×0.89) | 2,421 (×2.65) | 125,051 | 31,582 | 29,016 |
| fast-json-stringify (encode) + JSON.parse | 1,577 (×1.02) | 908 (×1.00) | 271,215 | 33,793 | 29,133 |

**sparse** — 20 optional fields, 3 present

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 7,020,175 (×1.00) | 4,831,357 (×1.00) | 33 | 53 | 36 |
| protoarray (codegen) | 7,492,911 (×1.07) | 7,343,800 (×1.52) | 23 | 43 | 27 |
| protoarray (closures) | 3,066,588 (×0.44) | 2,449,150 (×0.51) | 23 | 43 | 27 |
| protoarray (codegen, metaschema check) | 2,228,011 (×0.32) | 7,725,200 (×1.60) | 23 | 43 | 27 |
| protoarray (standalone, inline) | 7,019,903 (×1.00) | 7,389,414 (×1.53) | 23 | 43 | 27 |
| protobufjs | 5,664,880 (×0.81) | 9,586,982 (×1.98) | 11 | 31 | 15 |
| avsc | 1,489,195 (×0.21) | 3,693,651 (×0.76) | 28 | 35 | 23 |
| msgpackr | 6,343,997 (×0.90) | 6,929,161 (×1.43) | 21 | 41 | 25 |
| msgpackr (records, shared structures) | 6,047,645 (×0.86) | 12,528,028 (×2.59) | 9 | 29 | 13 |
| @msgpack/msgpack | 4,925,157 (×0.70) | 3,558,744 (×0.74) | 19 | 39 | 23 |
| cbor-x (records) | 3,108,914 (×0.44) | 3,626,443 (×0.75) | 27 | 47 | 31 |
| fast-json-stringify (encode) + JSON.parse | 14,399,016 (×2.05) | 4,723,333 (×0.98) | 33 | 53 | 36 |

**typed** — enum, boolean and date heavy record

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 833,405 (×1.00) | 2,899,122 (×1.00) | 123 | 120 | 94 |
| protoarray (codegen) | 4,785,378 (×5.74) | 4,928,697 (×1.70) | 36 | 46 | 36 |
| protoarray (closures) | 3,507,718 (×4.21) | 3,088,482 (×1.07) | 36 | 46 | 36 |
| protoarray (codegen, metaschema check) | 2,799,554 (×3.36) | 4,825,382 (×1.66) | 36 | 46 | 36 |
| protoarray (standalone, inline) | 4,565,730 (×5.48) | 4,746,114 (×1.64) | 36 | 46 | 36 |
| protobufjs | 3,685,426 (×4.42) | 12,106,492 (×4.18) | 13 | 33 | 17 |
| avsc | 2,076,309 (×2.49) | 7,931,138 (×2.74) | 12 | 32 | 16 |
| msgpackr | 2,842,568 (×3.41) | 2,777,902 (×0.96) | 73 | 96 | 72 |
| msgpackr (records, shared structures) | 3,410,286 (×4.09) | 5,284,709 (×1.82) | 24 | 45 | 28 |
| @msgpack/msgpack | 1,185,961 (×1.42) | 1,574,466 (×0.54) | 71 | 92 | 71 |
| cbor-x (records) | 1,773,843 (×2.13) | 1,561,556 (×0.54) | 79 | 100 | 80 |
| fast-json-stringify (encode) + JSON.parse | 4,813,673 (×5.78) | 2,672,554 (×0.92) | 110 | 107 | 83 |

**strings** — long Cyrillic strings

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,548,437 (×1.00) | 1,346,168 (×1.00) | 816 | 266 | 229 |
| protoarray (codegen) | 1,808,707 (×1.17) | 1,693,495 (×1.26) | 785 | 230 | 207 |
| protoarray (closures) | 1,697,999 (×1.10) | 1,558,401 (×1.16) | 785 | 230 | 207 |
| protoarray (codegen, metaschema check) | 1,545,309 (×1.00) | 1,700,137 (×1.26) | 785 | 230 | 207 |
| protoarray (standalone, inline) | 1,786,667 (×1.15) | 1,696,516 (×1.26) | 785 | 230 | 207 |
| protobufjs | 580,692 (×0.38) | 508,508 (×0.38) | 777 | 233 | 211 |
| avsc | 488,372 (×0.32) | 774,981 (×0.58) | 774 | 231 | 210 |
| msgpackr | 842,689 (×0.54) | 215,896 (×0.16) | 800 | 263 | 234 |
| msgpackr (records, shared structures) | 862,105 (×0.56) | 242,365 (×0.18) | 775 | 230 | 206 |
| @msgpack/msgpack | 379,797 (×0.25) | 707,285 (×0.53) | 798 | 260 | 233 |
| cbor-x (records) | 718,479 (×0.46) | 246,166 (×0.18) | 806 | 269 | 241 |
| fast-json-stringify (encode) + JSON.parse | 1,338,379 (×0.86) | 1,378,036 (×1.02) | 816 | 266 | 229 |

**packets** — 100 wrpc packets: calls, callbacks and events

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 52,900 (×1.00) | 25,551 (×1.00) | 8,834 | 852 | 630 |
| protoarray (codegen) | 68,205 (×1.29) | 51,809 (×2.03) | 4,332 | 685 | 501 |
| protoarray (closures) | 49,242 (×0.93) | 27,540 (×1.08) | 4,332 | 685 | 501 |
| protoarray (codegen, metaschema check) | 34,778 (×0.66) | 49,435 (×1.93) | 4,332 | 685 | 501 |
| protoarray (standalone, inline) | 68,089 (×1.29) | 50,707 (×1.98) | 4,332 | 685 | 501 |
| protobufjs | 23,929 (×0.45) | 37,434 (×1.47) | 3,691 | 778 | 609 |
| avsc | 20,729 (×0.39) | 47,515 (×1.86) | 2,833 | 633 | 521 |
| msgpackr | 31,382 (×0.59) | 23,603 (×0.92) | 6,800 | 842 | 640 |
| msgpackr (records, shared structures) | 29,646 (×0.56) | 92,772 (×3.63) | 3,697 | 725 | 566 |
| @msgpack/msgpack | 25,502 (×0.48) | 21,591 (×0.85) | 6,400 | 804 | 614 |
| cbor-x (records) | 24,139 (×0.46) | 52,072 (×2.04) | 4,401 | 841 | 683 |

**numeric** — 32 doubles (where binary formats shine)

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 329,045 (×1.00) | 479,787 (×1.00) | 764 | 406 | 392 |
| protoarray (codegen) | 418,684 (×1.27) | 762,539 (×1.59) | 582 | 309 | 295 |
| protoarray (closures) | 345,870 (×1.05) | 573,750 (×1.20) | 582 | 309 | 295 |
| protoarray (codegen, metaschema check) | 349,631 (×1.06) | 752,172 (×1.57) | 582 | 309 | 295 |
| protoarray (standalone, inline) | 421,221 (×1.28) | 740,229 (×1.54) | 582 | 309 | 295 |
| protobufjs | 732,841 (×2.23) | 1,968,496 (×4.10) | 305 | 328 | 304 |
| avsc | 1,997,448 (×6.07) | 3,147,786 (×6.56) | 256 | 279 | 260 |
| msgpackr | 1,119,426 (×3.40) | 453,632 (×0.95) | 409 | 429 | 376 |
| msgpackr (records, shared structures) | 1,440,436 (×4.38) | 3,280,266 (×6.84) | 289 | 312 | 280 |
| @msgpack/msgpack | 752,764 (×2.29) | 195,603 (×0.41) | 409 | 429 | 376 |
| cbor-x (records) | 724,209 (×2.20) | 445,107 (×0.93) | 416 | 435 | 355 |
| fast-json-stringify (encode) + JSON.parse | 1,867,320 (×5.67) | 491,611 (×1.02) | 764 | 406 | 392 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-16. Median of 5 rounds in a fresh process per library and scenario (the spread of the rounds is in bench/results/compare.json); bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

<!-- bench:compare:end -->

## Reading the numbers

- **Records and strings** are where JSON transports live, and where protoarray is the fastest
  text codec in the table and encodes faster than every binary one: `JSON.parse` and
  `JSON.stringify` are native, generated code adds tens of nanoseconds, and the positional array
  is about half the bytes. protobufjs, @msgpack/msgpack and cbor-x decode strings byte by byte
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
time 1.x took to parse its own spelling of it (about 65 µs for the nested record with codegen, 40
µs with closures, once per schema). A schema built from a snapshot skips metaschema, about half of
that (36 µs); `pnpm bench` prints both and a cold start.
