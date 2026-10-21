// Cases of the binary wire beyond the vectors (./vectors.js): the edges of
// the string forms, wide enums and flags, unions, nullable lists, tuples,
// maps, dictionaries, bytes, bigints, dates, decimals, json, the header past
// eight fields, a sparse record and a root scalar. tests/fixtures/
// golden-binary.json holds the bytes of each case and of each vector as
// base64: the wire is a contract, so a change to them is a new major version
// with a new fixture, never a regenerated one.
const LONE = String.fromCharCode(0xd800);
const AT = 1700000000000;

const WIDE = {};
for (let i = 0; i < 40; i++) WIDE[`f${i}`] = '?number';

const HEADER = {};
for (const key of 'abcdefghi') HEADER[key] = key === 'b' ? '?boolean' : 'boolean';

const CASES = [
  { name: 'a short string, UTF-8', definition: { s: 'string' }, value: { s: 'x'.repeat(21) } },
  { name: 'a long string, UTF-16', definition: { s: 'string' }, value: { s: 'x'.repeat(22) } },
  { name: 'a lone surrogate, UTF-16', definition: { s: 'string' }, value: { s: `${LONE}a` } },
  { name: 'two-byte characters, UTF-8', definition: { s: 'string' }, value: { s: 'ы'.repeat(21) } },
  { name: 'an astral character, UTF-8', definition: { s: 'string' }, value: { s: '😀' } },
  {
    name: 'an enum past 256 values',
    definition: { e: { enum: Array.from({ length: 300 }, (_, i) => `v${i}`) } },
    value: { e: 'v299' },
  },
  {
    name: 'flags past 31 names',
    definition: { f: { flags: Array.from({ length: 40 }, (_, i) => `n${i}`) } },
    value: { f: { n0: true, n35: true } },
  },
  {
    name: 'a union',
    definition: {
      packet: {
        union: [
          { Struct: {}, type: { enum: ['call'] }, id: 'string' },
          { Struct: {}, type: { enum: ['event'] }, name: 'string', on: 'boolean' },
        ],
        discriminator: 'type',
      },
    },
    value: { packet: { type: 'event', name: 'x', on: true } },
  },
  {
    name: 'a nullable list',
    definition: { items: { array: '?integer' } },
    value: { items: [1, null, -3] },
  },
  {
    name: 'a set of integers',
    definition: { ids: { set: 'integer' } },
    value: { ids: new Set([5, 2 ** 40]) },
  },
  { name: 'a tuple', definition: { pair: ['number', '?string'] }, value: { pair: [1.5, null] } },
  {
    name: 'a map of dates',
    definition: { seen: { map: { string: '?date' } } },
    value: {
      seen: new Map([
        ['a', new Date(AT)],
        ['b', null],
      ]),
    },
  },
  {
    name: 'a dictionary',
    definition: { prices: { object: { string: 'number' } } },
    value: { prices: { a: 1, b: -0.5 } },
  },
  {
    name: 'bytes, a bigint, json and decimals',
    definition: { y: 'bytes', g: 'bigint', j: 'json', d: { type: 'number', decimals: 2 } },
    value: { y: Uint8Array.of(0, 255, 7), g: -(2n ** 70n), j: { k: [1, 'two', null] }, d: 19.99 },
  },
  {
    name: 'booleans in the header, past eight fields',
    definition: HEADER,
    value: { a: true, c: false, d: true, e: true, f: false, g: true, h: false, i: true },
  },
  {
    name: 'a sparse record',
    definition: WIDE,
    options: { sparse: true },
    value: { f0: 1, f35: 2 },
  },
  { name: 'a root scalar', definition: '?integer', value: -64 },
  { name: 'a root scalar, null', definition: '?integer', value: null },
];

module.exports = { CASES };
