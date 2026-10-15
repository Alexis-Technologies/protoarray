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
| JSON | 1,396,349 (×1.00) | 954,196 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,053,665 (×1.47) | 1,678,585 (×1.76) | 135 | 134 | 110 |
| protoarray (closures) | 1,465,362 (×1.05) | 1,019,966 (×1.07) | 135 | 134 | 110 |
| protoarray (codegen, validate: 'both') | 2,033,709 (×1.46) | 1,601,970 (×1.68) | 135 | 134 | 110 |
| protoarray (standalone, inline) | 2,054,386 (×1.47) | 1,561,723 (×1.64) | 135 | 134 | 110 |
| protobufjs | 1,376,940 (×0.99) | 1,461,801 (×1.53) | 115 | 127 | 117 |
| avsc | 1,745,837 (×1.25) | 1,821,063 (×1.91) | 97 | 111 | 101 |
| msgpackr | 1,216,857 (×0.87) | 752,995 (×0.79) | 206 | 207 | 173 |
| msgpackr (records, shared structures) | 1,480,975 (×1.06) | 2,676,271 (×2.80) | 108 | 124 | 112 |
| @msgpack/msgpack | 753,516 (×0.54) | 693,274 (×0.73) | 198 | 200 | 166 |
| cbor-x (records) | 782,537 (×0.56) | 670,304 (×0.70) | 215 | 218 | 187 |
| fast-json-stringify (encode) + JSON.parse | 1,740,162 (×1.25) | 971,288 (×1.02) | 266 | 212 | 178 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,457 (×1.00) | 913 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 1,999 (×1.37) | 1,512 (×1.66) | 140,738 | 30,666 | 26,946 |
| protoarray (closures) | 1,386 (×0.95) | 989 (×1.08) | 140,738 | 30,666 | 26,946 |
| protoarray (codegen, validate: 'both') | 1,962 (×1.35) | 1,438 (×1.58) | 140,738 | 30,666 | 26,946 |
| protoarray (columns) | 2,064 (×1.42) | 1,522 (×1.67) | 138,758 | 27,412 | 21,053 |
| protoarray (standalone, inline) | 1,956 (×1.34) | 1,458 (×1.60) | 140,738 | 30,666 | 26,946 |
| protoarray (columns, delta + intern) | 2,243 (×1.54) | 1,707 (×1.87) | 114,965 | 24,574 | 19,799 |
| protobufjs | 1,302 (×0.89) | 1,390 (×1.52) | 120,459 | 31,414 | 28,985 |
| avsc | 1,376 (×0.94) | 1,806 (×1.98) | 101,839 | 29,895 | 27,334 |
| msgpackr | 1,238 (×0.85) | 797 (×0.87) | 210,061 | 34,139 | 30,555 |
| msgpackr (records, shared structures) | 1,564 (×1.07) | 2,868 (×3.14) | 112,274 | 30,957 | 28,370 |
| @msgpack/msgpack | 788 (×0.54) | 714 (×0.78) | 202,061 | 33,895 | 30,367 |
| cbor-x (records) | 1,388 (×0.95) | 2,346 (×2.57) | 125,051 | 31,582 | 29,016 |
| fast-json-stringify (encode) + JSON.parse | 1,575 (×1.08) | 904 (×0.99) | 271,215 | 33,793 | 29,133 |

**sparse** — 20 optional fields, 3 present

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 6,896,722 (×1.00) | 4,601,036 (×1.00) | 33 | 53 | 36 |
| protoarray (codegen) | 7,229,732 (×1.05) | 7,460,316 (×1.62) | 23 | 43 | 27 |
| protoarray (closures) | 2,962,654 (×0.43) | 2,411,533 (×0.52) | 23 | 43 | 27 |
| protoarray (codegen, validate: 'both') | 7,208,862 (×1.05) | 7,149,439 (×1.55) | 23 | 43 | 27 |
| protoarray (standalone, inline) | 6,686,031 (×0.97) | 7,037,786 (×1.53) | 23 | 43 | 27 |
| protobufjs | 5,601,417 (×0.81) | 9,758,924 (×2.12) | 11 | 31 | 15 |
| avsc | 1,459,505 (×0.21) | 3,669,119 (×0.80) | 28 | 35 | 23 |
| msgpackr | 6,100,078 (×0.88) | 6,703,303 (×1.46) | 21 | 41 | 25 |
| msgpackr (records, shared structures) | 6,113,667 (×0.89) | 12,193,530 (×2.65) | 9 | 29 | 13 |
| @msgpack/msgpack | 5,258,483 (×0.76) | 3,396,723 (×0.74) | 19 | 39 | 23 |
| cbor-x (records) | 3,041,346 (×0.44) | 3,623,621 (×0.79) | 27 | 47 | 31 |
| fast-json-stringify (encode) + JSON.parse | 14,461,895 (×2.10) | 4,582,405 (×1.00) | 33 | 53 | 36 |

**typed** — enum, boolean and date heavy record

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 836,155 (×1.00) | 2,868,029 (×1.00) | 123 | 120 | 94 |
| protoarray (codegen) | 4,921,430 (×5.89) | 4,881,168 (×1.70) | 36 | 46 | 36 |
| protoarray (closures) | 3,482,171 (×4.16) | 3,140,197 (×1.09) | 36 | 46 | 36 |
| protoarray (codegen, validate: 'both') | 4,647,444 (×5.56) | 4,822,370 (×1.68) | 36 | 46 | 36 |
| protoarray (standalone, inline) | 4,708,207 (×5.63) | 4,743,431 (×1.65) | 36 | 46 | 36 |
| protobufjs | 3,818,606 (×4.57) | 11,958,604 (×4.17) | 13 | 33 | 17 |
| avsc | 2,129,878 (×2.55) | 8,006,809 (×2.79) | 12 | 32 | 16 |
| msgpackr | 2,879,373 (×3.44) | 2,784,048 (×0.97) | 73 | 96 | 72 |
| msgpackr (records, shared structures) | 3,529,451 (×4.22) | 5,319,295 (×1.85) | 24 | 45 | 28 |
| @msgpack/msgpack | 1,178,658 (×1.41) | 1,611,692 (×0.56) | 71 | 92 | 71 |
| cbor-x (records) | 1,794,743 (×2.15) | 1,595,528 (×0.56) | 79 | 100 | 80 |
| fast-json-stringify (encode) + JSON.parse | 4,856,219 (×5.81) | 2,791,643 (×0.97) | 110 | 107 | 83 |

