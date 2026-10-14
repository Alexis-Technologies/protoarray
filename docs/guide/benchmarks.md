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
| JSON | 1,382,790 (×1.00) | 974,257 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,066,003 (×1.49) | 1,598,946 (×1.64) | 135 | 134 | 110 |
| protoarray (closures) | 1,305,923 (×0.94) | 1,005,999 (×1.03) | 135 | 134 | 110 |
| protobufjs | 1,429,303 (×1.03) | 1,467,178 (×1.51) | 115 | 127 | 117 |
| avsc | 1,741,218 (×1.26) | 1,833,962 (×1.88) | 97 | 111 | 101 |
| msgpackr | 1,223,998 (×0.89) | 741,541 (×0.76) | 206 | 207 | 173 |
| msgpackr (records, shared structures) | 1,489,072 (×1.08) | 2,642,450 (×2.71) | 108 | 124 | 112 |
| @msgpack/msgpack | 757,991 (×0.55) | 691,694 (×0.71) | 198 | 200 | 166 |
| cbor-x (records) | 792,156 (×0.57) | 679,367 (×0.70) | 215 | 218 | 187 |
| fast-json-stringify (encode) + JSON.parse | 1,763,135 (×1.28) | 974,140 (×1.00) | 266 | 212 | 178 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,539 (×1.00) | 927 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 2,013 (×1.31) | 1,513 (×1.63) | 140,738 | 30,666 | 26,946 |
| protoarray (closures) | 1,253 (×0.81) | 940 (×1.01) | 140,738 | 30,666 | 26,946 |
| protoarray (columns) | 2,043 (×1.33) | 1,510 (×1.63) | 138,758 | 27,412 | 21,053 |
| protobufjs | 1,307 (×0.85) | 1,401 (×1.51) | 120,459 | 31,414 | 28,985 |
| avsc | 1,437 (×0.93) | 1,821 (×1.96) | 101,839 | 29,895 | 27,334 |
| msgpackr | 1,248 (×0.81) | 791 (×0.85) | 210,061 | 34,139 | 30,555 |
| msgpackr (records, shared structures) | 1,557 (×1.01) | 2,829 (×3.05) | 112,274 | 30,957 | 28,370 |
| @msgpack/msgpack | 792 (×0.51) | 715 (×0.77) | 202,061 | 33,895 | 30,367 |
| cbor-x (records) | 1,405 (×0.91) | 2,332 (×2.52) | 125,051 | 31,582 | 29,016 |
| fast-json-stringify (encode) + JSON.parse | 1,581 (×1.03) | 917 (×0.99) | 271,215 | 33,793 | 29,133 |

**sparse** — 20 optional fields, 3 present

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 6,822,825 (×1.00) | 4,721,533 (×1.00) | 33 | 53 | 36 |
| protoarray (codegen) | 7,255,770 (×1.06) | 7,533,214 (×1.60) | 23 | 43 | 27 |
| protoarray (closures) | 2,799,269 (×0.41) | 2,469,853 (×0.52) | 23 | 43 | 27 |
| protobufjs | 5,621,079 (×0.82) | 9,603,501 (×2.03) | 11 | 31 | 15 |
| avsc | 1,437,580 (×0.21) | 3,711,428 (×0.79) | 28 | 35 | 23 |
| msgpackr | 6,130,854 (×0.90) | 6,769,211 (×1.43) | 21 | 41 | 25 |
| msgpackr (records, shared structures) | 6,076,481 (×0.89) | 12,505,958 (×2.65) | 9 | 29 | 13 |
| @msgpack/msgpack | 5,249,175 (×0.77) | 3,420,271 (×0.72) | 19 | 39 | 23 |
| cbor-x (records) | 3,090,727 (×0.45) | 3,650,248 (×0.77) | 27 | 47 | 31 |
| fast-json-stringify (encode) + JSON.parse | 14,541,164 (×2.13) | 4,614,146 (×0.98) | 33 | 53 | 36 |

**typed** — enum, boolean and date heavy record

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 842,774 (×1.00) | 2,947,608 (×1.00) | 123 | 120 | 94 |
| protoarray (codegen) | 4,740,948 (×5.63) | 4,914,871 (×1.67) | 36 | 46 | 36 |
| protoarray (closures) | 3,365,415 (×3.99) | 2,848,048 (×0.97) | 36 | 46 | 36 |
| protobufjs | 3,836,489 (×4.55) | 12,462,023 (×4.23) | 13 | 33 | 17 |
| avsc | 2,111,659 (×2.51) | 8,019,099 (×2.72) | 12 | 32 | 16 |
| msgpackr | 2,881,614 (×3.42) | 2,877,513 (×0.98) | 73 | 96 | 72 |
| msgpackr (records, shared structures) | 3,525,138 (×4.18) | 5,306,334 (×1.80) | 24 | 45 | 28 |
| @msgpack/msgpack | 1,183,400 (×1.40) | 1,564,391 (×0.53) | 71 | 92 | 71 |
| cbor-x (records) | 1,787,796 (×2.12) | 1,583,667 (×0.54) | 79 | 100 | 80 |
| fast-json-stringify (encode) + JSON.parse | 4,949,754 (×5.87) | 2,827,679 (×0.96) | 110 | 107 | 83 |

