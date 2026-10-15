const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, encode, decode, stringify, parse, check, EncodeError } = require('../../index.js');
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
    assert.deepStrictEqual(schema.decode([null, 1], null), decoded);
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
          assert.strictEqual(error.schema, '');
          return true;
        },
      );
    }
    assert.deepStrictEqual(Schema.from('?string', options).encode(undefined), null);
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
    // The list calls the record codec it already has instead of compiling it again.
    assert.strictEqual(User.list.id, Schema.from({ array: User }, options).id);
    assert.strictEqual(User.list.toString(), '[{id:number,name:?string}]');
    assert.throws(() => User.list.decode([[1], [2, 3]]), { code: 'type', path: '[1].name' });
    assert.throws(() => User.list.decode([[1], 2]), { code: 'structure', path: '[1]' });
  });

  test(`Codec (${backend}): a root reference by name is an alias of that schema`, () => {
    const Address = new Schema('Address', { city: 'string' }, options);
    const Alias = Schema.from('Address', { ...options, schemas: { Address } });
    assert.strictEqual(Alias.toString(), '@Address');
    assert.deepStrictEqual(Alias.encode({ city: 'Kyiv' }), ['Kyiv']);
    assert.deepStrictEqual(Alias.decode(['Kyiv']), { city: 'Kyiv' });
    assert.throws(() => Alias.decode([1]), { code: 'type', path: 'city', schema: '' });
    assert.throws(() => Alias.decode('x'), { code: 'structure', path: '' });
    assert.throws(() => Alias.encode(5), { code: 'object', path: '' });
  });

  test(`Codec (${backend}): a schema used by value keeps its layout and its options`, () => {
    const Items = new Schema(
      'Items',
      { array: { a: 'number', b: '?number' } },
      { ...options, layout: 'flat' },
    );
    const byValue = Schema.from({ items: Items }, options);
    const byName = Schema.from({ items: 'Items' }, { ...options, schemas: { Items } });
    const value = { items: [{ a: 1 }, { a: 2, b: 3 }] };
    assert.deepStrictEqual(byValue.encode(value), [[1, null, 2, 3]]);
    assert.deepStrictEqual(byName.encode(value), [[1, null, 2, 3]]);
    assert.strictEqual(byValue.toString(), '{items:flat[{a:number,b:?number}]}');
    assert.strictEqual(byName.toString(), '{items:@Items}');
    const decoded = {
      items: [
        { a: 1, b: null },
        { a: 2, b: 3 },
      ],
    };
    assert.deepStrictEqual(byValue.decode([[1, null, 2, 3]]), decoded);
    assert.deepStrictEqual(byName.decode([[1, null, 2, 3]]), decoded);
    assert.throws(() => byValue.decode([[1]]), { code: 'structure', path: 'items' });
    assert.throws(() => byValue.decode([[1, 'x']]), { code: 'type', path: 'items[0].b' });
    assert.throws(() => byValue.encode({ items: [{ a: 1 }, 5] }), { path: 'items[1]' });
    assert.deepStrictEqual(Items.list.encode([[{ a: 1 }]]), [[1, null]]);
    assert.strictEqual(Items.list.toString(), '[flat[{a:number,b:?number}]]');
    const Cols = Schema.from({ array: { a: 'number' } }, { ...options, layout: 'columns' });
    assert.deepStrictEqual(Schema.from({ c: Cols }, options).encode({ c: [{ a: 1 }, { a: 2 }] }), [
      [[1, 2]],
    ]);
    // Options travel with the schema: a strict one validates inside a trusting one,
    // by value exactly as by name.
    const Inner = new Schema('Inner', { n: 'number' }, options);
    const Outer = Schema.from(
      { s: Inner, list: { array: Inner }, named: 'Inner' },
      { ...options, validate: false, schemas: { Inner } },
    );
    assert.throws(() => Outer.decode([['x']]), { code: 'type', path: 's.n' });
    assert.throws(() => Outer.decode([[1], [['x']]]), { code: 'type', path: 'list[0].n' });
    assert.throws(() => Outer.decode([[1], [], ['x']]), { code: 'type', path: 'named.n' });
    assert.deepStrictEqual(Outer.decode([[1], [[2]], [3]]), {
      s: { n: 1 },
      list: [{ n: 2 }],
      named: { n: 3 },
    });
    // A root, on the other hand, is built from its plan with the options given here.
    assert.deepStrictEqual(Schema.from(Inner, { ...options, validate: false }).decode(['x']), {
      n: 'x',
    });
    assert.deepStrictEqual(
      Schema.from(Inner, { ...options, sparse: true }).encode({ n: 1 }),
      [1, 1],
    );
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

  test(`Codec (${backend}): check returns what encode would throw, or null`, () => {
    const User = new Schema('User', { id: 'number', name: '?string' }, options);
    assert.strictEqual(User.check({ id: 1 }), null);
    const error = User.check({ id: 'x' });
    assert.ok(error instanceof EncodeError);
    assert.deepStrictEqual(
      [error.code, error.path, error.schema, error.message],
      ['type', 'id', 'User', 'Field "id" is not of expected type: number'],
    );
    assert.strictEqual(User.check(5).code, 'object');
    assert.strictEqual(User.list.check([{ id: 1 }, {}]).path, '[1].id');
    assert.strictEqual(User.list.check('x').code, 'array');
    // It checks where `validate: false` trusts the value, in the schemas it embeds too.
    const loose = { ...options, validate: false };
    const Node = new Schema('Node', { v: 'number', kids: { array: 'Node' } }, loose);
    assert.strictEqual(Node.check({ v: 1, kids: [{ v: 2, kids: [] }] }), null);
    assert.strictEqual(Node.check({ v: 1, kids: [{ v: 'x', kids: [] }] }).path, 'kids[0].v');
    assert.deepStrictEqual(Node.encode({ v: 'x', kids: [] }), ['x', []]);
    const Inner = new Schema('Inner', { n: 'number' }, loose);
    const Outer = Schema.from(
      { s: Inner, list: { array: Inner }, named: 'Inner' },
      { ...options, schemas: { Inner } },
    );
    const good = { s: { n: 1 }, list: [], named: { n: 1 } };
    assert.strictEqual(Outer.check(good), null);
    assert.strictEqual(Outer.check({ ...good, s: { n: 'x' } }).path, 's.n');
    assert.strictEqual(Outer.check({ ...good, list: [{ n: 'x' }] }).path, 'list[0].n');
    assert.strictEqual(Outer.check({ ...good, named: { n: 'x' } }).path, 'named.n');
    assert.deepStrictEqual(Outer.encode({ ...good, s: { n: 'x' } }), [['x'], [], [1]]);
    assert.strictEqual(Inner.list.check([{ n: 1 }, { n: 'q' }]).path, '[1].n');
    const Flat = Schema.from({ array: Inner }, { ...loose, layout: 'flat' });
    assert.strictEqual(Flat.check([{ n: 'x' }]).path, '[0].n');
    assert.strictEqual(Flat.check([null]).code, 'type');
    const Alias = Schema.from('Inner', { ...options, schemas: { Inner } });
    assert.strictEqual(Alias.check({ n: 'x' }).path, 'n');
    const cycle = { v: 1, kids: [] };
    cycle.kids.push(cycle);
    assert.strictEqual(Node.check(cycle).code, 'depth');
    // The checking codec is compiled once, and a throwing getter is not a data problem.
    const CHECKER = Symbol.for('alexify.protoarray.checker');
    assert.strictEqual(Node[CHECKER], Node[CHECKER]);
    const bad = {
      get id() {
        throw new SyntaxError('boom');
      },
    };
    assert.throws(() => User.check(bad), SyntaxError);
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
  assert.strictEqual(check(schema, { id: 1 }), null);
  assert.strictEqual(check(schema, {}).code, 'required');
  assert.throws(() => decode(schema, [1, 'x', 2], { strict: true }), { code: 'extra' });
  assert.throws(() => parse(schema, '[1, "x", 2]', { strict: true }), { code: 'extra' });
  for (const fn of [encode, decode, stringify, parse, check]) {
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
  assert.throws(() => Schema.keys(['a', '__proto__']), { code: 'ERR_RESERVED_KEY' });
});

test('Codec: a custom fingerprint replaces the default id', () => {
  const print = (canonical) => `len:${canonical.length}`;
  const User = new Schema('User', { id: 'number' }, { fingerprint: print });
  assert.strictEqual(User.id, 'len:11');
  assert.strictEqual(User.list.id, print(User.list.toString()));
  assert.strictEqual(User.list.name, 'User');
  assert.match(Schema.from({ id: 'number' }).id, /^[0-9a-f]{8}$/);
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
  // A root scalar's optionality is part of the wire contract, so of the id.
  assert.strictEqual(Schema.from('string').toString(), 'string');
  assert.strictEqual(Schema.from('?string').toString(), '?string');
  assert.strictEqual(Schema.from('json').toString(), '?json');
  assert.notStrictEqual(Schema.from('string').id, Schema.from('?string').id);
  assert.strictEqual(Schema.from({ s: Schema.from('?string') }).toString(), '{s:?string}');
  assert.deepStrictEqual(Schema.from({ s: Schema.from('?string') }).decode([]), { s: null });
  assert.strictEqual(new Schema('User', User.definition, { codegen: false }).backend, 'closures');
});

test('Codec: a schema built from a schema keeps its definition', () => {
  const Base = Schema.from({ id: 'number', note: '?string' });
  const Sparse = Schema.from(Base, { sparse: true });
  assert.deepStrictEqual(Sparse.encode({ id: 1 }), [1, 1]);
  assert.deepStrictEqual(Sparse.decode([3, 1, 'x']), { id: 1, note: 'x' });
  assert.strictEqual(new Schema(Base.definition).name, '');
});

// check() reaches every construct, however the schema was built.
for (const [backend, options] of BACKENDS) {
  test(`Codec (${backend}): check covers unions, layouts and roots`, () => {
    const loose = { ...options, validate: false };
    const Node = new Schema(
      'Node',
      {
        union: [
          { Struct: {}, type: { enum: ['leaf'] }, v: 'number' },
          { Struct: {}, type: { enum: ['pair'] }, l: 'Node', r: 'Node' },
        ],
        discriminator: 'type',
      },
      loose,
    );
    const leaf = (v) => ({ type: 'leaf', v });
    assert.strictEqual(Node.check({ type: 'pair', l: leaf(1), r: leaf(2) }), null);
    assert.strictEqual(Node.check({ type: 'pair', l: leaf('x'), r: leaf(2) }).path, 'l.v');
    assert.strictEqual(Node.check({ type: 'pair', l: { type: 'nope' }, r: null }).path, 'l.type');
    assert.strictEqual(Node.check({ type: 'pair', l: leaf(1) }).path, 'r');
    assert.deepStrictEqual(Node.encode(leaf('x')), [0, 'x']);
    const Cols = Schema.from({ array: { a: 'number' } }, { ...loose, layout: 'columns' });
    assert.strictEqual(Cols.check([{ a: 1 }, { a: 'x' }]).path, '[1].a');
    assert.strictEqual(Cols.check([{ a: 1 }, null]).code, 'type');
    assert.deepStrictEqual(Cols.encode([{ a: 'x' }]), [['x']]);
    const Sparse = Schema.from({ a: 'number', b: '?string' }, { ...loose, sparse: true });
    assert.strictEqual(Sparse.check({ b: 'x' }).code, 'required');
    assert.strictEqual(Sparse.check({ a: 1 }), null);
    const Num = Schema.from('number', loose);
    assert.strictEqual(Num.check('x').code, 'type');
    assert.strictEqual(Num.check(undefined).code, 'required');
    assert.strictEqual(Num.check(1), null);
    assert.strictEqual(Schema.from('?number', loose).check(null), null);
    const Pair = Schema.from(['number', 'string'], loose);
    assert.strictEqual(Pair.check([1, 'x']), null);
    assert.strictEqual(Pair.check([1]).path, '[1]');
    assert.strictEqual(Pair.check({}).code, 'array');
  });
}

for (const [backend, options] of BACKENDS) {
  // Generated code writes the text itself; it must be the text of the wire.
  test(`Codec (${backend}): stringify writes what JSON.stringify of the wire would`, () => {
    const toJSON = { toJSON: (key) => `at ${key}` };
    const S = Schema.from(
      {
        j: 'json',
        n: 'number',
        b: 'boolean',
        s: 'string',
        d: 'date',
        list: { array: { type: 'json', required: false } },
        recs: { array: '?Rec' },
        'z?': 'json',
      },
      {
        ...options,
        stringify: 'builder',
        schemas: {
          Rec: Schema.from({ a: 'json', b: '?json' }, { ...options, stringify: 'builder' }),
        },
      },
    );
    const values = [
      {
        j: toJSON,
        n: 1,
        b: true,
        s: 'x',
        d: new Date(1),
        list: [toJSON, () => 1],
        recs: [null, { a: toJSON }],
      },
      { j: () => 1, n: NaN, b: 'yes', s: 5, d: 'x', list: [], recs: [], z: Symbol('s') },
      {
        j: undefined,
        n: Infinity,
        b: null,
        s: null,
        d: null,
        list: [undefined],
        recs: [{ a: undefined, b: toJSON }],
      },
      {
        j: { toJSON: () => undefined },
        n: -0,
        b: false,
        s: String.fromCharCode(0x2028),
        d: new Date(NaN),
        list: null,
        recs: null,
        z: toJSON,
      },
      { j: 1, n: 1, b: true, s: 'x'.repeat(65), d: null, list: [], recs: [] },
      { j: 1, n: 1, b: true, s: `a${String.fromCharCode(0xd800)}b`, d: null, list: [], recs: [] },
      { j: 1, n: 1, b: true, s: `${String.fromCodePoint(0x1f600)}"`, d: null, list: [], recs: [] },
      { j: 1, n: 1, b: true, s: 'tab\there', d: null, list: [], recs: [] },
    ];
    for (const value of values) {
      assert.strictEqual(S.stringify(value), JSON.stringify(S.encode(value)));
    }
    const Sparse = Schema.from(
      { a: '?json', b: '?json', c: '?json' },
      { ...options, sparse: true, stringify: 'builder' },
    );
    for (const value of [{ b: toJSON }, { a: 1, c: toJSON }, {}]) {
      assert.strictEqual(Sparse.stringify(value), JSON.stringify(Sparse.encode(value)));
    }
    // The option to leave it to JSON.stringify, and nothing else.
    const Native = Schema.from({ a: 'number' }, { ...options, stringify: 'native' });
    assert.strictEqual(Native.stringify({ a: 1 }), '[1]');
    assert.strictEqual(Native[Symbol.for('alexify.protoarray.codec')].stringify, undefined);
    assert.throws(() => Schema.from({ a: 'number' }, { stringify: 'fast' }), {
      code: 'ERR_INVALID_OPTIONS',
    });
  });
}
