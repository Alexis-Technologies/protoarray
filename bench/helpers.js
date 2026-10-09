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
  if (!quiet) console.log(`${name.padEnd(52)} ${ops} ops/sec`);
  return { name, opsPerSec };
};

// The same payloads in both shapes: a keyed object, as JSON sends it, and the
// positional array protoarray will send for it (values in schema order, keys
// left to the schema both sides share).
const FLAT_OBJECT = { name: 'Alex', age: 27, email: 'alex@example.com', active: true };
const FLAT_ARRAY = ['Alex', 27, 'alex@example.com', true];

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
const NESTED_ARRAY = [
  1024,
  ['Alex', 'Dolid'],
  ['Kyiv', 'Khreshchatyk', '1'],
  ['admin', 'editor'],
  [
    ['A-1', 2, 9.99],
    ['B-7', 1, 24.5],
  ],
];

module.exports = { bench, FLAT_OBJECT, FLAT_ARRAY, NESTED_OBJECT, NESTED_ARRAY };
