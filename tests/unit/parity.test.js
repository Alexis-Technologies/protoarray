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

// Both backends must be indistinguishable on random schemas: same wire, same
// objects in the same key order, same errors with the same paths, and a wire
// that encodes the decoded value back to itself.
test('Parity: codegen and closures agree on generated schemas and values', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, value, random } = generate(seed);
    for (const extra of [{}, { sparse: true }, { validate: false }]) {
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
      }
      for (let round = 0; round < 4; round++) {
        const broken = JSON.parse(JSON.stringify(wire));
        const index = Math.floor(random() * (broken.length + 1));
        broken[index] = GARBAGE[Math.floor(random() * GARBAGE.length)];
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
