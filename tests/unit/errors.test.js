const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, DecodeError, EncodeError } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');

for (const [backend, options] of BACKENDS) {
  test(`Errors (${backend}): decode errors carry a code, a path and a message`, () => {
    const User = Schema.from(
      {
        id: 'number',
        role: { enum: ['admin', 'editor'] },
        address: { city: 'string', zip: '?string' },
        orders: { array: { sku: 'string', qty: 'number' } },
        at: 'date',
        n: 'bigint',
        perms: { flags: ['a'] },
        pair: ['number', 'string'],
      },
      options,
    );
    const ok = [1, 0, ['Kyiv'], [], 1, '1', 1, [1, 'x']];
    const cases = [
      [['x'], 'type', 'id', 'Field "id" is not of expected type: number'],
      [[], 'required', 'id', 'Field "id" is required'],
      [[1, 5], 'enum', 'role', 'Field "role" is not of enum: admin, editor'],
      [[1, 0, 'x'], 'structure', 'address', 'Field "address" is not an array'],
      [[1, 0, [1]], 'type', 'address.city', 'Field "address.city" is not of expected type: string'],
      [[1, 0, ['Kyiv', 1]], 'type', 'address.zip'],
      [[1, 0, ['Kyiv'], 'x'], 'structure', 'orders'],
      [
        [1, 0, ['Kyiv'], [['A', 1], 'x']],
        'structure',
        'orders[1]',
        'Field "orders[1]" is not an array',
      ],
      [
        [
          1,
          0,
          ['Kyiv'],
          [
            ['A', 1],
            ['B', 'q'],
          ],
        ],
        'type',
        'orders[1].qty',
      ],
      [
        [1, 0, ['Kyiv'], [['A', 1], null]],
        'type',
        'orders[1]',
        'Field "orders[1]" is not of expected type: object',
      ],
      [[1, 0, ['Kyiv'], [], 'now'], 'type', 'at', 'Field "at" is not of expected type: date'],
      [[1, 0, ['Kyiv'], [], 1, 'abc'], 'type', 'n', 'Field "n" is not of expected type: bigint'],
      [
        [1, 0, ['Kyiv'], [], 1, '1', -1],
        'type',
        'perms',
        'Field "perms" is not of expected type: flags',
      ],
      [
        [1, 0, ['Kyiv'], [], 1, '1', 1, [1]],
        'structure',
        'pair',
        'Field "pair" has a wrong length',
      ],
      [[1, 0, ['Kyiv'], [], 1, '1', 1, [1, 2]], 'type', 'pair[1]'],
      [
        [1, 0, ['Kyiv'], [], 1, '1', 1, [null, 'x']],
        'required',
        'pair[0]',
        'Field "pair[0]" is required',
      ],
      ['x', 'structure', '', 'Value is not an array'],
      [null, 'structure', '', 'Value is not an array'],
    ];
    assert.ok(User.decode(ok));
    for (const [wire, code, path, message] of cases) {
      assert.throws(
        () => User.decode(wire),
        (error) => {
          assert.ok(error instanceof DecodeError, `${code} at ${path}`);
          assert.ok(error instanceof TypeError);
          assert.strictEqual(error.name, 'DecodeError');
          assert.strictEqual(error.code, code);
          assert.strictEqual(error.path, path);
          if (message !== undefined) assert.strictEqual(error.message, message);
          assert.strictEqual(error.cause, undefined);
          assert.strictEqual(error.schema, '');
          assert.deepStrictEqual(Object.keys(error), ['code', 'path', 'schema']);
          return true;
        },
        `${code} at ${path}`,
      );
    }
  });

  test(`Errors (${backend}): paths through nested collections`, () => {
    const Tree = Schema.from(
      { rows: { array: { array: { v: 'number' } } }, grid: { array: { array: 'number' } } },
      options,
    );
    assert.throws(() => Tree.decode([[[[1]], [[2], ['x']]]]), {
      path: 'rows[1][1].v',
      code: 'type',
    });
    assert.throws(() => Tree.decode([[], [[1], [2, 'x']]]), { path: 'grid[1][1]', code: 'type' });
    assert.throws(() => Tree.decode([[], [[1], null]]), {
      path: 'grid[1]',
      code: 'type',
      message: 'Field "grid[1]" is not of expected type: array',
    });
    const List = Schema.from({ array: { v: 'number' } }, options);
    assert.throws(() => List.decode([[1], ['x']]), { path: '[1].v' });
    assert.throws(() => List.decode([[1], 2]), {
      path: '[1]',
      message: 'Field "[1]" is not an array',
    });
  });

  test(`Errors (${backend}): parse wraps invalid JSON`, () => {
    const schema = Schema.from({ id: 'number' }, options);
    assert.throws(
      () => schema.parse('{'),
      (error) => {
        assert.ok(error instanceof DecodeError);
        assert.strictEqual(error.code, 'json');
        assert.strictEqual(error.path, '');
        assert.strictEqual(error.message, 'Value is not valid JSON');
        assert.ok(error.cause instanceof SyntaxError);
        return true;
      },
    );
  });

  test(`Errors (${backend}): without validation what has no wire form stays as it is`, () => {
    const schema = Schema.from(
      { inner: { n: 'bigint' }, list: { array: { n: 'bigint' } }, role: { enum: ['a', 'b'] } },
      { ...options, validate: false },
    );
    assert.deepStrictEqual(schema.decode([['abc']]), {
      inner: { n: 'abc' },
      list: null,
      role: null,
    });
    assert.deepStrictEqual(schema.decode([['1'], [['abc'], [1.5]], 7]), {
      inner: { n: 1n },
      list: [{ n: 'abc' }, { n: 1.5 }],
      role: 7,
    });
    assert.strictEqual(schema.decode([null, null, '__proto__']).role, '__proto__');
    assert.strictEqual(schema.decode([null, null, 1]).role, 'b');
  });

  test(`Errors (${backend}): a payload nested too deeply is a decode error`, () => {
    const Node = new Schema('Node', { v: 'number', kids: { array: 'Node' } }, options);
    const depth = 100000;
    const text = `${'[1,['.repeat(depth)}[1,[]]${']]'.repeat(depth)}`;
    const expected = {
      code: 'structure',
      path: '',
      schema: 'Node',
      message: 'Value is nested too deeply',
    };
    assert.throws(() => Node.parse(text), expected);
    assert.throws(() => Node.decode(JSON.parse(text)), expected);
    assert.throws(() => Node.list.parse(`[${text}]`), expected);
    const Outer = new Schema('Outer', { root: Node }, options);
    assert.throws(() => Outer.parse(`[${text}]`), { ...expected, schema: 'Outer' });
  });

  test(`Errors (${backend}): encode errors carry a code, a path and the schema name`, () => {
    const Order = new Schema(
      'Order',
      {
        'items?': { array: { sku: 'string' } },
        'home?': { city: 'string' },
        'pair?': ['number', 'string'],
        'grid?': { array: { array: 'number' } },
        'tags?': { array: 'string' },
      },
      options,
    );
    const cases = [
      [null, 'object', '', 'Value is not an object'],
      [5, 'object', ''],
      [{ items: 5 }, 'array', 'items', 'Field "items" is not an array'],
      [{ items: [{ sku: 'a' }, 5] }, 'object', 'items[1]', 'Field "items[1]" is not an object'],
      [{ home: 'x' }, 'object', 'home'],
      [{ pair: 5 }, 'array', 'pair'],
      [{ grid: [[1], 2] }, 'array', 'grid[1]'],
      [{ tags: 'ab' }, 'array', 'tags'],
    ];
    for (const [value, code, path, message] of cases) {
      assert.throws(
        () => Order.encode(value),
        (error) => {
          assert.ok(error instanceof EncodeError, `${code} at ${path}`);
          assert.ok(error instanceof TypeError);
          assert.strictEqual(error.name, 'EncodeError');
          assert.strictEqual(error.code, code);
          assert.strictEqual(error.path, path);
          assert.strictEqual(error.schema, 'Order');
          if (message !== undefined) assert.strictEqual(error.message, message);
          assert.deepStrictEqual(Object.keys(error), ['code', 'path', 'schema']);
          return true;
        },
        `${code} at ${path}`,
      );
    }
    const Numbers = Schema.from({ array: 'number' }, options);
    assert.throws(() => Numbers.encode({}), {
      code: 'array',
      path: '',
      message: 'Value is not an array',
    });
    assert.throws(() => Numbers.encode('ab'), { code: 'array', path: '', schema: '' });
    assert.throws(() => Order.list.encode(5), { code: 'array', path: '', schema: 'Order' });
    assert.throws(() => Order.list.encode([{}, 5]), {
      code: 'object',
      path: '[1]',
      schema: 'Order',
    });
  });

  // Without validation, a conversion that throws on its own (a Date from a
  // BigInt) is the caller's bug, not a wire problem: it is neither wrapped nor
  // re-pathed. Validation rejects the value before converting it.
  test(`Errors (${backend}): errors that are not encode errors pass through`, () => {
    const foreign = (error) =>
      error instanceof TypeError && !(error instanceof EncodeError) && error.code === undefined;
    const definition = {
      'inner?': { at: 'date' },
      'list?': { array: { at: 'date' } },
      'pair?': ['date', 'number'],
    };
    const loose = { ...options, validate: false };
    const schema = Schema.from(definition, loose);
    assert.throws(() => schema.encode({ inner: { at: 1n } }), foreign);
    assert.throws(() => schema.encode({ list: [{ at: 1n }] }), foreign);
    assert.throws(() => schema.encode({ pair: [1n, 1] }), foreign);
    const Flat = Schema.from({ array: { at: 'date' } }, { ...loose, layout: 'flat' });
    assert.throws(() => Flat.encode([{ at: 1n }]), foreign);
    const Cols = Schema.from({ array: { at: 'date' } }, { ...loose, layout: 'columns' });
    assert.throws(() => Cols.encode([{ at: 1n }]), foreign);
    const strict = Schema.from(definition, options);
    assert.throws(() => strict.encode({ inner: { at: 1n } }), { code: 'type', path: 'inner.at' });
    assert.throws(() => strict.encode({ list: [{ at: 1n }] }), { path: 'list[0].at' });
    assert.throws(() => strict.encode({ pair: [1n, 1] }), { path: 'pair[0]' });
    const StrictFlat = Schema.from({ array: { at: 'date' } }, { ...options, layout: 'flat' });
    assert.throws(() => StrictFlat.encode([{ at: 1n }]), { code: 'type', path: '[0].at' });
  });

  test(`Errors (${backend}): encode validates the values it is given`, () => {
    const User = new Schema(
      'User',
      {
        id: 'number',
        name: 'string',
        active: 'boolean',
        role: { enum: ['admin', 'editor'] },
        code: { enum: [10, 20], required: false },
        at: '?date',
        n: '?bigint',
        perms: { flags: ['a'], required: false },
        meta: '?json',
        balance: { type: 'number', default: 0 },
        address: { city: 'string', zip: '?string' },
        orders: { array: { sku: 'string', qty: 'number' } },
        tags: { array: 'string', required: false },
        notes: { array: '?string', required: false },
        pair: { type: 'json', required: false },
        point: ['number', '?string'],
      },
      options,
    );
    const ok = {
      id: 1,
      name: 'Alex',
      active: true,
      role: 'admin',
      address: { city: 'Kyiv' },
      orders: [],
      point: [1],
    };
    assert.deepStrictEqual(User.encode(ok), [
      1,
      'Alex',
      true,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      ['Kyiv'],
      [],
      null,
      null,
      null,
      [1, null],
    ]);
    const cases = [
      [{ id: undefined }, 'required', 'id', 'Field "id" is required'],
      [{ id: '1' }, 'type', 'id', 'Field "id" is not of expected type: number'],
      [{ id: NaN }, 'type', 'id'],
      [{ id: Infinity }, 'type', 'id'],
      [{ name: 5 }, 'type', 'name', 'Field "name" is not of expected type: string'],
      [{ active: 1 }, 'type', 'active', 'Field "active" is not of expected type: boolean'],
      [{ role: null }, 'required', 'role'],
      [{ role: 'root' }, 'enum', 'role', 'Field "role" is not of enum: admin, editor'],
      [{ code: '20' }, 'enum', 'code', 'Field "code" is not of enum: 10, 20'],
      [{ at: 'now' }, 'type', 'at', 'Field "at" is not of expected type: date'],
      [{ at: new Date(NaN) }, 'type', 'at'],
      [{ at: Infinity }, 'type', 'at'],
      [{ n: 1.5 }, 'type', 'n', 'Field "n" is not of expected type: bigint'],
      [{ n: '1e3' }, 'type', 'n'],
      [{ perms: 1 }, 'type', 'perms', 'Field "perms" is not of expected type: flags'],
      [{ address: undefined }, 'required', 'address'],
      [{ address: {} }, 'required', 'address.city', 'Field "address.city" is required'],
      [{ address: { city: 'Kyiv', zip: 1 } }, 'type', 'address.zip'],
      [{ orders: null }, 'required', 'orders'],
      [{ orders: [{ sku: 'a', qty: 1 }, { sku: 'b' }] }, 'required', 'orders[1].qty'],
      [
        {
          orders: [
            { sku: 'a', qty: 1 },
            { sku: 2, qty: 1 },
          ],
        },
        'type',
        'orders[1].sku',
      ],
      [
        { orders: [{ sku: 'a', qty: 1 }, null] },
        'type',
        'orders[1]',
        'Field "orders[1]" is not of expected type: object',
      ],
      [{ tags: ['a', 1] }, 'type', 'tags[1]', 'Field "tags[1]" is not of expected type: string'],
      [{ tags: ['a', null] }, 'type', 'tags[1]'],
      [{ notes: ['a', 1] }, 'type', 'notes[1]'],
      [{ point: [null] }, 'required', 'point[0]', 'Field "point[0]" is required'],
      [{ point: [1, 2] }, 'type', 'point[1]'],
      [{ point: null }, 'required', 'point'],
    ];
    for (const [patch, code, path, message] of cases) {
      assert.throws(
        () => User.encode({ ...ok, ...patch }),
        (error) => {
          assert.ok(error instanceof EncodeError, `${code} at ${path}`);
          assert.strictEqual(error.code, code, path);
          assert.strictEqual(error.path, path);
          assert.strictEqual(error.schema, 'User');
          if (message !== undefined) assert.strictEqual(error.message, message);
          assert.deepStrictEqual(Object.keys(error), ['code', 'path', 'schema']);
          return true;
        },
        `${code} at ${path}`,
      );
    }
    // What validation lets through: optional slots, defaults, json and the
    // lossless spellings of a type.
    const loose = {
      ...ok,
      code: 20,
      at: 5,
      n: '-12',
      perms: { a: true, zzz: 1 },
      meta: { anything: [1n] },
      balance: null,
      notes: ['a', null],
      point: [1, null, 'ignored'],
    };
    assert.deepStrictEqual(User.encode(loose).slice(3, 10), [
      0,
      1,
      5,
      '-12',
      1,
      { anything: [1n] },
      null,
    ]);
    assert.deepStrictEqual(User.encode({ ...ok, n: 7 })[6], '7');
    assert.deepStrictEqual(User.encode({ ...ok, at: new Date(9) })[5], 9);
    // Without validation every case above encodes as it did in 1.0.
    const Trusting = new Schema('User', User.definition, { ...options, validate: false });
    for (const [patch] of cases) assert.ok(Array.isArray(Trusting.encode({ ...ok, ...patch })));
    assert.deepStrictEqual(Trusting.encode({ ...ok, role: 'root', id: '1' }).slice(0, 4), [
      '1',
      'Alex',
      true,
      null,
    ]);
  });

  test(`Errors (${backend}): encode validates roots and collections`, () => {
    assert.throws(() => Schema.from('string', options).encode(undefined), {
      code: 'required',
      path: '',
      message: 'Value is required',
    });
    assert.throws(() => Schema.from('number', options).encode(NaN), { code: 'type', path: '' });
    assert.strictEqual(Schema.from('?number', options).encode(null), null);
    const blob = { any: [1] };
    assert.strictEqual(Schema.from('json', options).encode(blob), blob);
    assert.strictEqual(Schema.from('string', { ...options, validate: false }).encode(5), 5);
    const Ids = Schema.from({ array: 'number' }, options);
    const ids = [1, 2];
    assert.strictEqual(Ids.encode(ids), ids);
    assert.throws(() => Ids.encode([1, '2']), { code: 'type', path: '[1]' });
    assert.throws(() => Ids.encode([1, null]), { code: 'type', path: '[1]' });
    const Any = Schema.from({ array: 'json' }, options);
    const any = [1, null, 'x'];
    assert.strictEqual(Any.encode(any), any);
    const Rows = Schema.from({ id: 'number' }, options).list;
    assert.throws(() => Rows.encode([{ id: 1 }, {}]), { code: 'required', path: '[1].id' });
    assert.throws(() => Rows.encode([{ id: 1 }, null]), { code: 'type', path: '[1]' });
    for (const layout of ['flat', 'columns']) {
      const Grid = Schema.from({ array: { id: 'number' } }, { ...options, layout });
      assert.throws(() => Grid.encode([{ id: 1 }, { id: 'x' }]), { code: 'type', path: '[1].id' });
    }
    const Pair = Schema.from(['number', 'string'], options);
    assert.throws(() => Pair.encode([1]), { code: 'required', path: '[1]' });
    const Sparse = Schema.from({ a: 'number', b: '?string' }, { ...options, sparse: true });
    assert.throws(() => Sparse.encode({ b: 'x' }), { code: 'required', path: 'a' });
    assert.throws(() => Sparse.encode({ a: 1, b: 2 }), { code: 'type', path: 'b' });
  });

  test(`Errors (${backend}): a trusting codec carries no encode checks`, () => {
    const definition = {
      id: 'number',
      role: { enum: ['a'] },
      list: { array: 'string' },
      rows: { array: { at: 'date' } },
      pair: ['number', 'string'],
    };
    const codec = Schema.from(definition, { ...options, validate: false })[
      Symbol.for('alexify.protoarray.codec')
    ];
    if (backend === 'codegen') {
      for (const needle of ["'required'", "'type'", "'enum'", '.accept(']) {
        assert.ok(!codec.source.includes(needle), needle);
      }
      const strict = Schema.from(definition, options)[Symbol.for('alexify.protoarray.codec')];
      assert.ok(strict.source.includes("'required'"));
    }
    assert.deepStrictEqual(codec.encode({ id: 'x', role: 'b', list: [1], rows: [{}], pair: [] }), [
      'x',
      null,
      [1],
      [[null]],
      [null, null],
    ]);
  });

  test(`Errors (${backend}): decode without validation never converts a stray value`, () => {
    const schema = Schema.from(
      { at: 'date', perms: { flags: ['a'] }, n: 'bigint', role: { enum: ['x'] } },
      { ...options, validate: false },
    );
    assert.deepStrictEqual(schema.decode([1n, 1n, 1n, 1n]), { at: 1n, perms: 1n, n: 1n, role: 1n });
    assert.deepStrictEqual(schema.decode(['now', 'a', 'z', 'x']), {
      at: 'now',
      perms: 'a',
      n: 'z',
      role: 'x',
    });
    const symbol = Symbol('s');
    assert.strictEqual(schema.decode([symbol]).at, symbol);
  });

  test(`Errors (${backend}): decode errors name the schema`, () => {
    const User = new Schema('User', { id: 'number', home: { city: 'string' } }, options);
    assert.throws(() => User.decode([]), { code: 'required', path: 'id', schema: 'User' });
    assert.throws(() => User.decode([1, [2]]), { path: 'home.city', schema: 'User' });
    assert.throws(() => User.parse('{'), { code: 'json', schema: 'User' });
    assert.throws(() => User.list.decode([[1, ['Kyiv']], []]), { path: '[1].id', schema: 'User' });
    assert.throws(() => Schema.from({ id: 'number' }, options).decode([]), { schema: '' });
  });
}

