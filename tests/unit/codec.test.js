const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, encode, decode, stringify, parse, EncodeError } = require('../../index.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { VECTORS } = require('../support/vectors.js');
const { define, named, model } = require('../support/schema.js');

// The closures backend decides what to do with a slot by its kind, and a
// converted type checks and converts in one call under validation: every type
// with an `unpack` has a `checkedUnpack`, or the two backends would check in
// another order.
test('Types: every converted type checks and converts in one call', () => {
  const types = require('../../src/types.js');
  const flags = types.flags(['a', 'b']);
  const enumeration = types.enumeration(['x', 'y']);
  const nodes = [
    ...Object.keys(types.SCALARS).map((name) => types.SCALARS[name]()),
    enumeration,
    flags,
    types.decimal(2),
    types.interned(),
    types.deltas(types.SCALARS.integer(), true),
    types.bridge.bigint(),
    types.bridge.enumeration(enumeration, types.enumeration(['x']), null),
    types.bridge.choice(enumeration, null),
    types.bridge.flags(flags, types.flags(['a'])),
    types.bridge.ignore(),
  ];
  for (const node of nodes) {
    assert.strictEqual(node.kind, 'scalar');
    assert.ok(node.unpack === null || typeof node.checkedUnpack === 'function', node.type);
    assert.ok(node.pack === null || node.unpack !== null, node.type);
  }
});

for (const [backend, options] of BACKENDS) {
  for (const vector of VECTORS) {
    test(`Codec (${backend}): ${vector.name}`, () => {
      const schema = define(vector.definition, { ...vector.options, ...options });
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
    const schema = define(
      { b: '?string', a: 'number', c: { array: 'number', required: false } },
      options,
    );
    const decoded = schema.decode([null, 1]);
    assert.deepStrictEqual(Object.keys(decoded), ['b', 'a', 'c']);
    assert.ok(Object.hasOwn(decoded, 'b'));
    assert.strictEqual(decoded.c, null);
    assert.deepStrictEqual(schema.decode([null, 1], null), decoded);
  });

  // On V8 an object parsed from JSON with 128 keys or more is in dictionary
  // mode, and so is one filled by keyed assignment from about 18: the template
  // a decoded record starts from must be neither, on either side of the line.
  const WIDE_TYPES = ['string', 'integer', 'boolean', 'number'];
  const wideKeys = (width) => Array.from({ length: width }, (_, i) => `f${i}`);
  const wideValue = (keys) =>
    Object.fromEntries(
      keys.map((key, i) => {
        const type = i % 4;
        return [key, type === 0 ? `s${i}` : type === 1 ? i : type === 2 ? i % 3 === 0 : i / 4];
      }),
    );
  for (const width of [127, 128, 129]) {
    test(`Codec (${backend}): a record of ${width} fields decodes with every key in order`, () => {
      const keys = wideKeys(width);
      // Every eighth field is optional and left out: it decodes to null.
      const definition = Object.fromEntries(
        keys.map((key, i) => [key, `${i % 8 === 7 ? '?' : ''}${WIDE_TYPES[i % 4]}`]),
      );
      const full = wideValue(keys);
      const value = { ...full };
      const expected = { ...full };
      for (let i = 7; i < width; i += 8) {
        delete value[keys[i]];
        expected[keys[i]] = null;
      }
      const dense = define(definition, options);
      const decoded = dense.decode(dense.encode(value));
      assert.deepStrictEqual(Object.keys(decoded), keys);
      assert.deepStrictEqual(decoded, expected);
      assert.deepStrictEqual(dense.parse(dense.stringify(value)), expected);
      // A sparse record of the same width, every field optional, three present.
      const optional = Object.fromEntries(keys.map((key, i) => [key, `?${WIDE_TYPES[i % 4]}`]));
      const sparse = define(optional, { ...options, sparse: true });
      const few = { f0: 's0', f64: 's64', [keys[width - 1]]: full[keys[width - 1]] };
      const back = sparse.decode(sparse.encode(few));
      assert.deepStrictEqual(Object.keys(back), keys);
      assert.deepStrictEqual(back, {
        ...Object.fromEntries(keys.map((key) => [key, null])),
        ...few,
      });
    });
  }

  test(`Codec (${backend}): flags past 127 names decode as an object of every name`, () => {
    const names = Array.from({ length: 130 }, (_, i) => `n${i}`);
    const schema = define({ perms: { flags: names } }, options);
    const none = Object.fromEntries(names.map((name) => [name, false]));
    const wire = schema.encode({ perms: { n0: true, n31: true, n129: true } });
    assert.deepStrictEqual(wire, [[1, 1, 0, 0, 32]]);
    const decoded = schema.decode(wire).perms;
    assert.deepStrictEqual(Object.keys(decoded), names);
    assert.deepStrictEqual(decoded, { ...none, n0: true, n31: true, n129: true });
    // One integer is the first word; the words a payload stops short of are false.
    assert.deepStrictEqual(schema.decode([3]).perms, { ...none, n0: true, n1: true });
    assert.deepStrictEqual(schema.decode([[0, 2]]).perms, { ...none, n32: true });
    assert.deepStrictEqual(schema.decode([[0]]).perms, none);
  });

  test(`Codec (${backend}): extra trailing elements are ignored unless strict`, () => {
    const schema = define({ id: 'number' }, options);
    assert.deepStrictEqual(schema.decode([1, 'future']), { id: 1 });
    assert.throws(() => schema.decode([1, 'future'], { strict: true }), {
      code: 'extra',
      path: '',
      message: 'Value has extra elements',
    });
    const nested = define({ inner: { id: 'number' } }, options);
    assert.throws(() => nested.decode([[1, 2]], { strict: true }), { path: 'inner' });
    assert.throws(() => nested.parse('[[1, 2]]', { strict: true }), { code: 'extra' });
  });

  test(`Codec (${backend}): keys not in the schema are ignored`, () => {
    const schema = define({ id: 'number' }, options);
    assert.deepStrictEqual(schema.encode({ id: 1, extra: true }), [1]);
  });

  test(`Codec (${backend}): encode rejects what is not an object`, () => {
    const schema = define({ id: 'number' }, options);
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
    assert.deepStrictEqual(define('?string', options).encode(undefined), null);
  });

  test(`Codec (${backend}): schema references by name allow recursion`, () => {
    const Node = named('Node', { v: 'number', kids: { array: 'Node' }, next: '?Node' }, options);
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

  test(`Codec (${backend}): references by name reach the entities of a model`, () => {
    const { User } = model(
      {
        Address: { Struct: {}, city: 'string' },
        User: { Struct: {}, home: 'Address', work: '?Address' },
      },
      options,
    );
    assert.deepStrictEqual(User.encode({ home: { city: 'Kyiv' } }), [['Kyiv']]);
    assert.deepStrictEqual(User.decode([['Kyiv']]), { home: { city: 'Kyiv' }, work: null });
    assert.throws(() => User.decode([['Kyiv'], [1]]), { path: 'work.city', code: 'type' });
    assert.throws(() => User.decode([[1]]), {
      message: 'Field "home.city" is not of expected type: string',
    });
  });

  test(`Codec (${backend}): list is the rows collection of the schema`, () => {
    const User = define({ id: 'number', name: '?string' }, options);
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
    assert.strictEqual(User.list.id, define({ array: User.source }, options).id);
    assert.strictEqual(User.list.toString(), '[{id:number,name:?string}]');
    assert.throws(() => User.list.decode([[1], [2, 3]]), { code: 'type', path: '[1].name' });
    assert.throws(() => User.list.decode([[1], 2]), { code: 'structure', path: '[1]' });
  });

  test(`Codec (${backend}): a root reference by name is an alias of that schema`, () => {
    const { Alias } = model({ Address: { Struct: {}, city: 'string' }, Alias: 'Address' }, options);
    assert.strictEqual(Alias.toString(), '@Address');
    assert.deepStrictEqual(Alias.encode({ city: 'Kyiv' }), ['Kyiv']);
    assert.deepStrictEqual(Alias.decode(['Kyiv']), { city: 'Kyiv' });
    assert.throws(() => Alias.decode([1]), { code: 'type', path: 'city', schema: 'Alias' });
    assert.throws(() => Alias.decode('x'), { code: 'structure', path: '' });
    assert.throws(() => Alias.encode(5), { code: 'object', path: '' });
  });

  test(`Codec (${backend}): a collection inside a record takes a layout of its own`, () => {
    const Outer = define(
      { items: { array: { a: 'number', b: '?number' } }, c: { array: { a: 'number' } } },
      { ...options, layout: { items: 'flat', c: 'columns' } },
    );
    const value = { items: [{ a: 1 }, { a: 2, b: 3 }], c: [{ a: 1 }, { a: 2 }] };
    assert.deepStrictEqual(Outer.encode(value), [[1, null, 2, 3], [[1, 2]]]);
    assert.strictEqual(
      Outer.toString(),
      '{items:flat[{a:number,b:?number}],c:columns[{a:number}]}',
    );
    assert.deepStrictEqual(Outer.decode([[1, null, 2, 3], [[1, 2]]]), {
      items: [
        { a: 1, b: null },
        { a: 2, b: 3 },
      ],
      c: [{ a: 1 }, { a: 2 }],
    });
    assert.throws(() => Outer.decode([[1]]), { code: 'structure', path: 'items' });
    assert.throws(() => Outer.decode([[1, 'x']]), { code: 'type', path: 'items[0].b' });
    assert.throws(() => Outer.encode({ items: [{ a: 1 }, 5] }), { path: 'items[1]' });
    for (const layout of [{ items: 'nope' }, { items: 'flat', missing: 'flat' }, { c: 'flat' }]) {
      if (layout.c !== undefined) continue;
      assert.throws(() => define(Outer.source, { ...options, layout }), {
        code: 'ERR_INVALID_OPTIONS',
      });
    }
    assert.throws(() => define({ a: 'number' }, { ...options, layout: { a: 'flat' } }), {
      code: 'ERR_INVALID_OPTIONS',
      message: 'Option "layout" "flat" takes an array of records at "a"',
    });
  });

  test(`Codec (${backend}): an entity a reference reaches keeps its own options`, () => {
    const entities = {
      Inner: { Struct: {}, n: 'number' },
      Outer: { Struct: {}, s: 'Inner', list: { array: 'Inner' } },
    };
    // A trusting record over a strict entity validates inside it, and the
    // other way round.
    const { Outer } = model(entities, { ...options, entities: { Outer: { validate: false } } });
    assert.throws(() => Outer.decode([['x']]), { code: 'type', path: 's.n' });
    assert.throws(() => Outer.decode([[1], [['x']]]), { code: 'type', path: 'list[0].n' });
    assert.deepStrictEqual(Outer.decode([[1], [[2]]]), { s: { n: 1 }, list: [{ n: 2 }] });
    const Sparse = model(entities, { ...options, entities: { Inner: { sparse: true } } }).Outer;
    assert.deepStrictEqual(Sparse.encode({ s: { n: 1 }, list: [] }), [[1, 1], []]);
    // A root, on the other hand, is built again with the options given here.
    const Inner = Schema.fromModel(Outer.snapshot).Inner;
    assert.deepStrictEqual(define(Inner, { ...options, validate: false }).decode(['x']), {
      n: 'x',
    });
    assert.deepStrictEqual(define(Inner, { ...options, sparse: true }).encode({ n: 1 }), [1, 1]);
  });

  test(`Codec (${backend}): a root collection of scalars passes through`, () => {
    const Numbers = define({ array: 'number' }, options);
    const list = [1, 2, 3];
    assert.strictEqual(Numbers.encode(list), list);
    assert.strictEqual(Numbers.decode(list), list);
    assert.throws(() => Numbers.decode([1, 'x']), { path: '[1]', code: 'type' });
    assert.throws(() => Numbers.decode([1, null]), { path: '[1]', code: 'type' });
    const Loose = define({ array: 'number' }, { ...options, validate: false });
    assert.deepStrictEqual(Loose.decode([1, 'x']), [1, 'x']);
  });

  test(`Codec (${backend}): validate: false trusts the wire but keeps the structure`, () => {
    const schema = define(
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

  test(`Codec (${backend}): encode trusts the values; metaschema checks them`, () => {
    const User = named('User', { id: 'number', name: '?string' }, options);
    assert.deepStrictEqual(User.encode({ id: 'x', name: 5 }), ['x', 5]);
    assert.strictEqual(User.source.check({ id: 1 }).valid, true);
    assert.strictEqual(User.source.check({ id: 'x' }).valid, false);
  });

  test(`Codec (${backend}): a root scalar`, () => {
    const schema = define('?string', options);
    assert.strictEqual(schema.encode('x'), 'x');
    assert.strictEqual(schema.encode(null), null);
    assert.strictEqual(schema.decode(null), null);
    assert.throws(() => define('string', options).decode(null), {
      code: 'required',
      path: '',
    });
    assert.strictEqual(define('json', options).decode(null), null);
    assert.throws(() => schema.decode(1), { code: 'type', path: '' });
    const date = define('date', options);
    assert.deepStrictEqual(date.decode(5), new Date(5));
  });
}

test('Codec: the functional entry points mirror the methods', () => {
  const schema = define({ id: 'number', name: '?string' });
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

test('Codec: a custom fingerprint replaces the default id', () => {
  const print = (canonical) => `len:${canonical.length}`;
  const User = named('User', { id: 'number' }, { fingerprint: print });
  assert.strictEqual(User.id, 'len:11');
  assert.strictEqual(User.list.id, print(User.list.toString()));
  assert.strictEqual(User.list.name, 'User');
  assert.match(define({ id: 'number' }).id, /^[0-9a-f]{8}$/);
});

test('Codec: schema metadata', () => {
  const User = named('User', { id: 'number', tags: { array: 'string' }, self: '?User' });
  assert.strictEqual(User.name, 'User');
  assert.deepStrictEqual(User.keys, ['id', 'tags', 'self']);
  assert.ok(Object.isFrozen(User.keys));
  assert.strictEqual(User.layout, 'dense');
  assert.strictEqual(User.toString(), '{id:number,tags:[string],self:?@User}');
  assert.match(User.id, /^[0-9a-f]{8}$/);
  assert.strictEqual(User.id, User.id);
  assert.strictEqual(define({ id: 'number' }).id, named('Other', { id: 'number' }).id);
  assert.notStrictEqual(User.id, define({ id: 'number', tags: { array: 'string' } }).id);
  assert.strictEqual(Schema.from(User, { sparse: true }).layout, 'sparse');
  assert.strictEqual(Schema.from(User, { sparse: true }).name, 'User');
  assert.strictEqual(User.list.layout, 'rows');
  assert.strictEqual(User.list.toString(), '[{id:number,tags:[string],self:?@User}]');
  assert.strictEqual(define(['number', '?string']).toString(), '(number,?string)');
  assert.strictEqual(define({ n: { type: 'number', default: 0 } }).toString(), '{n:?number=0}');
  assert.strictEqual(
    define({
      r: { enum: ['a', 'b'] },
      f: { flags: ['x'] },
      d: 'date',
      b: 'bigint',
    }).toString(),
    '{r:enum(a|b),f:flags(x),d:date,b:bigint}',
  );
  assert.strictEqual(define({ list: { array: '?number' } }).toString(), '{list:[?number]}');
  assert.deepStrictEqual(define('string').keys, []);
  // A root scalar's optionality is part of the wire contract, so of the id.
  assert.strictEqual(define('string').toString(), 'string');
  assert.strictEqual(define('?string').toString(), '?string');
  assert.strictEqual(define('json').toString(), '?json');
  assert.notStrictEqual(define('string').id, define('?string').id);
  assert.strictEqual(define({ s: define('?string').source }).toString(), '{s:?string}');
  assert.deepStrictEqual(define({ s: define('?string').source }).decode([]), { s: null });
  assert.strictEqual(Schema.from(User, { codegen: false }).backend, 'closures');
});

test('Codec: a schema built from a schema reads its snapshot again', () => {
  const Base = define({ id: 'number', note: '?string' });
  const Sparse = Schema.from(Base, { sparse: true });
  assert.deepStrictEqual(Sparse.encode({ id: 1 }), [1, 1]);
  assert.deepStrictEqual(Sparse.decode([3, 1, 'x']), { id: 1, note: 'x' });
  assert.strictEqual(Sparse.source, Base.source);
  assert.strictEqual(new Schema(Base.snapshot).name, '');
  assert.strictEqual(new Schema(Base.snapshot).source, null);
  assert.strictEqual(new Schema(Base.snapshot).toString(), Base.toString());
  assert.throws(() => Schema.from(Base.list), { code: 'ERR_SCHEMA_EXPECTED' });
});

for (const [backend, options] of BACKENDS) {
  // Generated code writes the text itself; it must be the text of the wire.
  test(`Codec (${backend}): stringify writes what JSON.stringify of the wire would`, () => {
    const toJSON = { toJSON: (key) => `at ${key}` };
    const { S } = model(
      {
        Rec: { Struct: {}, a: 'json', b: '?json' },
        S: {
          Struct: {},
          j: 'json',
          n: 'number',
          b: 'boolean',
          s: 'string',
          d: 'date',
          list: { array: { type: 'json', required: false } },
          recs: { array: '?Rec' },
          'z?': 'json',
        },
      },
      { ...options, stringify: 'builder' },
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
      // toJSON is called once, with the key, not again on what it gives.
      {
        j: {
          toJSON: (key) => ({ key, toJSON: () => 'again' }),
        },
        n: 1,
        b: true,
        s: 'x',
        d: null,
        list: [{ toJSON: (key) => ({ key, toJSON: () => 'again' }) }],
        recs: [],
      },
    ];
    for (const value of values) {
      assert.strictEqual(S.stringify(value), JSON.stringify(S.encode(value)));
    }
    // A BigInt's toJSON is called too, as JSON.stringify calls it: the one
    // way to give a BigInt a JSON form is on its prototype, for this test.
    try {
      // oxlint-disable-next-line no-extend-native
      BigInt.prototype.toJSON = function keyed(key) {
        return `key=${key}`;
      };
      const value = { j: 5n, n: 1, b: true, s: 'x', d: null, list: [7n], recs: [] };
      assert.strictEqual(S.stringify(value), JSON.stringify(S.encode(value)));
    } finally {
      delete BigInt.prototype.toJSON;
    }
    const Sparse = define(
      { a: '?json', b: '?json', c: '?json' },
      { ...options, sparse: true, stringify: 'builder' },
    );
    for (const value of [{ b: toJSON }, { a: 1, c: toJSON }, {}]) {
      assert.strictEqual(Sparse.stringify(value), JSON.stringify(Sparse.encode(value)));
    }
    // The option to leave it to JSON.stringify, and nothing else.
    const Native = define({ a: 'number' }, { ...options, stringify: 'native' });
    assert.strictEqual(Native.stringify({ a: 1 }), '[1]');
    assert.strictEqual(Native[Symbol.for('alexify.protoarray.codec')].stringify, undefined);
    assert.throws(() => define({ a: 'number' }, { stringify: 'fast' }), {
      code: 'ERR_INVALID_OPTIONS',
    });
  });
}

test('Codec: the id covers the entities a schema references, not itself', () => {
  const make = (city) =>
    model({
      Address: { Struct: {}, city },
      User: { Struct: {}, home: 'Address', 'boss?': 'User' },
    });
  const a = make('string');
  const b = make('number');
  assert.strictEqual(a.User.toString(), '{home:@Address,boss:?@User}');
  assert.strictEqual(a.User.toString(), b.User.toString());
  assert.notStrictEqual(a.User.id, b.User.id);
  const seen = [];
  const User = Schema.from(a.User, { fingerprint: (text) => seen.push(text) && 'x' });
  assert.strictEqual(User.id, 'x');
  assert.deepStrictEqual(seen, ['{home:@Address,boss:?@User};Address={city:string}']);
  // A recursion alone signs with the canonical form, as 1.x computed the id.
  const Node = named('Node', { v: 'number', kids: { array: 'Node' } });
  assert.strictEqual(Node.id, Schema.from(Node.snapshot).id);
  const plain = named('Node', { v: 'number', kids: { array: 'Node' } }, { fingerprint: (t) => t });
  assert.strictEqual(plain.id, '{v:number,kids:[@Node]}');
});