**strings** — long Cyrillic strings

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,552,873 (×1.00) | 1,346,662 (×1.00) | 816 | 266 | 229 |
| protoarray (codegen) | 1,782,471 (×1.15) | 1,701,067 (×1.26) | 785 | 230 | 207 |
| protoarray (closures) | 1,674,439 (×1.08) | 1,562,522 (×1.16) | 785 | 230 | 207 |
| protoarray (codegen, validate: 'both') | 1,780,724 (×1.15) | 1,699,914 (×1.26) | 785 | 230 | 207 |
| protoarray (standalone, inline) | 1,787,846 (×1.15) | 1,686,922 (×1.25) | 785 | 230 | 207 |
| protobufjs | 576,892 (×0.37) | 514,207 (×0.38) | 777 | 233 | 211 |
| avsc | 501,229 (×0.32) | 789,276 (×0.59) | 774 | 231 | 210 |
| msgpackr | 856,918 (×0.55) | 215,610 (×0.16) | 800 | 263 | 234 |
| msgpackr (records, shared structures) | 880,913 (×0.57) | 241,882 (×0.18) | 775 | 230 | 206 |
| @msgpack/msgpack | 385,394 (×0.25) | 696,639 (×0.52) | 798 | 260 | 233 |
| cbor-x (records) | 720,814 (×0.46) | 242,984 (×0.18) | 806 | 269 | 241 |
| fast-json-stringify (encode) + JSON.parse | 1,329,972 (×0.86) | 1,338,178 (×0.99) | 816 | 266 | 229 |

**packets** — 100 wrpc packets: calls, callbacks and events

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 52,157 (×1.00) | 24,402 (×1.00) | 8,834 | 852 | 630 |
| protoarray (codegen) | 67,840 (×1.30) | 47,443 (×1.94) | 4,332 | 685 | 501 |
| protoarray (closures) | 45,534 (×0.87) | 25,744 (×1.05) | 4,332 | 685 | 501 |
| protoarray (codegen, validate: 'both') | 66,105 (×1.27) | 47,127 (×1.93) | 4,332 | 685 | 501 |
| protoarray (standalone, inline) | 67,434 (×1.29) | 51,215 (×2.10) | 4,332 | 685 | 501 |
| protobufjs | 24,144 (×0.46) | 36,554 (×1.50) | 3,691 | 778 | 609 |
| avsc | 20,720 (×0.40) | 46,217 (×1.89) | 2,833 | 633 | 521 |
| msgpackr | 31,290 (×0.60) | 24,031 (×0.98) | 6,800 | 842 | 640 |
| msgpackr (records, shared structures) | 29,880 (×0.57) | 91,680 (×3.76) | 3,697 | 725 | 566 |
| @msgpack/msgpack | 24,759 (×0.47) | 21,623 (×0.89) | 6,400 | 804 | 614 |
| cbor-x (records) | 24,261 (×0.47) | 51,204 (×2.10) | 4,401 | 841 | 683 |

**numeric** — 32 doubles (where binary formats shine)

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 323,761 (×1.00) | 480,521 (×1.00) | 764 | 406 | 392 |
| protoarray (codegen) | 426,063 (×1.32) | 736,543 (×1.53) | 582 | 309 | 295 |
| protoarray (closures) | 362,367 (×1.12) | 571,227 (×1.19) | 582 | 309 | 295 |
| protoarray (codegen, validate: 'both') | 421,335 (×1.30) | 734,548 (×1.53) | 582 | 309 | 295 |
| protoarray (standalone, inline) | 424,996 (×1.31) | 734,593 (×1.53) | 582 | 309 | 295 |
| protobufjs | 727,413 (×2.25) | 1,952,175 (×4.06) | 305 | 328 | 304 |
| avsc | 1,964,182 (×6.07) | 3,131,903 (×6.52) | 256 | 279 | 260 |
| msgpackr | 1,106,458 (×3.42) | 440,776 (×0.92) | 409 | 429 | 376 |
| msgpackr (records, shared structures) | 1,420,866 (×4.39) | 3,495,917 (×7.28) | 289 | 312 | 280 |
| @msgpack/msgpack | 745,611 (×2.30) | 192,581 (×0.40) | 409 | 429 | 376 |
| cbor-x (records) | 719,961 (×2.22) | 439,622 (×0.91) | 416 | 435 | 355 |
| fast-json-stringify (encode) + JSON.parse | 1,847,873 (×5.71) | 484,085 (×1.01) | 764 | 406 | 392 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-15. Median of 5 rounds in a fresh process per library and scenario (the spread of the rounds is in bench/results/compare.json); bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

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
- **Validation.** By default the wire is checked on decode and the values given to encode are
  trusted, so the protoarray rows above encode the way protobufjs and msgpackr do, without
  checks, and decode with them. The `protoarray (codegen, validate: 'both')` row in the full
  tables checks the values too: the checks are compiled into the codec and cost a few percent
  of an encode with generated code, about a tenth with closures. `pnpm bench` measures every
  encode both ways, for both backends.
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
