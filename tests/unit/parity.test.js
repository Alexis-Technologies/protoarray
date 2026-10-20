const { test } = require('node:test');
const assert = require('node:assert');
const { DecodeError, EncodeError } = require('../../index.js');
const { resolve } = require('../../resolve.js');
const { normalize } = require('../support/backends.js');
const { generate } = require('../support/generate.js');
const { mutate, rename } = require('../support/mutate.js');
const { define } = require('../support/schema.js');

const SEEDS = 120;
const GARBAGE = ['oops', 1.5, [], {}, null, true, -1];
const BAD_VALUES = [...GARBAGE, undefined, NaN, new Date(NaN), 1n, 'b', [null]];

const outcome = (fn) => {
  try {
    return { value: normalize(fn()) };
  } catch (error) {
    if (!(error instanceof DecodeError || error instanceof EncodeError)) {
      return { name: error.name, message: error.message };
    }
    return { name: error.name, code: error.code, path: error.path, message: error.message };
  }
};

// A copy of the value with one slot, at any depth, replaced by garbage.
const corrupt = (value, random) => {
  const copy = Array.isArray(value) ? value.slice() : { ...value };
  const keys = Object.keys(copy);
  if (keys.length === 0) return copy;
  const key = keys[Math.floor(random() * keys.length)];
  const inner = copy[key];
  const deeper = inner !== null && typeof inner === 'object' && !(inner instanceof Date);
  if (deeper && random() < 0.5) copy[key] = corrupt(inner, random);
  else copy[key] = BAD_VALUES[Math.floor(random() * BAD_VALUES.length)];
  return copy;
};

// A copy of the wire with one element, at any depth, replaced by garbage or
// one appended: a corrupted tag, mask, segment or nested record.
const corruptWire = (wire, random) => {
  const copy = wire.slice();
  const index = Math.floor(random() * (copy.length + 1));
  const inner = copy[index];
  if (Array.isArray(inner) && random() < 0.6) copy[index] = corruptWire(inner, random);
  else copy[index] = GARBAGE[Math.floor(random() * GARBAGE.length)];
  return copy;
};

// The options by path of a record, for a collection of such records.
const within = (options) => {
  const out = {};
  for (const key of Object.keys(options)) out[key] = options[key].map((path) => `[].${path}`);
  return out;
};

