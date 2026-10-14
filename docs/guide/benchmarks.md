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
| JSON | 1,404,942 (×1.00) | 959,412 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,067,707 (×1.47) | 1,695,065 (×1.77) | 135 | 134 | 110 |
| protoarray (closures) | 1,488,326 (×1.06) | 1,043,255 (×1.09) | 135 | 134 | 110 |
| protoarray (codegen, validate: 'both') | 2,045,505 (×1.46) | 1,627,522 (×1.70) | 135 | 134 | 110 |
| protobufjs | 1,416,083 (×1.01) | 1,471,736 (×1.53) | 115 | 127 | 117 |
| avsc | 1,755,981 (×1.25) | 1,836,788 (×1.91) | 97 | 111 | 101 |
| msgpackr | 1,220,838 (×0.87) | 740,602 (×0.77) | 206 | 207 | 173 |
| msgpackr (records, shared structures) | 1,449,843 (×1.03) | 2,627,102 (×2.74) | 108 | 124 | 112 |
| @msgpack/msgpack | 754,362 (×0.54) | 689,298 (×0.72) | 198 | 200 | 166 |
| cbor-x (records) | 793,608 (×0.56) | 675,652 (×0.70) | 215 | 218 | 187 |
| fast-json-stringify (encode) + JSON.parse | 1,739,412 (×1.24) | 973,632 (×1.01) | 266 | 212 | 178 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,534 (×1.00) | 931 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 2,008 (×1.31) | 1,554 (×1.67) | 140,738 | 30,666 | 26,946 |
| protoarray (closures) | 1,414 (×0.92) | 998 (×1.07) | 140,738 | 30,666 | 26,946 |
| protoarray (codegen, validate: 'both') | 1,975 (×1.29) | 1,512 (×1.62) | 140,738 | 30,666 | 26,946 |
| protoarray (columns) | 2,080 (×1.36) | 1,576 (×1.69) | 138,758 | 27,412 | 21,053 |
| protobufjs | 1,318 (×0.86) | 1,383 (×1.49) | 120,459 | 31,414 | 28,985 |
| avsc | 1,435 (×0.94) | 1,825 (×1.96) | 101,839 | 29,895 | 27,334 |
| msgpackr | 1,242 (×0.81) | 788 (×0.85) | 210,061 | 34,139 | 30,555 |
| msgpackr (records, shared structures) | 1,554 (×1.01) | 2,826 (×3.04) | 112,274 | 30,957 | 28,370 |
| @msgpack/msgpack | 789 (×0.51) | 718 (×0.77) | 202,061 | 33,895 | 30,367 |
| cbor-x (records) | 1,400 (×0.91) | 2,370 (×2.55) | 125,051 | 31,582 | 29,016 |
| fast-json-stringify (encode) + JSON.parse | 1,581 (×1.03) | 901 (×0.97) | 271,215 | 33,793 | 29,133 |

**sparse** — 20 optional fields, 3 present

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 6,895,210 (×1.00) | 4,650,404 (×1.00) | 33 | 53 | 36 |
| protoarray (codegen) | 7,151,362 (×1.04) | 7,444,150 (×1.60) | 23 | 43 | 27 |
| protoarray (closures) | 3,002,118 (×0.44) | 2,460,211 (×0.53) | 23 | 43 | 27 |
| protoarray (codegen, validate: 'both') | 7,156,799 (×1.04) | 7,476,794 (×1.61) | 23 | 43 | 27 |
| protobufjs | 5,487,581 (×0.80) | 9,749,897 (×2.10) | 11 | 31 | 15 |
| avsc | 1,464,305 (×0.21) | 3,618,796 (×0.78) | 28 | 35 | 23 |
| msgpackr | 6,162,297 (×0.89) | 6,745,171 (×1.45) | 21 | 41 | 25 |
| msgpackr (records, shared structures) | 6,028,307 (×0.87) | 12,182,690 (×2.62) | 9 | 29 | 13 |
| @msgpack/msgpack | 5,177,724 (×0.75) | 3,479,160 (×0.75) | 19 | 39 | 23 |
| cbor-x (records) | 3,066,183 (×0.44) | 3,684,383 (×0.79) | 27 | 47 | 31 |
| fast-json-stringify (encode) + JSON.parse | 14,410,368 (×2.09) | 4,694,210 (×1.01) | 33 | 53 | 36 |

**typed** — enum, boolean and date heavy record

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 839,407 (×1.00) | 2,960,786 (×1.00) | 123 | 120 | 94 |
| protoarray (codegen) | 4,988,903 (×5.94) | 4,825,834 (×1.63) | 36 | 46 | 36 |
| protoarray (closures) | 3,581,086 (×4.27) | 3,122,826 (×1.05) | 36 | 46 | 36 |
| protoarray (codegen, validate: 'both') | 4,679,908 (×5.58) | 4,895,597 (×1.65) | 36 | 46 | 36 |
| protobufjs | 3,862,100 (×4.60) | 12,286,219 (×4.15) | 13 | 33 | 17 |
| avsc | 2,138,704 (×2.55) | 7,981,769 (×2.70) | 12 | 32 | 16 |
| msgpackr | 2,882,422 (×3.43) | 2,868,571 (×0.97) | 73 | 96 | 72 |
| msgpackr (records, shared structures) | 3,487,665 (×4.15) | 5,291,375 (×1.79) | 24 | 45 | 28 |
| @msgpack/msgpack | 1,172,791 (×1.40) | 1,584,876 (×0.54) | 71 | 92 | 71 |
| cbor-x (records) | 1,761,378 (×2.10) | 1,596,398 (×0.54) | 79 | 100 | 80 |
| fast-json-stringify (encode) + JSON.parse | 4,771,564 (×5.68) | 2,783,987 (×0.94) | 110 | 107 | 83 |

