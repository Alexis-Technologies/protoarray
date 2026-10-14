// Seeded random definitions and matching values for the parity suite: wide
// enough to reach every node kind, every optionality and nesting.
const SCALARS = ['string', 'number', 'boolean', 'json', 'date', 'bigint'];
const STRINGS = [
  '',
  'a',
  'Олена',
  'with "quotes"',
  'new\nline',
  String.fromCharCode(0x2028),
  'x'.repeat(50),
];

const prng = (seed) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const pick = (random, list) => list[Math.floor(random() * list.length)];

const fieldType = (random, depth) => {
  const roll = random();
  if (depth > 0 && roll < 0.15) return struct(random, depth - 1);
  if (depth > 0 && roll < 0.3) return { array: fieldType(random, depth - 1) };
  if (roll < 0.38) return { enum: ['a', 'b', 'c'] };
  if (roll < 0.46) return { flags: ['x', 'y', 'z'] };
  if (roll < 0.54) return ['number', '?string'];
  if (roll < 0.6) return { type: 'number', default: 7 };
  const scalar = pick(random, SCALARS);
  return random() < 0.3 ? `?${scalar}` : scalar;
};

const struct = (random, depth) => {
  const count = 1 + Math.floor(random() * 5);
  const definition = {};
  for (let i = 0; i < count; i++) {
    const key = random() < 0.3 ? `f${i}?` : `f${i}`;
    definition[key] = fieldType(random, depth);
  }
  return definition;
};

const scalarValue = (random, type) => {
  if (type === 'string') return pick(random, STRINGS);
  if (type === 'number') return random() < 0.5 ? Math.floor(random() * 1e6) : random() * 100;
  if (type === 'boolean') return random() < 0.5;
  if (type === 'date') return new Date(Math.floor(random() * 2e12));
  if (type === 'bigint') return BigInt(Math.floor(random() * 1e15)) * 1000n;
  return pick(random, [null, 1, 'json', [1, { a: 2 }], { nested: [true] }]);
};

const valueFor = (random, type) => {
  if (typeof type === 'string') return scalarValue(random, type.replace('?', ''));
  if (Array.isArray(type)) return random() < 0.5 ? [1, 's'] : [2];
  if (type.enum) return pick(random, type.enum);
  if (type.flags) return { x: random() < 0.5, z: random() < 0.5 };
  if (type.type) return scalarValue(random, type.type);
  if (type.array) {
    const count = Math.floor(random() * 4);
    const list = [];
    for (let i = 0; i < count; i++) list.push(valueFor(random, type.array));
    return list;
  }
  return record(random, type);
};

const record = (random, definition) => {
  const value = {};
  for (const key of Object.keys(definition)) {
    const optional = key.endsWith('?') || String(definition[key]).startsWith('?');
    if (optional && random() < 0.4) continue;
    value[key.replace('?', '')] = valueFor(random, definition[key]);
  }
  return value;
};

const generate = (seed) => {
  const random = prng(seed);
  const definition = struct(random, 2);
  return { definition, value: record(random, definition), random };
};

module.exports = { generate, prng };