**strings** — long Cyrillic strings

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,574,070 (×1.00) | 1,344,964 (×1.00) | 816 | 266 | 229 |
| protoarray (codegen) | 1,820,145 (×1.16) | 1,708,096 (×1.27) | 785 | 230 | 207 |
| protoarray (closures) | 1,683,635 (×1.07) | 1,563,922 (×1.16) | 785 | 230 | 207 |
| protobufjs | 590,875 (×0.38) | 517,958 (×0.39) | 777 | 233 | 211 |
| avsc | 503,412 (×0.32) | 792,365 (×0.59) | 774 | 231 | 210 |
| msgpackr | 862,792 (×0.55) | 217,761 (×0.16) | 800 | 263 | 234 |
| msgpackr (records, shared structures) | 888,925 (×0.56) | 243,830 (×0.18) | 775 | 230 | 206 |
| @msgpack/msgpack | 382,991 (×0.24) | 697,933 (×0.52) | 798 | 260 | 233 |
| cbor-x (records) | 719,127 (×0.46) | 244,667 (×0.18) | 806 | 269 | 241 |
| fast-json-stringify (encode) + JSON.parse | 1,328,138 (×0.84) | 1,336,783 (×0.99) | 816 | 266 | 229 |

**packets** — 100 wrpc packets: calls, callbacks and events

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 52,494 (×1.00) | 24,502 (×1.00) | 8,834 | 852 | 630 |
| protoarray (codegen) | 67,209 (×1.28) | 47,742 (×1.95) | 4,332 | 685 | 501 |
| protoarray (closures) | 43,658 (×0.83) | 26,663 (×1.09) | 4,332 | 685 | 501 |
| protobufjs | 24,550 (×0.47) | 37,388 (×1.53) | 3,691 | 778 | 609 |
| avsc | 20,376 (×0.39) | 47,248 (×1.93) | 2,833 | 633 | 521 |
| msgpackr | 31,566 (×0.60) | 24,451 (×1.00) | 6,800 | 842 | 640 |
| msgpackr (records, shared structures) | 29,556 (×0.56) | 88,797 (×3.62) | 3,697 | 725 | 566 |
| @msgpack/msgpack | 25,096 (×0.48) | 21,516 (×0.88) | 6,400 | 804 | 614 |
| cbor-x (records) | 24,286 (×0.46) | 51,862 (×2.12) | 4,401 | 841 | 683 |

**numeric** — 32 doubles (where binary formats shine)

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 325,312 (×1.00) | 482,491 (×1.00) | 764 | 406 | 392 |
| protoarray (codegen) | 418,347 (×1.29) | 739,183 (×1.53) | 582 | 309 | 295 |
| protoarray (closures) | 369,509 (×1.14) | 581,250 (×1.20) | 582 | 309 | 295 |
| protobufjs | 729,546 (×2.24) | 1,975,992 (×4.10) | 305 | 328 | 304 |
| avsc | 1,990,777 (×6.12) | 3,135,628 (×6.50) | 256 | 279 | 260 |
| msgpackr | 1,119,955 (×3.44) | 461,340 (×0.96) | 409 | 429 | 376 |
| msgpackr (records, shared structures) | 1,434,664 (×4.41) | 3,341,454 (×6.93) | 289 | 312 | 280 |
| @msgpack/msgpack | 743,447 (×2.29) | 189,900 (×0.39) | 409 | 429 | 376 |
| cbor-x (records) | 722,145 (×2.22) | 445,840 (×0.92) | 416 | 435 | 355 |
| fast-json-stringify (encode) + JSON.parse | 1,854,387 (×5.70) | 487,385 (×1.01) | 764 | 406 | 392 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-14. Median of 5 runs; bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

<!-- bench:compare:end -->

## Reading the numbers

- **Records and strings** are where JSON transports live, and where protoarray is the fastest
  codec in the table: `JSON.parse` and `JSON.stringify` are native, generated code adds tens of
  nanoseconds, and the positional array is less than half the bytes. protobufjs, @msgpack/msgpack
  and cbor-x decode strings byte by byte in JavaScript and fall behind.
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
- **Validation** is on by default in both directions. Its checks are compiled into the codec:
  a few percent of an encode with generated code, more with closures. `validate: false` takes
  them out, and the `pnpm bench` harness measures both.
- **Sizes**: protoarray's wire is JSON text; the binary codecs' bytes are before any base64 a
  text channel would add. After gzip or brotli the formats are close, and `columns` is the
  smallest on lists.

`pnpm bench` is the engine harness for protoarray alone (both backends, every layout, against the
JSON of the keyed object), with `--save` and `--compare` to track a change on one machine.
