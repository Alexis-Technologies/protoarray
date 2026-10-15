const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, DecodeError } = require('../../index.js');
const { SchemaRegistry } = require('../../registry.js');

const V1 = new Schema('User', { id: 'number', fullName: 'string' });
const V2 = new Schema('User', {
  id: 'number',
  name: { type: 'string', aliases: ['fullName'] },
  email: '?string',
});

test('Registry: schemas by id and by name', () => {
  const registry = new SchemaRegistry([V1]);
  assert.strictEqual(registry.add(V2), registry);
  assert.strictEqual(registry.size, 2);
  assert.strictEqual(registry.get(V1.id), V1);
  assert.strictEqual(registry.has(V2.id), true);
  assert.strictEqual(registry.has('nope'), false);
  assert.strictEqual(registry.get('nope'), undefined);
  // The latest version added under a name is the one found by it.
  assert.strictEqual(registry.find('User'), V2);
  assert.strictEqual(registry.find('Other'), undefined);
  assert.deepStrictEqual([...registry], [V1, V2]);
  // The same schema again, or another copy of it, changes nothing.
  registry.add(V1).add(Schema.from(V1.definition));
  assert.strictEqual(registry.size, 2);
  assert.strictEqual(registry.get(V1.id), V1);
  assert.strictEqual(new SchemaRegistry().size, 0);
  assert.strictEqual(new SchemaRegistry(null).size, 0);
  assert.throws(() => registry.add({}), { code: 'ERR_SCHEMA_EXPECTED' });
});

test('Registry: a narrow fingerprint is a collision, not a silent mix-up', () => {
  const narrow = () => 'x';
  const A = new Schema('A', { a: 'number' }, { fingerprint: narrow });
  const B = new Schema('B', { b: 'string' }, { fingerprint: narrow });
  const registry = new SchemaRegistry([A]);
  assert.throws(() => registry.add(B), {
    name: 'SchemaDefinitionError',
    code: 'ERR_ID_COLLISION',
    schema: 'B',
    message: 'Schemas "A" and "B" share the id x: use a wider fingerprint',
  });
});

test('Registry: envelopes carry the id of the schema that wrote them', () => {
  const registry = new SchemaRegistry([V1, V2]);
  const envelope = registry.encode(V1, { id: 1, fullName: 'Alex' });
  assert.deepStrictEqual(envelope, [V1.id, [1, 'Alex']]);
  // Without a reader, as the writer wrote it; with one, as the reader reads it.
  assert.deepStrictEqual(registry.decode(envelope), { id: 1, fullName: 'Alex' });
  assert.deepStrictEqual(registry.decode(envelope, V2), { id: 1, name: 'Alex', email: null });
  assert.deepStrictEqual(registry.decode(envelope, V1), { id: 1, fullName: 'Alex' });
  // Resolved once per writer and reader.
  assert.strictEqual(registry.resolve(V1.id, V2), registry.resolve(V1.id, V2));
  assert.strictEqual(registry.resolve(V2.id, V2), V2);
  assert.strictEqual(registry.resolve(V1.id, Schema.from(V1.definition)).id, V1.id);
  // Writing for a peer on the older version.
  const old = registry.encode(V2, { id: 2, name: 'Bo', email: 'b@x' }, { as: V1.id });
  assert.deepStrictEqual(old, [V1.id, [2, 'Bo']]);
  assert.deepStrictEqual(registry.encode(V2, { id: 2, name: 'Bo' }, { as: V2.id }), [
    V2.id,
    [2, 'Bo'],
  ]);
  assert.deepStrictEqual(registry.encode(V2, { id: 2, name: 'Bo' }, {}), [V2.id, [2, 'Bo']]);
  // Text, and the decode options.
  const text = registry.stringify(V1, { id: 3, fullName: 'C' });
  assert.strictEqual(text, `["${V1.id}",[3,"C"]]`);
  assert.deepStrictEqual(registry.parse(text, V2), { id: 3, name: 'C', email: null });
  assert.deepStrictEqual(registry.parse(text), { id: 3, fullName: 'C' });
  assert.throws(() => registry.decode([V1.id, [3, 'C', 'x']], V2, { strict: true }), {
    code: 'extra',
  });
  assert.throws(() => registry.encode({}, {}), { code: 'ERR_SCHEMA_EXPECTED' });
  assert.throws(() => registry.resolve(V1.id, {}), { code: 'ERR_SCHEMA_EXPECTED' });
});

test('Registry: what cannot be decoded', () => {
  const registry = new SchemaRegistry([V1]);
  for (const bad of [null, {}, [], [V1.id], [1, []], [V1.id, [], 3]]) {
    assert.throws(
      () => registry.decode(bad),
      (error) => {
        assert.ok(error instanceof DecodeError);
        assert.strictEqual(error.code, 'structure');
        assert.strictEqual(error.message, 'Value is not an envelope: [id, payload]');
        return true;
      },
    );
  }
  assert.throws(() => registry.decode(['nope', []]), {
    code: 'schema',
    path: '',
    schema: '',
    message: 'Value is not a known schema: nope',
  });
  assert.throws(() => registry.decode(['nope', []], V2), { code: 'schema', schema: 'User' });
  assert.throws(
    () => registry.parse('[', V2),
    (error) => {
      assert.strictEqual(error.code, 'json');
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    },
  );
  assert.throws(() => registry.decode([V1.id, ['x']], V2), { code: 'type', path: 'id' });
});

test('Registry: from(model) needs the metaschema module', () => {
  assert.throws(() => SchemaRegistry.from({}), {
    code: 'ERR_UNKNOWN_TYPE',
    message: "SchemaRegistry.from needs register() from '@alexify/protoarray/metaschema'",
  });
  // What register() plugs in builds it; the hook is stubbed here.
  const { HOOKS } = require('../../src/plan.js');
  const model = {};
  HOOKS.model = (source, options) => ({ source, options });
  try {
    assert.deepStrictEqual(SchemaRegistry.from(model, { validate: false }), {
      source: model,
      options: { validate: false },
    });
  } finally {
    HOOKS.model = null;
  }
});
