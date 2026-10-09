/**
 * Payload shapes the comparison runs on. Every adapter must round-trip
 * `value` through its own format before it is timed.
 */

const rnd = (
  (seed) => () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
)(7);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const CITIES = ['Kyiv', 'Lviv', 'Odesa', 'Kharkiv', 'Dnipro'];
const ROLES = ['admin', 'editor', 'viewer', 'owner'];

const user = (i) => ({
  id: 100000 + i,
  name: `User ${i} ${pick(['Alex', 'Olena', 'Taras', 'Maria'])}`,
  email: `user${i}@example.com`,
  age: 18 + Math.floor(rnd() * 60),
  active: rnd() > 0.3,
  balance: Math.round(rnd() * 1e6) / 100,
  role: pick(ROLES),
  address: {
    city: pick(CITIES),
    street: `Street ${Math.floor(rnd() * 200)}`,
    zip: `0${1000 + Math.floor(rnd() * 8999)}`,
  },
  tags: [pick(ROLES), pick(CITIES)],
  orders: [
    { sku: `A-${i}`, qty: 1 + Math.floor(rnd() * 5) },
    { sku: `B-${i}`, qty: 1 + Math.floor(rnd() * 5) },
  ],
});

const USER = {
  definition: {
    id: 'number',
    name: 'string',
    email: 'string',
    age: 'number',
    active: 'boolean',
    balance: 'number',
    role: { enum: ROLES },
    address: { city: 'string', street: 'string', zip: 'string' },
    tags: { array: 'string' },
    orders: { array: { sku: 'string', qty: 'number' } },
  },
  // protobufjs reflection JSON (proto3)
  proto: {
    nested: {
      Address: {
        fields: {
          city: { type: 'string', id: 1 },
          street: { type: 'string', id: 2 },
          zip: { type: 'string', id: 3 },
        },
      },
      Order: { fields: { sku: { type: 'string', id: 1 }, qty: { type: 'int32', id: 2 } } },
      Role: { values: { admin: 0, editor: 1, viewer: 2, owner: 3 } },
      User: {
        fields: {
          id: { type: 'int32', id: 1 },
          name: { type: 'string', id: 2 },
          email: { type: 'string', id: 3 },
          age: { type: 'int32', id: 4 },
          active: { type: 'bool', id: 5 },
          balance: { type: 'double', id: 6 },
          role: { type: 'Role', id: 7 },
          address: { type: 'Address', id: 8 },
          tags: { rule: 'repeated', type: 'string', id: 9 },
          orders: { rule: 'repeated', type: 'Order', id: 10 },
        },
      },
    },
  },
  avro: {
    type: 'record',
    name: 'User',
    fields: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'age', type: 'int' },
      { name: 'active', type: 'boolean' },
      { name: 'balance', type: 'double' },
      { name: 'role', type: { type: 'enum', name: 'Role', symbols: ROLES } },
      {
        name: 'address',
        type: {
          type: 'record',
          name: 'Address',
          fields: [
            { name: 'city', type: 'string' },
            { name: 'street', type: 'string' },
            { name: 'zip', type: 'string' },
          ],
        },
      },
      { name: 'tags', type: { type: 'array', items: 'string' } },
      {
        name: 'orders',
        type: {
          type: 'array',
          items: {
            type: 'record',
            name: 'Order',
            fields: [
              { name: 'sku', type: 'string' },
              { name: 'qty', type: 'int' },
            ],
          },
        },
      },
    ],
  },
  json: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      email: { type: 'string' },
      age: { type: 'integer' },
      active: { type: 'boolean' },
      balance: { type: 'number' },
      role: { type: 'string' },
      address: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          street: { type: 'string' },
          zip: { type: 'string' },
        },
      },
      tags: { type: 'array', items: { type: 'string' } },
      orders: {
        type: 'array',
        items: {
          type: 'object',
          properties: { sku: { type: 'string' }, qty: { type: 'integer' } },
        },
      },
    },
  },
};

const sparseValue = { f0: 'value', f7: 42, f14: true };
const SPARSE = {
  definition: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `f${i}`,
      i % 3 === 0 ? '?string' : i % 3 === 1 ? '?number' : '?boolean',
    ]),
  ),
  options: { sparse: true },
  proto: {
    nested: {
      Sparse: {
        fields: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [
            `f${i}`,
            {
              type: i % 3 === 0 ? 'string' : i % 3 === 1 ? 'int32' : 'bool',
              id: i + 1,
              options: { proto3_optional: true },
            },
          ]),
        ),
        oneofs: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`_f${i}`, { oneof: [`f${i}`] }]),
        ),
      },
    },
  },
  avro: {
    type: 'record',
    name: 'Sparse',
    fields: Array.from({ length: 20 }, (_, i) => ({
      name: `f${i}`,
      type: ['null', i % 3 === 0 ? 'string' : i % 3 === 1 ? 'int' : 'boolean'],
      default: null,
    })),
  },
  json: {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `f${i}`,
        { type: i % 3 === 0 ? 'string' : i % 3 === 1 ? 'integer' : 'boolean' },
      ]),
    ),
  },
};

