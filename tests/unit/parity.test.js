const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, DecodeError, EncodeError } = require('../../index.js');
const { normalize } = require('../support/backends.js');
const { generate } = require('../support/generate.js');

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

// Both backends must be indistinguishable on random schemas: same wire, same
// objects in the same key order, same errors with the same paths, and a wire
// that encodes the decoded value back to itself.
test('Parity: codegen and closures agree on generated schemas and values', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, value, random } = generate(seed);
    const extras = [
      {},
      { sparse: true },
      { validate: false },
      { validate: 'both' },
      { intern: true },
    ];
    for (const extra of extras) {
      const label = `seed ${seed} ${JSON.stringify(extra)}`;
      const A = Schema.from(definition, { codegen: true, ...extra });
      const B = Schema.from(definition, { codegen: false, ...extra });
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
        assert.deepStrictEqual(
          outcome(() => A.check(bad)),
          outcome(() => B.check(bad)),
          `${label} check ${round}`,
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
    const rows = [
      Schema.from(definition, { codegen: true }).list,
      Schema.from(definition, { codegen: false }).list,
    ];
    assert.deepStrictEqual(
      normalize(rows[0].encode(list)),
      normalize(rows[1].encode(list)),
      `seed ${seed} rows`,
    );
    for (const layout of ['flat', 'columns']) {
      const F = Schema.from({ array: definition }, { codegen: true, layout });
      const G = Schema.from({ array: definition }, { codegen: false, layout });
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

// A reader version of a generated definition: fields renamed (through the
// `aliases` option), dropped when optional, shuffled, and a new optional one.
const mutate = (definition, random) => {
  const reader = [];
  const aliases = {};
  const renamed = {};
  for (const rawKey of Object.keys(definition)) {
    const key = rawKey.replace('?', '');
    const optional = rawKey !== key || String(definition[rawKey]).startsWith('?');
    const roll = random();
    if (roll < 0.15 && optional) continue;
    const name = roll < 0.4 ? `${key}_renamed` : key;
    if (name !== key) aliases[name] = key;
    renamed[name] = key;
    reader.push([rawKey === key ? name : `${name}?`, definition[rawKey]]);
  }
  for (let i = reader.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [reader[i], reader[j]] = [reader[j], reader[i]];
  }
  reader.push(['added?', 'string']);
  return { reader: Object.fromEntries(reader), aliases, renamed };
};

test('Parity: codegen and closures agree on resolved schemas', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, value, random } = generate(seed);
    const { reader, aliases, renamed } = mutate(definition, random);
    for (const extra of [{}, { sparse: true }, { validate: 'both' }]) {
      const label = `seed ${seed} ${JSON.stringify(extra)}`;
      const sides = [true, false].map((codegen) => {
        const writer = Schema.from(definition, { codegen, ...extra });
        const { sparse, ...rest } = extra;
        const read = Schema.from(reader, { codegen, ...rest });
        return { writer, resolved: Schema.resolve(writer, read, { aliases }) };
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
