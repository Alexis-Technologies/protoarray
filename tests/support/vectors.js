// The wire format as data: a definition, a value, the array it travels as and
// the object it comes back as. Docs examples are drawn from this list, so they
// cannot drift from the code.
const { Schema } = require('../../index.js');

const Address = Schema.from({ city: 'string', zip: '?string' });

const AT = 1700000000000;

const VECTORS = [
  {
    name: 'flat record',
    definition: { name: 'string', age: 'number' },
    value: { name: 'Alex', age: 27 },
    wire: ['Alex', 27],
  },
  {
    name: 'trailing optionals are trimmed',
    definition: { name: 'string', email: '?string', age: '?number' },
    value: { name: 'Alex' },
    wire: ['Alex'],
    decoded: { name: 'Alex', email: null, age: null },
  },
  {
    name: 'a missing optional before a required field stays as null',
    definition: { nick: '?string', id: 'number' },
    value: { id: 1 },
    wire: [null, 1],
    decoded: { nick: null, id: 1 },
  },
  {
    name: 'undefined and null travel the same way',
    definition: { a: '?string', b: '?string', c: 'number' },
    value: { a: undefined, b: null, c: 3 },
    wire: [null, null, 3],
    decoded: { a: null, b: null, c: 3 },
  },
  {
    name: 'optional key spelling',
    definition: { name: 'string', 'email?': 'string' },
    value: { name: 'Alex' },
    wire: ['Alex'],
    decoded: { name: 'Alex', email: null },
  },
  {
    name: 'long form',
    definition: { name: { type: 'string' }, email: { type: 'string', required: false } },
    value: { name: 'Alex' },
    wire: ['Alex'],
    decoded: { name: 'Alex', email: null },
  },
  {
    name: 'default fills a missing slot',
    definition: { balance: { type: 'number', default: 0 }, name: 'string' },
    value: { name: 'Alex' },
    wire: [null, 'Alex'],
    decoded: { balance: 0, name: 'Alex' },
  },
  {
    name: 'nested struct',
    definition: { id: 'number', address: { city: 'string', zip: '?string' } },
    value: { id: 1, address: { city: 'Kyiv' } },
    wire: [1, ['Kyiv']],
    decoded: { id: 1, address: { city: 'Kyiv', zip: null } },
  },
  {
    name: 'nested struct with every field missing is an empty array, not null',
    definition: { id: 'number', meta: { a: '?string', b: '?string' } },
    value: { id: 1, meta: {} },
    wire: [1, []],
    decoded: { id: 1, meta: { a: null, b: null } },
  },
  {
    name: 'missing optional nested struct',
    definition: { id: 'number', meta: { type: 'json', required: false } },
    value: { id: 1 },
    wire: [1],
    decoded: { id: 1, meta: null },
  },
  {
    name: 'schema used by value',
    definition: { id: 'number', home: Address, work: Address },
    value: { id: 1, home: { city: 'Kyiv', zip: '01001' }, work: { city: 'Lviv' } },
    wire: [1, ['Kyiv', '01001'], ['Lviv']],
    decoded: { id: 1, home: { city: 'Kyiv', zip: '01001' }, work: { city: 'Lviv', zip: null } },
  },
  {
    name: 'array of scalars travels as it is',
    definition: { tags: { array: 'string' } },
    value: { tags: ['admin', 'editor'] },
    wire: [['admin', 'editor']],
  },
  {
    name: 'empty array',
    definition: { tags: { array: 'string' } },
    value: { tags: [] },
    wire: [[]],
  },
  {
    name: 'array of optional scalars keeps null slots',
    definition: { list: { array: '?number' } },
    value: { list: [1, null, 3] },
    wire: [[1, null, 3]],
  },
  {
    name: 'array of records is an array of arrays',
    definition: { orders: { array: { sku: 'string', qty: '?number' } } },
    value: { orders: [{ sku: 'A-1', qty: 2 }, { sku: 'B-7' }] },
    wire: [[['A-1', 2], ['B-7']]],
    decoded: {
      orders: [
        { sku: 'A-1', qty: 2 },
        { sku: 'B-7', qty: null },
      ],
    },
  },
  {
    name: 'array of arrays',
    definition: { grid: { array: { array: 'number' } } },
    value: { grid: [[1, 2], [3]] },
    wire: [[[1, 2], [3]]],
  },
  {
    name: 'enum travels as its index',
    definition: { role: { enum: ['admin', 'editor', 'viewer'] } },
    value: { role: 'editor' },
    wire: [1],
  },
  {
    name: 'array of enums',
    definition: { roles: { array: { enum: ['admin', 'editor'] } } },
    value: { roles: ['editor', 'admin'] },
    wire: [[1, 0]],
  },
  {
    name: 'date travels as epoch milliseconds',
    definition: { at: 'date' },
    value: { at: new Date(AT) },
    wire: [AT],
  },
  {
    name: 'bigint travels as a decimal string',
    definition: { n: 'bigint' },
    value: { n: 12345678901234567890n },
    wire: ['12345678901234567890'],
  },
  {
    name: 'flags travel as a bitmask',
    definition: { perms: { flags: ['read', 'write', 'admin'] } },
    value: { perms: { read: true, admin: true } },
    wire: [5],
    decoded: { perms: { read: true, write: false, admin: true } },
  },
  {
    name: 'tuple',
    definition: { point: ['number', 'number'] },
    value: { point: [1, 2] },
    wire: [[1, 2]],
  },
  {
    name: 'tuple with an optional element',
    definition: { pair: ['number', '?string'] },
    value: { pair: [1] },
    wire: [[1, null]],
    decoded: { pair: [1, null] },
  },
  {
    name: 'json passes any value through',
    definition: { payload: 'json', next: 'number' },
    value: { payload: { any: [1, { deep: true }] }, next: 2 },
    wire: [{ any: [1, { deep: true }] }, 2],
  },
  {
    name: 'json null is a value and json is never required',
    definition: { payload: 'json', next: '?number' },
    value: { payload: null, next: 1 },
    wire: [null, 1],
  },
  {
    name: 'keys with quotes, newlines and unicode',
    definition: { 'ім’я': 'string', 'with"quote': 'number', 'new\nline': 'boolean' },
    value: { 'ім’я': 'Олена', 'with"quote': 1, 'new\nline': true },
    wire: ['Олена', 1, true],
  },
  {
    name: 'calculated fields have no position',
    definition: { a: 'number', b: (record) => record.a * 2 },
    value: { a: 1, b: 9 },
    wire: [1],
    decoded: { a: 1 },
  },
  {
    name: 'a kind key is metadata',
    definition: { Entity: {}, a: 'number' },
    value: { a: 1 },
    wire: [1],
  },
  {
    name: 'sparse record',
    definition: { a: 'number', b: '?string', c: '?string', d: '?number' },
    options: { sparse: true },
    value: { a: 1, d: 4 },
    wire: [9, 1, 4],
    decoded: { a: 1, b: null, c: null, d: 4 },
  },
  {
    name: 'root array of records',
    definition: { array: { id: 'number', name: '?string' } },
    value: [{ id: 1 }, { id: 2, name: 'x' }],
    wire: [[1], [2, 'x']],
    decoded: [
      { id: 1, name: null },
      { id: 2, name: 'x' },
    ],
  },
  {
    name: 'root array with null records',
    definition: { array: { type: 'json', required: false } },
    value: [{ a: 1 }, null],
    wire: [{ a: 1 }, null],
  },
  {
    name: 'root tuple',
    definition: ['number', '?string'],
    value: [1],
    wire: [1, null],
    decoded: [1, null],
  },
  {
    name: 'root scalar',
    definition: 'string',
    value: 'Alex',
    wire: 'Alex',
  },
  {
    name: 'flat layout',
    definition: { array: { a: 'number', b: '?string' } },
    options: { layout: 'flat' },
    value: [{ a: 1 }, { a: 2, b: 'x' }],
    wire: [1, null, 2, 'x'],
    decoded: [
      { a: 1, b: null },
      { a: 2, b: 'x' },
    ],
  },
  {
    name: 'columns layout',
    definition: { array: { a: 'number', b: '?string' } },
    options: { layout: 'columns' },
    value: [{ a: 1 }, { a: 2, b: 'x' }],
    wire: [
      [1, 2],
      [null, 'x'],
    ],
    decoded: [
      { a: 1, b: null },
      { a: 2, b: 'x' },
    ],
  },
];

module.exports = { VECTORS, Address, AT };
