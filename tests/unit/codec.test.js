const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, encode, decode, stringify, parse, EncodeError } = require('../../index.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { VECTORS } = require('../support/vectors.js');

for (const [backend, options] of BACKENDS) {
  for (const vector of VECTORS) {
    test(`Codec (${backend}): ${vector.name}`, () => {
      const schema = Schema.from(vector.definition, { ...vector.options, ...options });
      assert.strictEqual(schema.backend, backend);
      const expected = normalize(vector.decoded === undefined ? vector.value : vector.decoded);
      const wire = schema.encode(vector.value);
      assert.deepStrictEqual(normalize(wire), normalize(vector.wire));
      assert.deepStrictEqual(normalize(schema.decode(wire)), expected);
      assert.deepStrictEqual(normalize(schema.decode(vector.wire)), expected);
      assert.strictEqual(schema.stringify(vector.value), JSON.stringify(vector.wire));
      assert.deepStrictEqual(normalize(schema.parse(JSON.stringify(vector.wire))), expected);
      // Decoding is stable: a second round trip changes nothing.
      const twice = schema.decode(schema.encode(schema.decode(wire)));
      assert.deepStrictEqual(normalize(twice), expected);
    });
  }

  test(`Codec (${backend}): decoded objects carry every key in schema order`, () => {
    const schema = Schema.from(
      { b: '?string', a: 'number', c: { array: 'number', required: false } },
      options,
    );
    const decoded = schema.decode([null, 1]);
    assert.deepStrictEqual(Object.keys(decoded), ['b', 'a', 'c']);
    assert.ok(Object.hasOwn(decoded, 'b'));
    assert.strictEqual(decoded.c, null);
  });

  test(`Codec (${backend}): extra trailing elements are ignored unless strict`, () => {
    const schema = Schema.from({ id: 'number' }, options);
    assert.deepStrictEqual(schema.decode([1, 'future']), { id: 1 });
    assert.throws(() => schema.decode([1, 'future'], { strict: true }), {
      code: 'extra',
      path: '',
      message: 'Value has extra elements',
    });
    const nested = Schema.from({ inner: { id: 'number' } }, options);
    assert.throws(() => nested.decode([[1, 2]], { strict: true }), { path: 'inner' });
    assert.throws(() => nested.parse('[[1, 2]]', { strict: true }), { code: 'extra' });
  });

  test(`Codec (${backend}): keys not in the schema are ignored`, () => {
    const schema = Schema.from({ id: 'number' }, options);
    assert.deepStrictEqual(schema.encode({ id: 1, extra: true }), [1]);
  });

  test(`Codec (${backend}): encode rejects what is not an object`, () => {
    const schema = Schema.from({ id: 'number' }, options);
    for (const value of [null, undefined, 1, 'x']) {
      assert.throws(
        () => schema.encode(value),
        (error) => {
          assert.ok(error instanceof EncodeError);
          assert.ok(error instanceof TypeError);
          assert.strictEqual(error.name, 'EncodeError');
          assert.strictEqual(error.code, 'object');
          assert.strictEqual(error.message, 'Value is not an object');
          return true;
        },
      );
    }
    assert.deepStrictEqual(Schema.from('string', options).encode(undefined), null);
  });

  test(`Codec (${backend}): schema references by name allow recursion`, () => {
    const Node = new Schema(
      'Node',
      { v: 'number', kids: { array: 'Node' }, next: '?Node' },
      options,
    );
    const tree = { v: 1, kids: [{ v: 2, kids: [] }], next: { v: 3, kids: [] } };
    const wire = Node.encode(tree);
    assert.deepStrictEqual(wire, [1, [[2, []]], [3, []]]);
    assert.deepStrictEqual(Node.decode(wire), {
      v: 1,
      kids: [{ v: 2, kids: [], next: null }],
      next: { v: 3, kids: [], next: null },
    });
    assert.throws(() => Node.decode([1, [[2, ['x']]]]), { path: 'kids[0].kids[0]' });
  });

  test(`Codec (${backend}): schemas can be looked up in a registry`, () => {
    const Address = new Schema('Address', { city: 'string' }, options);
    const User = Schema.from(
      { home: 'Address', work: '?Address' },
      { ...options, schemas: { Address } },
    );
    assert.deepStrictEqual(User.encode({ home: { city: 'Kyiv' } }), [['Kyiv']]);
    assert.deepStrictEqual(User.decode([['Kyiv']]), { home: { city: 'Kyiv' }, work: null });
    assert.throws(() => User.decode([['Kyiv'], [1]]), { path: 'work.city', code: 'type' });
    assert.throws(() => User.decode([[1]]), {
      message: 'Field "home.city" is not of expected type: string',
    });
  });

  test(`Codec (${backend}): list is the rows collection of the schema`, () => {
    const User = Schema.from({ id: 'number', name: '?string' }, options);
    const users = [{ id: 1 }, { id: 2, name: 'x' }];
    assert.strictEqual(User.list, User.list);
    assert.strictEqual(User.list.backend, backend);
    assert.strictEqual(User.list.layout, 'rows');
    assert.deepStrictEqual(User.list.encode(users), [[1], [2, 'x']]);
    assert.deepStrictEqual(User.list.decode([[1], [2, 'x']]), [
      { id: 1, name: null },
      { id: 2, name: 'x' },
    ]);
  });

  test(`Codec (${backend}): a root collection of scalars passes through`, () => {
    const Numbers = Schema.from({ array: 'number' }, options);
    const list = [1, 2, 3];
    assert.strictEqual(Numbers.encode(list), list);
    assert.strictEqual(Numbers.decode(list), list);
    assert.throws(() => Numbers.decode([1, 'x']), { path: '[1]', code: 'type' });
    assert.throws(() => Numbers.decode([1, null]), { path: '[1]', code: 'type' });
    const Loose = Schema.from({ array: 'number' }, { ...options, validate: false });
    assert.deepStrictEqual(Loose.decode([1, 'x']), [1, 'x']);
  });

  test(`Codec (${backend}): validate: false trusts the wire but keeps the structure`, () => {
    const schema = Schema.from(
      { id: 'number', inner: { s: 'string' } },
      { ...options, validate: false },
    );
    assert.deepStrictEqual(schema.decode(['x']), { id: 'x', inner: null });
    assert.throws(() => schema.decode({ id: 1 }), {
      code: 'structure',
      message: 'Value is not an array',
    });
    assert.throws(() => schema.decode([1, 'no']), { code: 'structure', path: 'inner' });
  });

  test(`Codec (${backend}): a root scalar`, () => {
    const schema = Schema.from('?string', options);
    assert.strictEqual(schema.encode('x'), 'x');
    assert.strictEqual(schema.encode(null), null);
    assert.strictEqual(schema.decode(null), null);
    assert.throws(() => Schema.from('string', options).decode(null), {
      code: 'required',
      path: '',
    });
    assert.strictEqual(Schema.from('json', options).decode(null), null);
    assert.throws(() => schema.decode(1), { code: 'type', path: '' });
    const date = Schema.from('date', options);
    assert.deepStrictEqual(date.decode(5), new Date(5));
  });
}

test('Codec: the functional entry points mirror the methods', () => {
  const schema = Schema.from({ id: 'number', name: '?string' });
  assert.deepStrictEqual(encode(schema, { id: 1 }), [1]);
  assert.deepStrictEqual(decode(schema, [1]), { id: 1, name: null });
  assert.strictEqual(stringify(schema, { id: 1 }), '[1]');
  assert.deepStrictEqual(parse(schema, '[1]'), { id: 1, name: null });
  assert.throws(() => decode(schema, [1, 'x', 2], { strict: true }), { code: 'extra' });
  assert.throws(() => parse(schema, '[1, "x", 2]', { strict: true }), { code: 'extra' });
  for (const fn of [encode, decode, stringify, parse]) {
    assert.throws(() => fn({ id: 'number' }, {}), {
      code: 'ERR_SCHEMA_EXPECTED',
      message: 'Schema instance expected',
    });
  }
});

test('Codec: Schema.keys declares untyped positions', () => {
  const Point = Schema.keys(['x', 'y']);
  assert.deepStrictEqual(Point.keys, ['x', 'y']);
  assert.deepStrictEqual(Point.encode({ y: 2, x: { any: 1 } }), [{ any: 1 }, 2]);
  assert.deepStrictEqual(Point.decode([1]), { x: 1, y: null });
  assert.strictEqual(Point.toString(), '{x:?json,y:?json}');
  assert.throws(() => Schema.keys('x'), { code: 'ERR_INVALID_DEFINITION' });
  assert.throws(() => Schema.keys([1]), { code: 'ERR_INVALID_DEFINITION' });
});

test('Codec: schema metadata', () => {
  const User = new Schema('User', { id: 'number', tags: { array: 'string' }, self: '?User' });
  assert.strictEqual(User.name, 'User');
  assert.deepStrictEqual(User.keys, ['id', 'tags', 'self']);
  assert.ok(Object.isFrozen(User.keys));
  assert.strictEqual(User.layout, 'dense');
  assert.strictEqual(User.toString(), '{id:number,tags:[string],self:?@User}');
  assert.match(User.id, /^[0-9a-f]{8}$/);
  assert.strictEqual(User.id, User.id);
  assert.strictEqual(Schema.from({ id: 'number' }).id, new Schema('Other', { id: 'number' }).id);
  assert.notStrictEqual(User.id, Schema.from({ id: 'number', tags: { array: 'string' } }).id);
  assert.strictEqual(new Schema('User', User.definition, { sparse: true }).layout, 'sparse');
  assert.strictEqual(Schema.from({ array: User }, { layout: 'flat' }).layout, 'flat');
  assert.strictEqual(
    Schema.from({ array: User }).toString(),
    '[{id:number,tags:[string],self:?@User}]',
  );
  assert.strictEqual(
    Schema.from({ array: User }, { layout: 'columns' }).toString(),
    'columns[{id:number,tags:[string],self:?@User}]',
  );
  assert.strictEqual(Schema.from(['number', '?string']).toString(), '(number,?string)');
  assert.strictEqual(
    Schema.from({ n: { type: 'number', default: 0 } }).toString(),
    '{n:?number=0}',
  );
  assert.strictEqual(
    Schema.from({
      r: { enum: ['a', 'b'] },
      f: { flags: ['x'] },
      d: 'date',
      b: 'bigint',
    }).toString(),
    '{r:enum(a|b),f:flags(x),d:date,b:bigint}',
  );
  assert.strictEqual(Schema.from({ list: { array: '?number' } }).toString(), '{list:[?number]}');
  assert.deepStrictEqual(Schema.from('string').keys, []);
  assert.strictEqual(new Schema('User', User.definition, { codegen: false }).backend, 'closures');
});

test('Codec: a schema built from a schema keeps its definition', () => {
  const Base = Schema.from({ id: 'number', note: '?string' });
  const Sparse = Schema.from(Base, { sparse: true });
  assert.deepStrictEqual(Sparse.encode({ id: 1 }), [1, 1]);
  assert.deepStrictEqual(Sparse.decode([3, 1, 'x']), { id: 1, note: 'x' });
  assert.strictEqual(new Schema(Base.definition).name, '');
});
