// Seeded random definitions and matching values for the parity suite: wide
// enough to reach every node kind, every optionality and nesting.
const SCALARS = [
  'string',
  'number',
  'boolean',
  'json',
  'date',
  'bigint',
  'bytes',
  'integer',
  'any',
  'null',
];
// More names than two 31-bit words hold.
const WIDE_FLAGS = Array.from({ length: 70 }, (_, i) => `n${i}`);
const DECIMALS = [0, 2, 6, 15];
// Sizes around the segment boundaries, besides a random spread.
const WIDE_SIZES = [31, 32, 33, 61, 62, 63, 64];
const STRINGS = [
  '',
  'a',
  'Олена',
  'with "quotes"',
  'new\nline',
  String.fromCharCode(0x2028),
  'x'.repeat(50),
];

// A linear congruential generator over 31 bits; Math.imul keeps the product exact.
const prng = (seed) => () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const pick = (random, list) => list[Math.floor(random() * list.length)];

const fieldType = (random, depth) => {
  const roll = random();
  if (depth > 0 && roll < 0.15) return struct(random, depth - 1);
  if (depth > 0 && roll < 0.3) return { array: fieldType(random, depth - 1) };
  if (roll < 0.38) return { enum: ['a', 'b', 'c'] };
  if (roll < 0.46) return random() < 0.25 ? { flags: WIDE_FLAGS } : { flags: ['x', 'y', 'z'] };
  if (roll < 0.5) return ['number', '?string'];
  if (depth > 0 && roll < 0.56) return union(random, depth - 1);
  if (roll < 0.6) return { type: 'number', default: 7 };
  if (roll < 0.64) return { type: 'number', decimals: pick(random, DECIMALS) };
  if (depth > 0 && roll < 0.67) return { set: fieldType(random, depth - 1) };
  if (depth > 0 && roll < 0.7) {
    const key = random() < 0.7 ? 'string' : 'number';
    return { map: { [key]: fieldType(random, depth - 1) } };
  }
  if (depth > 0 && roll < 0.73) return { object: { string: fieldType(random, depth - 1) } };
  if (depth > 0 && roll < 0.76) {
    return [{ at: 'date' }, struct(random, depth - 1), { 'z?': 'integer' }];
  }
  if (roll < 0.78) return { type: pick(random, ['integer', 'date']), delta: true };
  if (roll < 0.8) return { array: pick(random, ['integer', '?date']), delta: true };
  if (roll < 0.82) return { type: 'string', intern: true, required: random() < 0.5 };
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

// One to three branches, each a struct with the discriminator `k` at a random
// position; values are strings or numbers, unique across the branches.
const union = (random, depth) => {
  const count = 1 + Math.floor(random() * 3);
  const numeric = random() < 0.3;
  let next = 0;
  const branches = [];
  for (let b = 0; b < count; b++) {
    const values = [];
    const size = 1 + Math.floor(random() * 2);
    for (let i = 0; i < size; i++) values.push(numeric ? next++ : `v${next++}`);
    const entries = Object.entries(struct(random, depth));
    entries.splice(Math.floor(random() * (entries.length + 1)), 0, ['k', { enum: values }]);
    branches.push(Object.fromEntries(entries));
  }
  return { union: branches, discriminator: 'k' };
};

const scalarValue = (random, type) => {
  if (type === 'string') return pick(random, STRINGS);
  if (type === 'integer') return Math.floor(random() * 2e6) - 1e6;
  if (type === 'null') return null;
  if (type === 'number') return random() < 0.5 ? Math.floor(random() * 1e6) : random() * 100;
  if (type === 'boolean') return random() < 0.5;
  if (type === 'date') return new Date(Math.floor(random() * 2e12));
  if (type === 'bigint') return BigInt(Math.floor(random() * 1e15)) * 1000n;
  if (type === 'bytes') {
    return Uint8Array.from({ length: Math.floor(random() * 6) }, () => Math.floor(random() * 256));
  }
  return pick(random, [null, 1, 'json', [1, { a: 2 }], { nested: [true] }]);
};

// A number whose scaled form stays a safe integer, whatever the scale.
const decimalValue = (random, decimals) => {
  const whole = Math.floor(random() * Math.min(1000, 10 ** (15 - decimals) / 2));
  const fraction = Math.floor(random() * 10 ** decimals) / 10 ** decimals;
  const value = whole + fraction;
  return random() < 0.3 ? -value : value;
};

// A tuple element: a named one (`{ x: 'number' }`, `{ 'z?': … }`) or a definition.
const elementValue = (random, element) => {
  const keys = Object.keys(element);
  const named = keys.length === 1 && typeof element[keys[0]] === 'string';
  if (!named) return valueFor(random, element);
  return keys[0].endsWith('?') && random() < 0.5 ? null : valueFor(random, element[keys[0]]);
};

const size = (random) => Math.floor(random() * 4);

const valueFor = (random, type) => {
  if (typeof type === 'string') return scalarValue(random, type.replace('?', ''));
  if (Array.isArray(type)) {
    if (typeof type[0] === 'string') return random() < 0.5 ? [1, 's'] : [2];
    return type.map((element) => elementValue(random, element));
  }
  if (type.set) {
    return new Set(Array.from({ length: size(random) }, () => valueFor(random, type.set)));
  }
  if (type.map) {
    const numeric = type.map.number !== undefined;
    const item = numeric ? type.map.number : type.map.string;
    const entries = Array.from({ length: size(random) }, (_, i) => [
      numeric ? i * 3 : `k${i}`,
      valueFor(random, item),
    ]);
    return new Map(entries);
  }
  if (type.object) {
    const entries = Array.from({ length: size(random) }, (_, i) => [
      i === 1 ? '__proto__' : `k${i}`,
      valueFor(random, type.object.string),
    ]);
    const object = {};
    for (const [key, value] of entries) {
      Object.defineProperty(object, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return object;
  }
  if (type.enum) return pick(random, type.enum);
  if (type.union) return record(random, pick(random, type.union));
  if (type.flags === WIDE_FLAGS) {
    return { n1: random() < 0.5, n35: random() < 0.5, n69: random() < 0.5 };
  }
  if (type.flags) return { x: random() < 0.5, z: random() < 0.5 };
  if (type.decimals !== undefined) return decimalValue(random, type.decimals);
  if (type.delta && type.array) {
    return Array.from({ length: size(random) }, () =>
      scalarValue(random, type.array.replace('?', '')),
    );
  }
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

// A record of 31 to 70 fields, mostly optional: a sparse one takes several
// segments, and the sizes at the boundaries come up often.
const wide = (random) => {
  const count = random() < 0.4 ? pick(random, WIDE_SIZES) : 32 + Math.floor(random() * 39);
  const definition = {};
  for (let i = 0; i < count; i++) {
    definition[random() < 0.7 ? `f${i}?` : `f${i}`] = fieldType(random, 1);
  }
  return definition;
};

const generate = (seed) => {
  const random = prng(seed);
  const definition = seed % 5 === 0 ? wide(random) : struct(random, 2);
  return { definition, value: record(random, definition), random };
};

module.exports = { generate, prng };
