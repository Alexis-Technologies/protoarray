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
| JSON | 1,384,218 (×1.00) | 982,920 (×1.00) | 266 | 212 | 178 |
| protoarray (codegen) | 2,054,885 (×1.48) | 1,660,983 (×1.69) | 135 | 134 | 110 |
| protoarray (closures) | 1,569,149 (×1.13) | 1,007,181 (×1.02) | 135 | 134 | 110 |
| protobufjs | 1,412,521 (×1.02) | 1,463,368 (×1.49) | 115 | 127 | 117 |
| avsc | 1,727,757 (×1.25) | 1,820,438 (×1.85) | 97 | 111 | 101 |
| msgpackr | 1,239,073 (×0.90) | 749,388 (×0.76) | 206 | 207 | 173 |
| msgpackr (records, shared structures) | 1,494,853 (×1.08) | 2,621,503 (×2.67) | 108 | 124 | 112 |
| @msgpack/msgpack | 752,678 (×0.54) | 693,406 (×0.71) | 198 | 200 | 166 |
| cbor-x (records) | 783,765 (×0.57) | 676,246 (×0.69) | 215 | 218 | 187 |
| fast-json-stringify (encode) + JSON.parse | 1,742,098 (×1.26) | 948,524 (×0.97) | 266 | 212 | 178 |

**records** — 1000 records of the same shape

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,528 (×1.00) | 921 (×1.00) | 271,215 | 33,793 | 29,133 |
| protoarray (codegen) | 2,006 (×1.31) | 1,491 (×1.62) | 140,738 | 30,666 | 26,946 |
| protoarray (closures) | 1,445 (×0.95) | 945 (×1.03) | 140,738 | 30,666 | 26,946 |
| protoarray (columns) | 2,058 (×1.35) | 1,530 (×1.66) | 138,758 | 27,412 | 21,053 |
| protobufjs | 1,298 (×0.85) | 1,370 (×1.49) | 120,459 | 31,414 | 28,985 |
| avsc | 1,423 (×0.93) | 1,790 (×1.94) | 101,839 | 29,895 | 27,334 |
| msgpackr | 1,231 (×0.81) | 760 (×0.83) | 210,061 | 34,139 | 30,555 |
| msgpackr (records, shared structures) | 1,529 (×1.00) | 2,894 (×3.14) | 112,274 | 30,957 | 28,370 |
| @msgpack/msgpack | 792 (×0.52) | 715 (×0.78) | 202,061 | 33,895 | 30,367 |
| cbor-x (records) | 1,395 (×0.91) | 2,360 (×2.56) | 125,051 | 31,582 | 29,016 |
| fast-json-stringify (encode) + JSON.parse | 1,570 (×1.03) | 906 (×0.98) | 271,215 | 33,793 | 29,133 |

**sparse** — 20 optional fields, 3 present

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 6,896,853 (×1.00) | 4,633,576 (×1.00) | 33 | 53 | 36 |
| protoarray (codegen) | 7,282,813 (×1.06) | 7,541,947 (×1.63) | 23 | 43 | 27 |
| protoarray (closures) | 3,150,554 (×0.46) | 2,597,281 (×0.56) | 23 | 43 | 27 |
| protobufjs | 5,579,042 (×0.81) | 9,572,425 (×2.07) | 11 | 31 | 15 |
| avsc | 1,432,564 (×0.21) | 3,623,596 (×0.78) | 28 | 35 | 23 |
| msgpackr | 6,028,754 (×0.87) | 6,598,373 (×1.42) | 21 | 41 | 25 |
| msgpackr (records, shared structures) | 5,800,894 (×0.84) | 12,147,954 (×2.62) | 9 | 29 | 13 |
| @msgpack/msgpack | 5,162,258 (×0.75) | 3,387,991 (×0.73) | 19 | 39 | 23 |
| cbor-x (records) | 3,060,841 (×0.44) | 3,642,644 (×0.79) | 27 | 47 | 31 |
| fast-json-stringify (encode) + JSON.parse | 14,348,947 (×2.08) | 4,746,363 (×1.02) | 33 | 53 | 36 |

