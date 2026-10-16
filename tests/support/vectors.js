// The wire format as data: a metaschema definition, the options of the wire,
// a value, the array it travels as and the object it comes back as. Docs
// examples are drawn from this list, so they cannot drift from the code.
const { Schema } = require('@alexify/metaschema');

const Address = Schema.from({ city: 'string', zip: '?string' });

const AT = 1700000000000;

// 40 optional fields: a sparse record takes two segments of masks.
const WIDE = {};
for (let i = 0; i < 40; i++) WIDE[`f${i}`] = '?number';
const NAMES = Array.from({ length: 40 }, (_, i) => `n${i}`);
const allFalse = Object.fromEntries(NAMES.map((name) => [name, false]));

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
    name: 'a collection in a layout of its own inside a record',
    definition: { items: { array: { a: 'number', b: '?number' } } },
    options: { layout: { items: 'flat' } },
    value: { items: [{ a: 1 }, { a: 2, b: 3 }] },
    wire: [[1, null, 2, 3]],
    decoded: {
      items: [
        { a: 1, b: null },
        { a: 2, b: 3 },
      ],
    },
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
    name: 'decimals travel as scaled integers',
    definition: { price: { type: 'number', decimals: 2 }, total: { type: 'number', decimals: 2 } },
    value: { price: 19.99, total: 0.1 + 0.2 },
    wire: [1999, 30],
    decoded: { price: 19.99, total: 0.3 },
  },
  {
    name: 'bytes travel as base64',
    definition: { id: 'number', avatar: 'bytes' },
    value: { id: 1, avatar: new Uint8Array([137, 80, 78, 71]) },
    wire: [1, 'iVBORw=='],
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
    definition: { Struct: {}, a: 'number' },
    value: { a: 1 },
    wire: [1],
  },
  {
    name: 'a stored kind adds the id field of its entity',
    definition: { Entity: {}, a: 'number' },
    value: { a: 1, id: 'u-1' },
    wire: [1, 'u-1'],
  },
  {
    name: 'union: the tag leads and the discriminator does not travel',
    definition: {
      union: [
        { Struct: {}, type: { enum: ['call'] }, id: 'string', method: 'string', args: '?json' },
        { Struct: {}, type: { enum: ['event'] }, name: 'string', data: '?json' },
      ],
      discriminator: 'type',
    },
    value: { type: 'call', id: '7', method: 'auth/signIn', args: ['alex', 'secret'] },
    wire: [0, '7', 'auth/signIn', ['alex', 'secret']],
  },
  {
    name: 'union: trailing optionals of a branch are trimmed',
    definition: {
      union: [
        { Struct: {}, type: { enum: ['call'] }, id: 'string', method: 'string', args: '?json' },
        { Struct: {}, type: { enum: ['event'] }, name: 'string', data: '?json' },
      ],
      discriminator: 'type',
    },
    value: { type: 'event', name: 'chat/message' },
    wire: [1, 'chat/message'],
    decoded: { type: 'event', name: 'chat/message', data: null },
  },
  {
    name: 'union: a branch with several values',
    definition: {
      union: [
        { r: 'number', kind: { enum: ['circle'] } },
        { side: 'number', kind: { enum: ['square', 'diamond'] } },
      ],
      discriminator: 'kind',
    },
    value: { side: 2, kind: 'diamond' },
    wire: [2, 2],
  },
  {
    name: 'array of unions',
    definition: {
      array: {
        union: [
          { Struct: {}, type: { enum: ['ping'] } },
          { Struct: {}, type: { enum: ['event'] }, name: 'string' },
        ],
        discriminator: 'type',
      },
    },
    value: [{ type: 'ping' }, { type: 'event', name: 'x' }],
    wire: [[0], [1, 'x']],
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
    name: 'a sparse record past 31 fields takes a segment per 31',
    definition: WIDE,
    options: { sparse: true },
    value: { f0: 1, f3: 2, f35: 3 },
    wire: [9, 1, 2, 16, 3],
    decoded: {
      ...Object.fromEntries(Object.keys(WIDE).map((key) => [key, null])),
      f0: 1,
      f3: 2,
      f35: 3,
    },
  },
  {
    name: 'trailing empty segments are trimmed',
    definition: WIDE,
    options: { sparse: true },
    value: { f3: 2 },
    wire: [8, 2],
    decoded: { ...Object.fromEntries(Object.keys(WIDE).map((key) => [key, null])), f3: 2 },
  },
  {
    name: 'flags past 31 names take an array of words',
    definition: { perms: { flags: NAMES } },
    value: { perms: { n0: true, n35: true } },
    wire: [[1, 16]],
    decoded: { perms: { ...allFalse, n0: true, n35: true } },
  },
  {
    name: 'wide flags stay one integer while the first word holds them all',
    definition: { perms: { flags: NAMES } },
    value: { perms: { n2: true } },
    wire: [4],
    decoded: { perms: { ...allFalse, n2: true } },
  },
  {
    name: 'integer, any and unknown travel as they are',
    definition: { n: 'integer', a: 'any', u: 'unknown' },
    value: { n: 3, a: { x: [1] } },
    wire: [3, { x: [1] }],
    decoded: { n: 3, a: { x: [1] }, u: null },
  },
  {
    name: 'a null slot is always null',
    definition: { gap: 'null', id: 'number' },
    value: { id: 1 },
    wire: [null, 1],
    decoded: { gap: null, id: 1 },
  },
  {
    name: 'a set travels as the array of its elements',
    definition: { tags: { set: 'string' } },
    value: { tags: new Set(['admin', 'editor']) },
    wire: [['admin', 'editor']],
  },
  {
    name: 'a map travels as flat key-value pairs',
    definition: { seen: { map: { string: 'date' } } },
    value: {
      seen: new Map([
        ['Kyiv', new Date(AT)],
        ['Lviv', new Date(AT + 1)],
      ]),
    },
    wire: [['Kyiv', AT, 'Lviv', AT + 1]],
  },
  {
    name: 'a map with number keys',
    definition: { scores: { type: 'map', key: 'number', value: '?string' } },
    value: {
      scores: new Map([
        [1, 'a'],
        [2, null],
      ]),
    },
    wire: [[1, 'a', 2, null]],
  },
  {
    name: 'an object dictionary keeps its keys',
    definition: { prices: { object: { string: { type: 'number', decimals: 2 } } } },
    value: { prices: { tea: 1.5, coffee: 2.25 } },
    wire: [{ tea: 150, coffee: 225 }],
  },
  {
    name: 'a tuple of any elements, named ones too',
    definition: { hit: [{ at: 'date' }, { x: 'number', y: 'number' }, { 'label?': 'string' }] },
    value: { hit: [new Date(AT), { x: 1, y: 2 }] },
    wire: [[AT, [1, 2], null]],
    decoded: { hit: [new Date(AT), { x: 1, y: 2 }, null] },
  },
  {
    name: 'long forms of collections',
    definition: {
      list: { type: 'array', value: 'number' },
      set: { type: 'set', value: 'number' },
      pair: { type: 'tuple', value: ['number', 'string'] },
      nested: { schema: { a: 'string' } },
    },
    value: { list: [1], set: new Set([2]), pair: [3, 'x'], nested: { a: 'y' } },
    wire: [[1], [2], [3, 'x'], ['y']],
  },
  {
    name: 'a list of integers travels as differences',
    definition: { ids: { array: 'integer' }, at: { array: 'date' } },
    options: { delta: ['ids', 'at'] },
    value: { ids: [100, 101, 103, 102], at: [new Date(AT), new Date(AT + 500)] },
    wire: [
      [100, 1, 2, -1],
      [AT, 500],
    ],
  },
  {
    name: 'interned strings travel as indices into the message table',
    definition: { role: 'string', tags: { array: '?string' } },
    options: { intern: true },
    value: { role: 'admin', tags: ['admin', null, 'editor'] },
    wire: [
      ['admin', 'editor'],
      [0, [0, null, 1]],
    ],
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
    name: 'columns layout with delta columns',
    definition: { array: { id: 'integer', at: 'date', n: 'number' } },
    options: { layout: 'columns', delta: ['[].id', '[].at'] },
    value: [
      { id: 100, at: new Date(AT), n: 1 },
      { id: 101, at: new Date(AT + 60000), n: 2 },
      { id: 103, at: new Date(AT + 120000), n: 3 },
    ],
    wire: [
      [100, 1, 2],
      [AT, 60000, 60000],
      [1, 2, 3],
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
