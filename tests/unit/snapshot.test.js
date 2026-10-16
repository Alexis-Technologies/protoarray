const test = require('node:test');
const assert = require('node:assert');
const definition = require('@alexify/metaschema/definition');
const { Schema } = require('../../index.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { VECTORS } = require('../support/vectors.js');
const { generate } = require('../support/generate.js');
const { define, model } = require('../support/schema.js');
const GOLDEN = require('../fixtures/golden-1x.json');

// The canonical forms, ids and texts protoarray 1.x gave for the same shapes,
// read from its own definition DSL before 2.0 replaced it with metaschema's
// snapshots: the wire contract did not move.
for (const [backendName, backend] of BACKENDS) {
  test(`Snapshot: every vector prints as 1.x printed it (${backendName})`, () => {
    for (const vector of VECTORS) {
      const expected = GOLDEN.vectors[vector.name];
      if (expected === undefined) continue;
      const schema = define(vector.definition, { ...vector.options, ...backend });
      assert.strictEqual(schema.toString(), expected, vector.name);
    }
  });

  test(`Snapshot: random schemas keep the 1.x forms, ids and texts (${backendName})`, () => {
    for (let seed = 1; seed <= 120; seed++) {
      const { definition: shape, options, value } = generate(seed);
      const schema = define(shape, { ...options, ...backend });
      const expected = GOLDEN.seeds[seed];
      assert.strictEqual(schema.toString(), expected.canonical, `seed ${seed}`);
      assert.strictEqual(schema.id, expected.id, `seed ${seed}`);
      assert.strictEqual(schema.stringify(value), expected.text, `seed ${seed}`);
    }
  });

  test(`Snapshot: a snapshot read from its JSON text is the same schema (${backendName})`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { definition: shape, options, value } = generate(seed);
      const schema = define(shape, { ...options, ...backend });
      const text = JSON.stringify(schema.snapshot);
      const copy = new Schema(JSON.parse(text), { ...options, ...backend });
      assert.strictEqual(copy.toString(), schema.toString(), `seed ${seed}`);
      assert.strictEqual(copy.source, null);
      const wire = schema.encode(value);
      assert.deepStrictEqual(copy.encode(value), wire, `seed ${seed}`);
      assert.deepStrictEqual(normalize(copy.decode(wire)), normalize(schema.decode(wire)));
    }
  });
}

test('Snapshot: a stored kind adds the id field of its entity', () => {
  const schema = define({ Entity: {}, a: 'number' });
  assert.strictEqual(schema.toString(), '{a:number,id:?string}');
  assert.deepStrictEqual(schema.encode({ a: 1 }), [1]);
  const { Order } = model({ Order: { Entity: {}, sku: 'string' } });
  assert.strictEqual(Order.toString(), '{sku:string,orderId:?string}');
});

test('Snapshot: metaschema without its validation half is enough', () => {
  const User = new definition.Schema('User', { id: 'integer', name: '?string', boss: '?User' });
  const schema = Schema.from(User);
  assert.strictEqual(schema.name, 'User');
  assert.strictEqual(schema.source, User);
  assert.strictEqual(schema.toString(), '{id:integer,name:?string,boss:?@User}');
  const wire = schema.encode({ id: 1, boss: { id: 2 } });
  assert.deepStrictEqual(wire, [1, null, [2]]);
  assert.deepStrictEqual(Schema.from({ a: 'date' }, { metaschema: definition }).decode([5]), {
    a: new Date(5),
  });
});