// Both backends must be indistinguishable on random schemas: same wire, same
// objects in the same key order, same errors with the same paths, and a wire
// that encodes the decoded value back to itself. The values given to encode
// are trusted, so a corrupted one is written as it is or refused for its
// shape (an object, an array, a union's discriminator, a list of differences)
// by both alike.
test('Parity: codegen and closures agree on generated schemas and values', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, options, value, random } = generate(seed);
    const extras = [
      {},
      { sparse: true },
      { validate: false },
      { intern: true },
      // The builder on any schema, where `auto` keeps it for converted types.
      { stringify: 'builder' },
      { stringify: 'builder', validate: false, sparse: true },
    ];
    for (const extra of extras) {
      const label = `seed ${seed} ${JSON.stringify(extra)}`;
      const A = define(definition, { ...options, codegen: true, ...extra });
      const B = define(definition, { ...options, codegen: false, ...extra });
      assert.strictEqual(A.id, B.id, label);
      const wire = A.encode(value);
      assert.deepStrictEqual(normalize(wire), normalize(B.encode(value)), label);
      assert.strictEqual(A.stringify(value), B.stringify(value), label);
      const decoded = A.decode(wire);
      assert.deepStrictEqual(normalize(decoded), normalize(B.decode(wire)), label);
      assert.deepStrictEqual(Object.keys(decoded), Object.keys(B.decode(wire)), label);
      assert.deepStrictEqual(Object.keys(decoded), A.keys, label);
      assert.deepStrictEqual(normalize(A.decode(A.encode(decoded))), normalize(decoded), label);
      assert.deepStrictEqual(
        normalize(A.parse(A.stringify(value))),
        normalize(B.parse(B.stringify(value))),
        label,
      );
      for (let round = 0; round < 4; round++) {
        const bad = corrupt(value, random);
        assert.deepStrictEqual(
          outcome(() => A.encode(bad)),
          outcome(() => B.encode(bad)),
          `${label} encode ${round}`,
        );
        // The text codegen builds is the text of the wire, errors included.
        assert.deepStrictEqual(
          outcome(() => A.stringify(bad)),
          outcome(() => B.stringify(bad)),
          `${label} stringify ${round}`,
        );
      }
      for (let round = 0; round < 4; round++) {
        const broken = corruptWire(JSON.parse(JSON.stringify(wire)), random);
        for (const strict of [false, true]) {
          const a = outcome(() => A.decode(broken, { strict }));
          const b = outcome(() => B.decode(broken, { strict }));
          assert.deepStrictEqual(
            a,
            b,
            `${label} broken ${JSON.stringify(broken)} strict ${strict}`,
          );
        }
      }
    }
    const list = [value, value];
    // Collections, around the length where the builder hands over to JSON.stringify.
    for (const count of [0, 1, 64, 65]) {
      const many = Array.from({ length: count }, () => value);
      const C = define(definition, { ...options, codegen: true, stringify: 'builder' }).list;
      assert.strictEqual(
        C.stringify(many),
        JSON.stringify(C.encode(many)),
        `seed ${seed} ${count}`,
      );
    }
    const rows = [
      define(definition, { ...options, codegen: true }).list,
      define(definition, { ...options, codegen: false }).list,
    ];
    assert.deepStrictEqual(
      normalize(rows[0].encode(list)),
      normalize(rows[1].encode(list)),
      `seed ${seed} rows`,
    );
    for (const layout of ['flat', 'columns']) {
      const F = define({ array: definition }, { ...within(options), codegen: true, layout });
      const G = define({ array: definition }, { ...within(options), codegen: false, layout });
      const wire = F.encode(list);
      assert.deepStrictEqual(normalize(wire), normalize(G.encode(list)), `seed ${seed} ${layout}`);
      assert.deepStrictEqual(
        normalize(F.decode(wire)),
        normalize(G.decode(wire)),
        `seed ${seed} ${layout}`,
      );
      assert.deepStrictEqual(
        normalize(F.decode(wire)),
        normalize(rows[0].decode(rows[0].encode(list))),
        `seed ${seed} ${layout}`,
      );
    }
  }
});

// The reader version of each generated definition is mutate.js's: renamed,
// dropped, shuffled and extended.
test('Parity: codegen and closures agree on resolved schemas', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, options, value, random } = generate(seed);
    const { reader, aliases, renamed } = mutate(definition, random);
    const readerOptions = rename(options, renamed);
    for (const extra of [{}, { sparse: true }, { validate: false }]) {
      const label = `seed ${seed} ${JSON.stringify(extra)}`;
      const sides = [true, false].map((codegen) => {
        const writer = define(definition, { ...options, codegen, ...extra });
        const { sparse, ...rest } = extra;
        const read = define(reader, { ...readerOptions, codegen, ...rest });
        return { writer, resolved: resolve(writer, read, { aliases }) };
      });
      const [A, B] = sides.map((side) => side.resolved);
      const W = sides[0].writer;
      assert.strictEqual(A.id, W.id, label);
      const wire = W.encode(value);
      const decoded = A.decode(wire);
      assert.deepStrictEqual(normalize(decoded), normalize(B.decode(wire)), label);
      assert.deepStrictEqual(Object.keys(decoded), A.keys, label);
      // Every reader field holds what the writer decodes for its source field.
      const written = normalize(W.decode(wire));
      for (const key of A.keys) {
        const expected = key === 'added' ? null : written[renamed[key]];
        assert.deepStrictEqual(normalize(decoded[key]), expected, `${label} ${key}`);
      }
      assert.deepStrictEqual(
        outcome(() => A.encode(decoded)),
        outcome(() => B.encode(decoded)),
        label,
      );
      for (let round = 0; round < 4; round++) {
        const bad = corrupt(decoded, random);
        assert.deepStrictEqual(
          outcome(() => A.encode(bad)),
          outcome(() => B.encode(bad)),
          label,
        );
        const broken = corruptWire(JSON.parse(JSON.stringify(wire)), random);
        for (const strict of [false, true]) {
          assert.deepStrictEqual(
            outcome(() => A.decode(broken, { strict })),
            outcome(() => B.decode(broken, { strict })),
            `${label} broken ${JSON.stringify(broken)}`,
          );
        }
      }
    }
  }
});

