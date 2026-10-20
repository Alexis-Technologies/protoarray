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

// What a collision's message tells to do: a wider hash where the default one
// collided, another one where the schemas are on a hash of their own already.
const REMEDY = 'their fingerprint gives both one id, use a wider or another one';
const WIDER = "use a wider fingerprint ({ fingerprint: 'fnv1a64' })";

test('Registry: two schemas the default fingerprint gives one id are told to widen it', () => {
  // Two enums whose canonical forms hash alike under FNV-1a 32 (found by search).
  const A = named('A', { e: { enum: ['v468489'] } });
  const B = named('B', { e: { enum: ['v1076304'] } });
  assert.strictEqual(A.id, 'de175229');
  assert.strictEqual(B.id, A.id);
  assert.throws(() => new SchemaRegistry([A, B]), {
    code: 'ERR_ID_COLLISION',
    message: `Schemas "A" and "B" share the id de175229: ${WIDER}`,
  });
  // Widened, they are told apart.
  const wide = (name, value) => named(name, { e: { enum: [value] } }, { fingerprint: 'fnv1a64' });
  assert.strictEqual(new SchemaRegistry([wide('A', 'v468489'), wide('B', 'v1076304')]).size, 2);
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
    message: `Schemas "A" and "B" share the id x: ${REMEDY}`,
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
    id: 'nope',
    message: 'Value is not of a schema this reader can read',
  });
  assert.throws(() => registry.decode(['nope', []], V2), { code: 'schema', schema: 'User' });
  // The id is the payload's: on the error, never in its message.
  const forged = 'x\n2026-10-16 INFO admin logged in\u001b[2K';
  assert.throws(
    () => registry.parse(JSON.stringify([forged + 'y'.repeat(100000), [1]])),
    (error) => {
      assert.strictEqual(error.id.length, forged.length + 100000);
      assert.strictEqual(error.message, 'Value is not of a schema this reader can read');
      return true;
    },
  );
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

test('Registry: a version the reader cannot read is a DecodeError, tried once', () => {
  const Numeric = named('User', { id: 'number', fullName: 'number' });
  const registry = new SchemaRegistry([V1]);
  const decoding = (error) => {
    assert.ok(error instanceof DecodeError);
    assert.strictEqual(error.code, 'schema');
    assert.strictEqual(error.id, V1.id);
    assert.strictEqual(error.schema, 'User');
    assert.strictEqual(error.cause.code, 'ERR_INCOMPATIBLE');
    return true;
  };
  assert.throws(() => registry.decode([V1.id, [1, 'A']], Numeric), decoding);
  // The pair is not resolved again: the same error, from the registry.
  let first;
  try {
    registry.decode([V1.id, [1, 'A']], Numeric);
  } catch (error) {
    first = error.cause;
  }
  assert.throws(() => registry.parse(JSON.stringify([V1.id, [1, 'A']]), Numeric), decoding);
  assert.throws(
    () => registry.resolve(V1.id, Numeric),
    (error) => error === first,
  );
  assert.throws(() => registry.resolve('nope', Numeric), { code: 'schema', id: 'nope' });
  // Writing for an id the registry does not know is the caller's error.
  assert.throws(() => registry.encode(V1, { id: 1, fullName: 'A' }, { as: 'deadbeef' }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_UNKNOWN_SCHEMA',
    message: 'The registry has no schema of the id "deadbeef"',
  });
  // An error that is not about the versions passes through.
  const broken = Schema.from(V1);
  Object.defineProperty(broken, 'id', {
    get() {
      throw new RangeError('not about versions');
    },
  });
  assert.throws(() => registry.decode([V1.id, []], broken), RangeError);
});

test('Registry: one id for two versions is a collision, whatever tells them apart', () => {
  const { model: build } = require('../support/schema.js');
  const fingerprint = () => 'same';
  const versions = [
    build({ A: { Struct: {}, b: 'B' }, B: { Struct: {}, n: 'number' } }, { fingerprint }).A,
    // Another canonical form.
    build({ A: { Struct: {}, b: '?B' }, B: { Struct: {}, n: 'number' } }, { fingerprint }).A,
    // The same form, an entity more reached.
    build(
      {
        A: { Struct: {}, b: 'B' },
        B: { Struct: {}, n: 'number', 'c?': 'C' },
        C: { Struct: {}, s: 'string' },
      },
      { fingerprint },
    ).A,
    // The same form and count, another entity's form.
    build({ A: { Struct: {}, b: 'B' }, B: { Struct: {}, n: 'string' } }, { fingerprint }).A,
  ];
  for (const other of versions.slice(1)) {
    assert.throws(() => new SchemaRegistry([versions[0], other]), {
      code: 'ERR_ID_COLLISION',
      message: `Schemas "A" and "A" share the id same: ${REMEDY}`,
    });
  }
  // The same version again changes nothing.
  const again = build(
    { A: { Struct: {}, b: 'B' }, B: { Struct: {}, n: 'number' } },
    { fingerprint },
  );
  assert.strictEqual(new SchemaRegistry([versions[0], again.A]).size, 1);
  // A resolved schema is no reader the registry takes either.
  const { resolve } = require('../../resolve.js');
  const resolved = resolve(V1, V2);
  const registry = new SchemaRegistry([V1]);
  assert.throws(() => registry.decode([V1.id, [1, 'A']], resolved), {
    code: 'ERR_SCHEMA_EXPECTED',
  });
});
