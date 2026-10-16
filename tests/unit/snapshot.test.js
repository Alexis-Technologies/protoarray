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

test('Snapshot: names and values that read as the form around them print quoted', () => {
  const { SchemaRegistry } = require('../../registry.js');
  const SIGNATURE = Symbol.for('alexify.protoarray.signature');
  const of = (fields) => new Schema({ format: 1, root: 'R', entities: { R: { fields } } });
  const field = (type, more) => ({ type, required: true, ...more });
  const pairs = [
    [{ 'a:string,b': field('number') }, { a: field('string'), b: field('number') }],
    [{ e: field('enum', { enum: ['x|y'] }) }, { e: field('enum', { enum: ['x', 'y'] }) }],
    [{ e: field('enum', { enum: ['1', '2'] }) }, { e: field('enum', { enum: [1, 2] }) }],
    [{ f: field('flags', { flags: ['a|b'] }) }, { f: field('flags', { flags: ['a', 'b'] }) }],
    [{ 'k?': field('string') }, { k: field('string', { required: false }) }],
    [{ '"a"': field('string') }, { a: field('string') }],
  ];
  for (const [first, second] of pairs) {
    const a = of(first);
    const b = of(second);
    assert.notStrictEqual(a.toString(), b.toString());
    assert.notStrictEqual(a.id, b.id);
    // What resolve and the registry tell versions apart by.
    assert.notStrictEqual(a[SIGNATURE], b[SIGNATURE]);
    assert.strictEqual(new SchemaRegistry([a, b]).size, 2);
  }
  assert.strictEqual(of(pairs[0][0]).toString(), '{"a:string,b":number}');
  assert.strictEqual(of(pairs[1][0]).toString(), '{e:enum("x|y")}');
  assert.strictEqual(of(pairs[2][0]).toString(), '{e:enum("1"|"2")}');
  assert.strictEqual(of(pairs[2][1]).toString(), '{e:enum(1|2)}');
  // A union's discriminator and an entity's name, in the form and the signature.
  const union = new Schema({
    format: 1,
    root: 'U',
    entities: {
      U: {
        type: field('union', {
          discriminator: 'k:v',
          union: [field('schema', { schema: { 'k:v': field('enum', { enum: ['a'] }) } })],
        }),
      },
    },
  });
  assert.strictEqual(union.toString(), 'union("k:v")[{"k:v":enum(a)}]');
  const linked = new Schema({
    format: 1,
    root: 'R',
    entities: {
      R: { fields: { t: field('T;x', { one: 'T;x' }) } },
      'T;x': { fields: { n: field('number') } },
    },
  });
  assert.strictEqual(linked.toString(), '{t:@"T;x"}');
  assert.strictEqual(linked[SIGNATURE], '{t:@"T;x"};"T;x"={n:number}');
  const { fingerprint } = require('../../src/plan.js');
  assert.strictEqual(linked.id, fingerprint(linked[SIGNATURE]));
});

test('Snapshot: every form of golden-1x is held to', () => {
  // A vector renamed or dropped would leave its 1.x form untested.
  const names = new Set(VECTORS.map((vector) => vector.name));
  for (const name of Object.keys(GOLDEN.vectors)) assert.ok(names.has(name), name);
  assert.strictEqual(Object.keys(GOLDEN.seeds).length, 120);
});