const typedValue = (i) => ({
  id: i,
  active: rnd() > 0.5,
  verified: rnd() > 0.5,
  role: pick(ROLES),
  status: pick(ROLES),
  createdAt: new Date(1700000000000 + i * 1000),
  level: Math.floor(rnd() * 100),
});
const TYPED = {
  definition: {
    id: 'number',
    active: 'boolean',
    verified: 'boolean',
    role: { enum: ROLES },
    status: { enum: ROLES },
    createdAt: 'date',
    level: 'number',
  },
  proto: {
    nested: {
      Role: { values: { admin: 0, editor: 1, viewer: 2, owner: 3 } },
      Typed: {
        fields: {
          id: { type: 'int32', id: 1 },
          active: { type: 'bool', id: 2 },
          verified: { type: 'bool', id: 3 },
          role: { type: 'Role', id: 4 },
          status: { type: 'Role', id: 5 },
          createdAt: { type: 'int64', id: 6 },
          level: { type: 'int32', id: 7 },
        },
      },
    },
  },
  avro: {
    type: 'record',
    name: 'Typed',
    fields: [
      { name: 'id', type: 'int' },
      { name: 'active', type: 'boolean' },
      { name: 'verified', type: 'boolean' },
      { name: 'role', type: { type: 'enum', name: 'Role', symbols: ROLES } },
      { name: 'status', type: 'Role' },
      { name: 'createdAt', type: 'long' },
      { name: 'level', type: 'int' },
    ],
  },
  json: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      active: { type: 'boolean' },
      verified: { type: 'boolean' },
      role: { type: 'string' },
      status: { type: 'string' },
      createdAt: { type: 'integer' },
      level: { type: 'integer' },
    },
  },
  dates: ['createdAt'],
};

const stringsValue = {
  title: 'Повідомлення про зміну розкладу занять на наступний тиждень',
  body: 'Шановні студенти! У зв’язку з проведенням конференції заняття переносяться. '.repeat(4),
  author: 'Олена Коваленко',
  tags: ['розклад', 'конференція', 'оголошення'],
};
const STRINGS = {
  definition: { title: 'string', body: 'string', author: 'string', tags: { array: 'string' } },
  proto: {
    nested: {
      Strings: {
        fields: {
          title: { type: 'string', id: 1 },
          body: { type: 'string', id: 2 },
          author: { type: 'string', id: 3 },
          tags: { rule: 'repeated', type: 'string', id: 4 },
        },
      },
    },
  },
  avro: {
    type: 'record',
    name: 'Strings',
    fields: [
      { name: 'title', type: 'string' },
      { name: 'body', type: 'string' },
      { name: 'author', type: 'string' },
      { name: 'tags', type: { type: 'array', items: 'string' } },
    ],
  },
  json: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      author: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

const numericValue = Object.fromEntries(
  Array.from({ length: 32 }, (_, i) => [`v${i}`, rnd() * 1000]),
);
const NUMERIC = {
  definition: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`v${i}`, 'number'])),
  proto: {
    nested: {
      Numeric: {
        fields: Object.fromEntries(
          Array.from({ length: 32 }, (_, i) => [`v${i}`, { type: 'double', id: i + 1 }]),
        ),
      },
    },
  },
  avro: {
    type: 'record',
    name: 'Numeric',
    fields: Array.from({ length: 32 }, (_, i) => ({ name: `v${i}`, type: 'double' })),
  },
  json: {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: 32 }, (_, i) => [`v${i}`, { type: 'number' }]),
    ),
  },
};

const users = Array.from({ length: 1000 }, (_, i) => user(i));

const SCENARIOS = [
  {
    name: 'single',
    description: 'one record: 10 fields, nested address, tags, 2 orders',
    value: user(1),
    schema: USER,
    message: 'User',
  },
  {
    name: 'records',
    description: '1000 records of the same shape',
    value: users,
    schema: USER,
    message: 'User',
    list: true,
  },
  {
    name: 'sparse',
    description: '20 optional fields, 3 present',
    value: sparseValue,
    schema: SPARSE,
    message: 'Sparse',
  },
  {
    name: 'typed',
    description: 'enum, boolean and date heavy record',
    value: typedValue(1),
    schema: TYPED,
    message: 'Typed',
  },
  {
    name: 'strings',
    description: 'long Cyrillic strings',
    value: stringsValue,
    schema: STRINGS,
    message: 'Strings',
  },
  {
    name: 'numeric',
    description: '32 doubles (where binary formats shine)',
    value: numericValue,
    schema: NUMERIC,
    message: 'Numeric',
  },
];

module.exports = { SCENARIOS };
