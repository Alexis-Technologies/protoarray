const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, DecodeError } = require('../../index.js');
const { SchemaRegistry } = require('../../registry.js');
const { ms, named } = require('../support/schema.js');

const V1 = named('User', { id: 'number', fullName: 'string' });
const V2 = named('User', {
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
  registry.add(V1).add(Schema.from(V1));
  assert.strictEqual(registry.size, 2);
  assert.strictEqual(registry.get(V1.id), V1);
  assert.strictEqual(new SchemaRegistry().size, 0);
  assert.strictEqual(new SchemaRegistry(null).size, 0);
  assert.throws(() => registry.add({}), { code: 'ERR_SCHEMA_EXPECTED' });
});

test('Registry: a narrow fingerprint is a collision, not a silent mix-up', () => {
  const narrow = () => 'x';
  const A = named('A', { a: 'number' }, { fingerprint: narrow });
  const B = named('B', { b: 'string' }, { fingerprint: narrow });
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
  assert.strictEqual(registry.resolve(V1.id, Schema.from(V1)).id, V1.id);
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

test('Registry: from a metaschema Model or its snapshot', () => {
  const entities = new Map([
    ['Address', { Struct: {}, city: 'string' }],
    ['User', { Struct: {}, id: 'number', home: 'Address' }],
  ]);
  const model = new ms.Model({}, entities);
  const registry = SchemaRegistry.from(model, { entities: { User: { sparse: true } } });
  assert.ok(registry instanceof SchemaRegistry);
  assert.strictEqual(registry.size, 2);
  const User = registry.find('User');
  assert.strictEqual(User.layout, 'sparse');
  assert.strictEqual(registry.find('Address').toString(), '{city:string}');
  assert.strictEqual(registry.get(User.id), User);
  const envelope = registry.encode(User, { id: 1, home: { city: 'Kyiv' } });
  assert.deepStrictEqual(envelope, [User.id, [3, 1, ['Kyiv']]]);
  assert.deepStrictEqual(registry.decode(envelope), { id: 1, home: { city: 'Kyiv' } });
  // The snapshot of the model builds the same schemas, with the options given.
  const plain = SchemaRegistry.from(model.toJSON(), { validate: false });
  assert.strictEqual(plain.find('User').layout, 'dense');
  assert.deepStrictEqual(plain.find('User').decode(['x', [1]]), { id: 'x', home: { city: 1 } });
  // The sparse User reads the payloads of the dense one, another version of it.
  const Dense = plain.find('User');
  registry.add(Dense);
  const read = registry.decode([Dense.id, [1, ['K']]], User);
  assert.deepStrictEqual(read, { id: 1, home: { city: 'K' } });
  for (const source of [{}, null, V1]) {
    assert.throws(() => SchemaRegistry.from(source), { code: 'ERR_SCHEMA_EXPECTED' });
  }
  assert.throws(() => SchemaRegistry.from(model, { sparse: true }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Option "sparse" names one schema: give it in "entities"',
  });
});

// A reference prints as a name: the id covers the shape of the entity it
// names, so two versions of it are two versions of the schema that refers.
test('Registry: versions that differ in a referenced entity are two versions', () => {
  const entities = (address) => ({
    Address: { Struct: {}, ...address },
    User: { Struct: {}, home: 'Address' },
  });
  const A1 = Schema.fromModel(
    new ms.Model({}, new Map(Object.entries(entities({ city: 'string', street: 'string' })))),
  ).User;
  const A2 = Schema.fromModel(
    new ms.Model({}, new Map(Object.entries(entities({ street: 'string', city: 'string' })))),
  ).User;
  assert.strictEqual(A1.toString(), A2.toString());
  assert.notStrictEqual(A1.id, A2.id);
  const registry = new SchemaRegistry([A1, A2]);
  assert.strictEqual(registry.size, 2);
  const envelope = registry.encode(A1, { home: { city: 'Kyiv', street: 'Main' } });
  assert.deepStrictEqual(registry.decode(envelope, A2), { home: { street: 'Main', city: 'Kyiv' } });
  // A fingerprint too narrow to tell them apart is a collision, not one version.
  const narrow = { fingerprint: () => 'same' };
  const W1 = Schema.from(A1, narrow);
  const W2 = Schema.from(A2, narrow);
  assert.throws(() => new SchemaRegistry([W1, W2]), { code: 'ERR_ID_COLLISION' });
});
