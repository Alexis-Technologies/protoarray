const { performance } = require('node:perf_hooks');

const WARMUP_ITERATIONS = 2_000;
const MEASURE_MS = 1_000;

const bench = (name, fn, options = {}) => {
  const { warmup = WARMUP_ITERATIONS, measureMs = MEASURE_MS, quiet = false } = options;
  for (let i = 0; i < warmup; i++) fn();
  let iterations = 0;
  const start = performance.now();
  while (performance.now() - start < measureMs) {
    fn();
    iterations++;
  }
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const ops = opsPerSec.toLocaleString('en-US').padStart(12);
  if (!quiet) console.log(`${name.padEnd(60)} ${ops} ops/sec`);
  return { name, opsPerSec };
};

const FLAT_OBJECT = { name: 'Alex', age: 27, email: 'alex@example.com', active: true };

const NESTED_OBJECT = {
  id: 1024,
  name: { first: 'Alex', last: 'Dolid' },
  address: { city: 'Kyiv', street: 'Khreshchatyk', building: '1' },
  tags: ['admin', 'editor'],
  orders: [
    { sku: 'A-1', quantity: 2, price: 9.99 },
    { sku: 'B-7', quantity: 1, price: 24.5 },
  ],
};

const SPARSE_OBJECT = { field0: 'value', field7: 42, field15: true };

const TYPED_OBJECT = {
  id: 7,
  active: true,
  verified: false,
  role: 'editor',
  status: 'active',
  createdAt: new Date(1700000000000),
  perms: { read: true, admin: true },
};

const rnd = (
  (seed) => () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
)(42);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const CITIES = ['Kyiv', 'Lviv', 'Odesa', 'Kharkiv', 'Dnipro'];
const ROLES = ['admin', 'editor', 'viewer', 'owner'];

const RECORDS = Array.from({ length: 1000 }, (_, i) => ({
  id: 100000 + i,
  name: `User ${i} ${pick(['Alex', 'Olena', 'Taras', 'Maria'])}`,
  email: `user${i}@example.com`,
  age: 18 + Math.floor(rnd() * 60),
  active: rnd() > 0.3,
  balance: Math.round(rnd() * 1e6) / 100,
  role: pick(ROLES),
  createdAt: 1700000000000 + Math.floor(rnd() * 1e9),
  address: { city: pick(CITIES), street: `Street ${Math.floor(rnd() * 200)}`, zip: `0${1000 + i}` },
  tags: [pick(ROLES), pick(CITIES)],
}));

module.exports = { bench, FLAT_OBJECT, NESTED_OBJECT, SPARSE_OBJECT, TYPED_OBJECT, RECORDS };
