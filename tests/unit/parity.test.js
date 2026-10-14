const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, DecodeError } = require('../../index.js');
const { normalize } = require('../support/backends.js');
const { generate } = require('../support/generate.js');

const SEEDS = 120;
const GARBAGE = ['oops', 1.5, [], {}, null, true, -1];

const outcome = (fn) => {
  try {
    return { value: normalize(fn()) };
  } catch (error) {
    if (!(error instanceof DecodeError)) return { name: error.name, message: error.message };
    return { code: error.code, path: error.path, message: error.message };
  }
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