// The boundary of a schema turns a stack overflow into a decode error and
// leaves any other foreign error alone.
test('Errors: the decode boundary', () => {
  const schema = Schema.from({ id: 'number' });
  const codec = schema[Symbol.for('alexify.protoarray.codec')];
  const { decode } = codec;
  try {
    codec.decode = () => {
      throw new TypeError('foreign');
    };
    assert.throws(() => schema.decode([1]), { name: 'TypeError', message: 'foreign' });
    const overflow = new Error('too much recursion');
    overflow.name = 'InternalError';
    codec.decode = () => {
      throw overflow;
    };
    assert.throws(() => schema.decode([1]), {
      code: 'structure',
      message: 'Value is nested too deeply',
    });
  } finally {
    codec.decode = decode;
  }
});

// A cyclic value, or one nested deeper than the call stack, is a value the
// schema cannot encode: an encode error like any other, never a RangeError.
for (const [backend, options] of BACKENDS) {
  test(`Errors (${backend}): a value nested too deeply to encode is an encode error`, () => {
    const Node = new Schema('Node', { v: 'number', kids: { array: 'Node' } }, options);
    const expected = {
      name: 'EncodeError',
      code: 'depth',
      path: '',
      schema: 'Node',
      message: 'Value is nested too deeply',
    };
    let value = { v: 1, kids: [] };
    for (let i = 0; i < 100000; i++) value = { v: 1, kids: [value] };
    assert.throws(() => Node.encode(value), expected);
    const cycle = { v: 1, kids: [] };
    cycle.kids.push(cycle);
    assert.throws(() => Node.encode(cycle), expected);
    assert.throws(() => Node.stringify(cycle), expected);
    const Loose = new Schema('Node', Node.definition, { ...options, validate: false });
    assert.throws(() => Loose.encode(cycle), expected);
  });
}