**strings** — long Cyrillic strings

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,559,841 (×1.00) | 1,360,735 (×1.00) | 816 | 266 | 229 |
| protoarray (codegen) | 1,811,049 (×1.16) | 1,707,083 (×1.25) | 785 | 230 | 207 |
| protoarray (closures) | 1,724,299 (×1.11) | 1,569,605 (×1.15) | 785 | 230 | 207 |
| protoarray (codegen, validate: 'both') | 1,802,852 (×1.16) | 1,695,303 (×1.25) | 785 | 230 | 207 |
| protobufjs | 584,717 (×0.37) | 518,210 (×0.38) | 777 | 233 | 211 |
| avsc | 503,145 (×0.32) | 788,139 (×0.58) | 774 | 231 | 210 |
| msgpackr | 861,265 (×0.55) | 217,432 (×0.16) | 800 | 263 | 234 |
| msgpackr (records, shared structures) | 884,100 (×0.57) | 244,044 (×0.18) | 775 | 230 | 206 |
| @msgpack/msgpack | 384,063 (×0.25) | 696,477 (×0.51) | 798 | 260 | 233 |
| cbor-x (records) | 721,967 (×0.46) | 243,377 (×0.18) | 806 | 269 | 241 |
| fast-json-stringify (encode) + JSON.parse | 1,331,499 (×0.85) | 1,371,862 (×1.01) | 816 | 266 | 229 |

**packets** — 100 wrpc packets: calls, callbacks and events

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 52,502 (×1.00) | 24,328 (×1.00) | 8,834 | 852 | 630 |
| protoarray (codegen) | 67,537 (×1.29) | 46,356 (×1.91) | 4,332 | 685 | 501 |
| protoarray (closures) | 48,300 (×0.92) | 26,062 (×1.07) | 4,332 | 685 | 501 |
| protoarray (codegen, validate: 'both') | 66,728 (×1.27) | 48,379 (×1.99) | 4,332 | 685 | 501 |
| protobufjs | 24,407 (×0.46) | 36,910 (×1.52) | 3,691 | 778 | 609 |
| avsc | 20,816 (×0.40) | 46,676 (×1.92) | 2,833 | 633 | 521 |
| msgpackr | 30,085 (×0.57) | 24,020 (×0.99) | 6,800 | 842 | 640 |
| msgpackr (records, shared structures) | 29,888 (×0.57) | 91,635 (×3.77) | 3,697 | 725 | 566 |
| @msgpack/msgpack | 25,386 (×0.48) | 21,492 (×0.88) | 6,400 | 804 | 614 |
| cbor-x (records) | 24,381 (×0.46) | 51,212 (×2.11) | 4,401 | 841 | 683 |

**numeric** — 32 doubles (where binary formats shine)

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 324,645 (×1.00) | 486,837 (×1.00) | 764 | 406 | 392 |
| protoarray (codegen) | 427,531 (×1.32) | 743,061 (×1.53) | 582 | 309 | 295 |
| protoarray (closures) | 364,839 (×1.12) | 575,461 (×1.18) | 582 | 309 | 295 |
| protoarray (codegen, validate: 'both') | 407,091 (×1.25) | 734,815 (×1.51) | 582 | 309 | 295 |
| protobufjs | 721,191 (×2.22) | 1,961,434 (×4.03) | 305 | 328 | 304 |
| avsc | 1,972,135 (×6.07) | 3,140,092 (×6.45) | 256 | 279 | 260 |
| msgpackr | 1,115,474 (×3.44) | 439,430 (×0.90) | 409 | 429 | 376 |
| msgpackr (records, shared structures) | 1,408,280 (×4.34) | 3,504,757 (×7.20) | 289 | 312 | 280 |
| @msgpack/msgpack | 748,737 (×2.31) | 188,817 (×0.39) | 409 | 429 | 376 |
| cbor-x (records) | 717,485 (×2.21) | 445,306 (×0.91) | 416 | 435 | 355 |
| fast-json-stringify (encode) + JSON.parse | 1,867,242 (×5.75) | 491,362 (×1.01) | 764 | 406 | 392 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-14. Median of 5 rounds in a fresh process per library and scenario (the spread of the rounds is in bench/results/compare.json); bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

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
  smallest on lists.

`pnpm bench` is the engine harness for protoarray alone (both backends, every layout, against the
JSON of the keyed object), with `--save` and `--compare` to track a change on one machine.
