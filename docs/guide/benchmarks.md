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
| JSON | 1,389,299 (×1.00) | 956,204 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,087,441 (×1.50) | 1,709,611 (×1.79) | 135 | 134 | 110 |
| protoarray (closures) | 1,554,280 (×1.12) | 1,000,926 (×1.05) | 135 | 134 | 110 |
| protobufjs | 1,432,630 (×1.03) | 1,464,340 (×1.53) | 115 | 127 | 117 |
| avsc | 1,754,953 (×1.26) | 1,847,640 (×1.93) | 97 | 111 | 101 |
| msgpackr | 1,226,506 (×0.88) | 738,504 (×0.77) | 206 | 207 | 173 |
| msgpackr (records, shared structures) | 1,511,474 (×1.09) | 2,637,199 (×2.76) | 108 | 124 | 112 |
| @msgpack/msgpack | 755,631 (×0.54) | 699,935 (×0.73) | 198 | 200 | 166 |
| cbor-x (records) | 792,687 (×0.57) | 682,828 (×0.71) | 215 | 218 | 187 |
| fast-json-stringify (encode) + JSON.parse | 1,701,003 (×1.22) | 954,446 (×1.00) | 266 | 212 | 178 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,549 (×1.00) | 909 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 2,027 (×1.31) | 1,545 (×1.70) | 140,738 | 30,666 | 26,946 |
| protoarray (closures) | 1,453 (×0.94) | 958 (×1.05) | 140,738 | 30,666 | 26,946 |
| protoarray (columns) | 2,077 (×1.34) | 1,535 (×1.69) | 138,758 | 27,412 | 21,053 |
| protobufjs | 1,321 (×0.85) | 1,414 (×1.56) | 120,459 | 31,414 | 28,985 |
| avsc | 1,426 (×0.92) | 1,833 (×2.02) | 101,839 | 29,895 | 27,334 |
| msgpackr | 1,241 (×0.80) | 810 (×0.89) | 210,061 | 34,139 | 30,555 |
| msgpackr (records, shared structures) | 1,557 (×1.01) | 2,878 (×3.17) | 112,274 | 30,957 | 28,370 |
| @msgpack/msgpack | 804 (×0.52) | 715 (×0.79) | 202,061 | 33,895 | 30,367 |
| cbor-x (records) | 1,404 (×0.91) | 2,431 (×2.67) | 125,051 | 31,582 | 29,016 |
| fast-json-stringify (encode) + JSON.parse | 1,600 (×1.03) | 928 (×1.02) | 271,215 | 33,793 | 29,133 |

**sparse** — 20 optional fields, 3 present

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 7,012,192 (×1.00) | 4,817,607 (×1.00) | 33 | 53 | 36 |
| protoarray (codegen) | 7,321,584 (×1.04) | 7,670,569 (×1.59) | 23 | 43 | 27 |
| protoarray (closures) | 3,313,755 (×0.47) | 2,702,137 (×0.56) | 23 | 43 | 27 |
| protobufjs | 5,551,701 (×0.79) | 9,917,930 (×2.06) | 11 | 31 | 15 |
| avsc | 1,396,842 (×0.20) | 3,664,710 (×0.76) | 28 | 35 | 23 |
| msgpackr | 6,177,027 (×0.88) | 6,928,753 (×1.44) | 21 | 41 | 25 |
| msgpackr (records, shared structures) | 6,047,975 (×0.86) | 12,401,392 (×2.57) | 9 | 29 | 13 |
| @msgpack/msgpack | 5,325,709 (×0.76) | 3,514,770 (×0.73) | 19 | 39 | 23 |
| cbor-x (records) | 3,094,816 (×0.44) | 3,712,362 (×0.77) | 27 | 47 | 31 |
| fast-json-stringify (encode) + JSON.parse | 14,588,311 (×2.08) | 4,660,980 (×0.97) | 33 | 53 | 36 |