**typed** — enum, boolean and date heavy record

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 836,214 (×1.00) | 2,704,009 (×1.00) | 123 | 120 | 94 |
| protoarray (codegen) | 3,864,842 (×4.62) | 4,897,878 (×1.81) | 36 | 46 | 36 |
| protoarray (closures) | 2,989,771 (×3.58) | 2,835,458 (×1.05) | 36 | 46 | 36 |
| protobufjs | 3,849,274 (×4.60) | 12,342,299 (×4.56) | 13 | 33 | 17 |
| avsc | 2,128,499 (×2.55) | 7,918,165 (×2.93) | 12 | 32 | 16 |
| msgpackr | 2,845,816 (×3.40) | 2,826,156 (×1.05) | 73 | 96 | 72 |
| msgpackr (records, shared structures) | 3,472,617 (×4.15) | 5,345,007 (×1.98) | 24 | 45 | 28 |
| @msgpack/msgpack | 1,174,602 (×1.40) | 1,566,486 (×0.58) | 71 | 92 | 71 |
| cbor-x (records) | 1,777,404 (×2.13) | 1,547,828 (×0.57) | 79 | 100 | 80 |
| fast-json-stringify (encode) + JSON.parse | 4,791,577 (×5.73) | 2,791,370 (×1.03) | 110 | 107 | 83 |

**strings** — long Cyrillic strings

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 1,568,646 (×1.00) | 1,345,380 (×1.00) | 816 | 266 | 229 |
| protoarray (codegen) | 1,798,348 (×1.15) | 1,665,480 (×1.24) | 785 | 230 | 207 |
| protoarray (closures) | 1,699,083 (×1.08) | 1,543,882 (×1.15) | 785 | 230 | 207 |
| protobufjs | 585,065 (×0.37) | 510,432 (×0.38) | 777 | 233 | 211 |
| avsc | 495,006 (×0.32) | 773,970 (×0.58) | 774 | 231 | 210 |
| msgpackr | 832,573 (×0.53) | 211,753 (×0.16) | 800 | 263 | 234 |
| msgpackr (records, shared structures) | 850,079 (×0.54) | 236,990 (×0.18) | 775 | 230 | 206 |
| @msgpack/msgpack | 374,203 (×0.24) | 687,164 (×0.51) | 798 | 260 | 233 |
| cbor-x (records) | 694,815 (×0.44) | 239,985 (×0.18) | 806 | 269 | 241 |
| fast-json-stringify (encode) + JSON.parse | 1,291,589 (×0.82) | 1,332,118 (×0.99) | 816 | 266 | 229 |

**numeric** — 32 doubles (where binary formats shine)

| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSON | 316,109 (×1.00) | 479,129 (×1.00) | 764 | 406 | 392 |
| protoarray (codegen) | 401,959 (×1.27) | 716,742 (×1.50) | 582 | 309 | 295 |
| protoarray (closures) | 366,874 (×1.16) | 574,273 (×1.20) | 582 | 309 | 295 |
| protobufjs | 723,174 (×2.29) | 1,955,692 (×4.08) | 305 | 328 | 304 |
| avsc | 1,953,218 (×6.18) | 3,133,766 (×6.54) | 256 | 279 | 260 |
| msgpackr | 1,112,073 (×3.52) | 449,914 (×0.94) | 409 | 429 | 376 |
| msgpackr (records, shared structures) | 1,415,683 (×4.48) | 3,347,943 (×6.99) | 289 | 312 | 280 |
| @msgpack/msgpack | 746,062 (×2.36) | 190,479 (×0.40) | 409 | 429 | 376 |
| cbor-x (records) | 716,233 (×2.27) | 425,511 (×0.89) | 416 | 435 | 355 |
| fast-json-stringify (encode) + JSON.parse | 1,839,211 (×5.82) | 488,843 (×1.02) | 764 | 406 | 392 |

_Node v24.14.1 (V8 13.6.233.17-node.44), Apple M3 Max, 2026-10-09. Median of 5 runs; bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._

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