// What the random definitions do not draw, built by hand: keys that hold a
// path's punctuation, dictionaries whose keys the payload gives, a recursion
// between entities with interned strings, aliases, a recursion near its
// depth limit and values that claim a kind they do not have. The generator is
// left as it is: golden-1x holds the forms of its seeds.
test('Parity: codegen and closures agree on the constructs the generator does not draw', () => {
  const { prng } = require('../support/generate.js');
  const { model } = require('../support/schema.js');
  const random = prng(2026);
  const fake = (tag) => ({ [Symbol.toStringTag]: tag, valueOf: () => 1 });
  const nested = (depth) => {
    let node = { name: 'leaf', next: null };
    for (let i = 1; i < depth; i++) node = { name: `n${i % 3}`, next: node };
    return node;
  };
  const cases = [
    {
      build: (options) =>
        define(
          {
            'a.b': { 'c[]': 'number', '"q': '?string' },
            '{x}': '?string',
            d: { type: 'object', key: 'string', value: { n: 'number' } },
            m: { type: 'map', key: 'string', value: 'date', required: false },
            s: { set: 'integer', required: false },
            at: { type: 'date', required: false },
          },
          options,
        ),
      values: [
        { 'a.b': { 'c[]': 1, '"q': 'x' }, '{x}': 'e', d: { 'x.y': { n: 1 }, '': { n: 2 } } },
        { 'a.b': { 'c[]': 2 }, d: { 'line\nbreak': { n: 3 } }, m: new Map([['k', new Date(5)]]) },
        { 'a.b': { 'c[]': 3 }, d: {}, m: fake('Map'), s: fake('Set'), at: fake('Date') },
        { 'a.b': { 'c[]': 4 }, d: {}, at: 1n, s: new Set([1, 2]) },
      ],
    },
    {
      build: (options) =>
        model(
          {
            A: { Struct: {}, s: 'string', b: '?B' },
            B: { Struct: {}, n: 'number', a: '?A' },
          },
          { ...options, entities: { A: { intern: ['s'] } } },
        ).B,
      values: [
        { n: 1, a: { s: 'x', b: { n: 2, a: { s: 'x', b: null } } } },
        { n: 3, a: null },
      ],
    },
    {
      build: (options) =>
        model(
          {
            Point: { Struct: {}, x: 'number', 'y?': 'number' },
            Spot: 'Point',
            Holder: { Struct: {}, p: 'Spot', ps: { array: 'Spot' } },
          },
          options,
        ).Holder,
      values: [{ p: { x: 1 }, ps: [{ x: 2, y: 3 }] }],
    },
    {
      build: (options) =>
        model(
          { Node: { Struct: {}, name: 'string', next: '?Node' } },
          { ...options, maxDepth: 512 },
        ).Node,
      values: [nested(3), nested(511), nested(512), nested(513)],
    },
  ];
  for (const { build, values } of cases) {
    const codegen = build({ codegen: true });
    const closures = build({ codegen: false });
    assert.strictEqual(codegen.toString(), closures.toString());
    assert.strictEqual(codegen.id, closures.id);
    for (const value of values) {
      const wire = outcome(() => codegen.encode(value));
      assert.deepStrictEqual(
        outcome(() => closures.encode(value)),
        wire,
        codegen.toString(),
      );
      assert.deepStrictEqual(
        outcome(() => closures.stringify(value)),
        outcome(() => codegen.stringify(value)),
      );
      if (wire.value === undefined) continue;
      const text = JSON.stringify(codegen.encode(value));
      assert.deepStrictEqual(
        outcome(() => closures.parse(text)),
        outcome(() => codegen.parse(text)),
      );
      for (let round = 0; round < 30; round++) {
        const broken = corruptWire(JSON.parse(text), random);
        assert.deepStrictEqual(
          outcome(() => closures.decode(broken)),
          outcome(() => codegen.decode(broken)),
          JSON.stringify(broken).slice(0, 200),
        );
      }
    }
  }
});