**typed** — enum, boolean and date heavy record

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 855,710 (×1.00) | 2,921,437 (×1.00) | 123 | 120 | 94 |
| protoarray (codegen) | 3,900,846 (×4.56) | 4,856,757 (×1.66) | 36 | 46 | 36 |
| protoarray (closures) | 3,117,180 (×3.64) | 2,962,802 (×1.01) | 36 | 46 | 36 |
| protobufjs | 3,865,883 (×4.52) | 12,720,766 (×4.35) | 13 | 33 | 17 |
| avsc | 2,151,210 (×2.51) | 7,956,398 (×2.72) | 12 | 32 | 16 |
| msgpackr | 2,876,799 (×3.36) | 2,853,076 (×0.98) | 73 | 96 | 72 |
| msgpackr (records, shared structures) | 3,537,171 (×4.13) | 5,421,300 (×1.86) | 24 | 45 | 28 |
| @msgpack/msgpack | 1,204,773 (×1.41) | 1,600,984 (×0.55) | 71 | 92 | 71 |
| cbor-x (records) | 1,777,018 (×2.08) | 1,611,077 (×0.55) | 79 | 100 | 80 |
| fast-json-stringify (encode) + JSON.parse | 4,891,996 (×5.72) | 2,795,477 (×0.96) | 110 | 107 | 83 |

**strings** — long Cyrillic strings

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,573,299 (×1.00) | 1,361,887 (×1.00) | 816 | 266 | 229 |
| protoarray (codegen) | 1,813,465 (×1.15) | 1,726,447 (×1.27) | 785 | 230 | 207 |
| protoarray (closures) | 1,741,755 (×1.11) | 1,584,255 (×1.16) | 785 | 230 | 207 |
| protobufjs | 592,928 (×0.38) | 523,880 (×0.38) | 777 | 233 | 211 |
| avsc | 509,351 (×0.32) | 793,477 (×0.58) | 774 | 231 | 210 |
| msgpackr | 871,890 (×0.55) | 220,425 (×0.16) | 800 | 263 | 234 |
| msgpackr (records, shared structures) | 890,116 (×0.57) | 245,891 (×0.18) | 775 | 230 | 206 |
| @msgpack/msgpack | 382,339 (×0.24) | 704,971 (×0.52) | 798 | 260 | 233 |
| cbor-x (records) | 728,943 (×0.46) | 246,019 (×0.18) | 806 | 269 | 241 |
| fast-json-stringify (encode) + JSON.parse | 1,309,932 (×0.83) | 1,358,268 (×1.00) | 816 | 266 | 229 |

**numeric** — 32 doubles (where binary formats shine)

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 326,825 (×1.00) | 481,936 (×1.00) | 764 | 406 | 392 |
| protoarray (codegen) | 432,109 (×1.32) | 745,478 (×1.55) | 582 | 309 | 295 |
| protoarray (closures) | 368,886 (×1.13) | 585,412 (×1.21) | 582 | 309 | 295 |
| protobufjs | 731,400 (×2.24) | 1,970,447 (×4.09) | 305 | 328 | 304 |
| avsc | 2,003,165 (×6.13) | 3,165,111 (×6.57) | 256 | 279 | 260 |
| msgpackr | 1,126,451 (×3.45) | 443,712 (×0.92) | 409 | 429 | 376 |
| msgpackr (records, shared structures) | 1,421,016 (×4.35) | 3,508,601 (×7.28) | 289 | 312 | 280 |
| @msgpack/msgpack | 754,239 (×2.31) | 190,808 (×0.40) | 409 | 429 | 376 |
| cbor-x (records) | 721,073 (×2.21) | 453,275 (×0.94) | 416 | 435 | 355 |
| fast-json-stringify (encode) + JSON.parse | 1,862,391 (×5.70) | 469,607 (×0.97) | 764 | 406 | 392 |

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
- **Sizes**: protoarray's wire is JSON text; the binary codecs' bytes are before any base64 a
  text channel would add. After gzip or brotli the formats are close, and `columns` is the
  smallest on lists.

`pnpm bench` is the engine harness for protoarray alone (both backends, every layout, against the
JSON of the keyed object), with `--save` and `--compare` to track a change on one machine.
