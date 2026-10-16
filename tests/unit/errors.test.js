const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { Schema, DecodeError, EncodeError } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');
const { define, named, model } = require('../support/schema.js');

for (const [backend, options] of BACKENDS) {
  test(`Errors (${backend}): decode errors carry a code, a path and a message`, () => {
    const User = define(
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
    const Tree = define(
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
    const List = define({ array: { v: 'number' } }, options);
    assert.throws(() => List.decode([[1], ['x']]), { path: '[1].v' });
    assert.throws(() => List.decode([[1], 2]), {
      path: '[1]',
      message: 'Field "[1]" is not an array',
    });
  });

  test(`Errors (${backend}): parse wraps invalid JSON`, () => {
    const schema = define({ id: 'number' }, options);
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
    const schema = define(
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
    const Node = named('Node', { v: 'number', kids: { array: 'Node' } }, options);
    const levels = (depth) => `${'[1,['.repeat(depth - 1)}[1,[]]${']]'.repeat(depth - 1)}`;
    const text = levels(100000);
    // By default nothing is counted: the stack is the limit, and running out
    // of it is a decode error with no path.
    const expected = {
      name: 'DecodeError',
      code: 'structure',
      schema: 'Node',
      message: 'Value is nested too deeply',
    };
    assert.throws(() => Node.parse(text), expected);
    assert.throws(() => Node.decode(JSON.parse(text)), expected);
    assert.throws(() => Node.list.parse(`[${text}]`), expected);
    const long = levels(600);
    assert.strictEqual(JSON.stringify(Node.encode(Node.parse(long))), long);
  });

  test(`Errors (${backend}): maxDepth counts the levels of a recursion`, () => {
    const limit = { ...options, maxDepth: 512 };
    const Node = named('Node', { v: 'number', kids: { array: 'Node' } }, limit);
    const levels = (depth) => `${'[1,['.repeat(depth - 1)}[1,[]]${']]'.repeat(depth - 1)}`;
    const text = levels(100000);
    // The same depth is too deep on either backend, at the place it is reached.
    const expected = {
      name: 'DecodeError',
      code: 'structure',
      schema: 'Node',
      message: /^Field "kids\[0\]\.kids\[0\][^"]*\[…\][^"]*" is nested too deeply$/,
    };
    assert.throws(() => Node.parse(text), expected);
    assert.throws(() => Node.decode(JSON.parse(text)), expected);
    assert.throws(() => Node.list.parse(`[${text}]`), {
      ...expected,
      message: /nested too deeply/,
    });
    // Up to the limit is fine.
    const fine = levels(512);
    assert.strictEqual(JSON.stringify(Node.encode(Node.parse(fine))), fine);
    assert.throws(() => Node.parse(`[1,[${fine}]]`), { code: 'structure' });
    let deep = { v: 1, kids: [] };
    for (let i = 1; i < 512; i++) deep = { v: 1, kids: [deep] };
    assert.strictEqual(JSON.stringify(Node.encode(deep)), fine);
    assert.throws(() => Node.encode({ v: 1, kids: [deep] }), {
      code: 'depth',
      message: /^Field "kids\[0\][^"]*" is nested too deeply$/,
    });
    // Another limit, the same rule; a list, a resolved schema and the
    // entities of a model take it.
    const Short = Schema.from(Node, { ...options, maxDepth: 3 });
    assert.deepStrictEqual(Short.decode(JSON.parse(levels(3))), Node.decode(JSON.parse(levels(3))));
    assert.throws(() => Short.decode(JSON.parse(levels(4))), { code: 'structure' });
    assert.throws(() => Short.list.decode([JSON.parse(levels(4))]), { code: 'structure' });
    const Built = Schema.from(Node, { ...options, maxDepth: 3, stringify: 'builder' });
    assert.strictEqual(Built.stringify(Built.parse(levels(3))), levels(3));
    assert.throws(() => Built.stringify(Node.parse(levels(4))), { code: 'depth' });
    const { Outer } = model(
      {
        Node: { Struct: {}, v: 'number', kids: { array: 'Node' } },
        Outer: { Struct: {}, root: 'Node' },
      },
      limit,
    );
    assert.throws(() => Outer.parse(`[${text}]`), {
      ...expected,
      schema: 'Outer',
      message: /^Field "root\.kids\[0\][^"]*" is nested too deeply$/,
    });
    const { Outer: Own } = model(
      {
        Node: { Struct: {}, v: 'number', kids: { array: 'Node' } },
        Outer: { Struct: {}, root: 'Node' },
      },
      { ...options, entities: { Node: { maxDepth: 3 } } },
    );
    assert.throws(() => Own.decode([JSON.parse(levels(4))]), {
      code: 'structure',
      message: /^Field "root\.kids\[0\]\.kids\[0\]\.kids\[0\]" is nested too deeply$/,
    });
    for (const maxDepth of [0, -1, 1.5, NaN, '512', null]) {
      assert.throws(() => Schema.from(Node, { ...options, maxDepth }), {
        code: 'ERR_INVALID_OPTIONS',
      });
    }
  });

  test(`Errors (${backend}): encode errors carry a code, a path and the schema name`, () => {
    const Order = named(
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
    const Numbers = define({ array: 'number' }, options);
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

  // A conversion that throws on its own (a Date from a BigInt) is the caller's
  // bug, not a wire problem: it is neither wrapped nor re-pathed. Checking the
  // values is metaschema's.
  test(`Errors (${backend}): errors that are not encode errors pass through`, () => {
    const foreign = (error) =>
      error instanceof TypeError && !(error instanceof EncodeError) && error.code === undefined;
    const definition = {
      'inner?': { at: 'date' },
      'list?': { array: { at: 'date' } },
      'pair?': ['date', 'number'],
    };
    const loose = { ...options, validate: false };
    const schema = define(definition, loose);
    // A value whose own conversion throws: the caller's error, as it is.
    const at = {
      [Symbol.toPrimitive]() {
        throw new TypeError('no number here');
      },
    };
    assert.throws(() => schema.encode({ inner: { at } }), foreign);
    assert.throws(() => schema.encode({ list: [{ at }] }), foreign);
    assert.throws(() => schema.encode({ pair: [at, 1] }), foreign);
    const Flat = define({ array: { at: 'date' } }, { ...loose, layout: 'flat' });
    assert.throws(() => Flat.encode([{ at }]), foreign);
    const Cols = define({ array: { at: 'date' } }, { ...loose, layout: 'columns' });
    assert.throws(() => Cols.encode([{ at }]), foreign);
    // By default the values are trusted too: the conversion throws on its own.
    const schemaByDefault = define(definition, options);
    assert.throws(() => schemaByDefault.encode({ inner: { at } }), foreign);
    assert.throws(() => schemaByDefault.encode({ list: [{ at }] }), foreign);
    assert.throws(() => schemaByDefault.encode({ pair: [at, 1] }), foreign);
    const FlatByDefault = define({ array: { at: 'date' } }, { ...options, layout: 'flat' });
    assert.throws(() => FlatByDefault.encode([{ at }]), foreign);
    // A value that converts to no number at all has no date wire form.
    for (const value of [1n, Symbol('at')]) {
      assert.deepStrictEqual(schemaByDefault.encode({ inner: { at: value } }), [[null]]);
    }
  });

  // Checking the values given to encode is metaschema's (`schema.source.check`):
  // encode trusts them, converts what it knows and writes the rest as it is,
  // with or without validation of the wire.
  test(`Errors (${backend}): encode trusts the values it is given`, () => {
    const definition = {
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
    };
    const User = named('User', definition, options);
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
    // Values metaschema would reject: each one encodes, as it did in 1.0.
    const patches = [
      { id: undefined },
      { id: '1' },
      { id: NaN },
      { id: Infinity },
      { name: 5 },
      { active: 1 },
      { role: null },
      { role: 'root' },
      { code: '20' },
      { at: 'now' },
      { at: new Date(NaN) },
      { at: Infinity },
      { n: 1.5 },
      { n: '1e3' },
      { perms: 1 },
      { address: undefined },
      { address: {} },
      { address: { city: 'Kyiv', zip: 1 } },
      { orders: null },
      { orders: [{ sku: 'a', qty: 1 }, { sku: 'b' }] },
      {
        orders: [
          { sku: 'a', qty: 1 },
          { sku: 2, qty: 1 },
        ],
      },
      { orders: [{ sku: 'a', qty: 1 }, null] },
      { tags: ['a', 1] },
      { tags: ['a', null] },
      { notes: ['a', 1] },
      { point: [null] },
      { point: [1, 2] },
      { point: null },
    ];
    for (const validate of [true, false]) {
      const Trusting = named('User', definition, { ...options, validate });
      for (const patch of patches) assert.ok(Array.isArray(Trusting.encode({ ...ok, ...patch })));
      assert.deepStrictEqual(Trusting.encode({ ...ok, role: 'root', id: '1' }).slice(0, 4), [
        '1',
        'Alex',
        true,
        null,
      ]);
      assert.deepStrictEqual(Trusting.encode(ok), User.encode(ok));
    }
    // The lossless spellings of a type and what the optional slots hold.
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
    assert.deepStrictEqual(User.encode(loose).slice(13), [['a', null], null, [1, null]]);
    assert.deepStrictEqual(User.encode({ ...ok, n: 7n })[6], '7');
    assert.deepStrictEqual(User.encode({ ...ok, at: new Date(9) })[5], 9);
    // metaschema checks what encode trusts.
    assert.strictEqual(User.source.check({ ...ok, balance: 0 }).valid, true);
    assert.strictEqual(User.source.check({ ...ok, balance: 0, id: '1' }).valid, false);
    // Decode checks the wire unless told to trust it.
    assert.throws(() => User.decode(['1']), { code: 'type', path: 'id' });
    const Loose = named('User', definition, { ...options, validate: false });
    assert.strictEqual(Loose.decode(['1']).id, '1');
  });

  test(`Errors (${backend}): encode trusts roots and collections`, () => {
    assert.strictEqual(define('string', options).encode(5), 5);
    assert.strictEqual(define('string', options).encode(undefined), null);
    assert.strictEqual(define('string', { ...options, validate: false }).encode(5), 5);
    assert.strictEqual(define('number', options).encode(NaN), NaN);
    assert.strictEqual(define('?number', options).encode(null), null);
    const blob = { any: [1] };
    assert.strictEqual(define('json', options).encode(blob), blob);
    const Ids = define({ array: 'number' }, options);
    const ids = [1, 2];
    assert.strictEqual(Ids.encode(ids), ids);
    assert.deepStrictEqual(Ids.encode([1, '2']), [1, '2']);
    const Any = define({ array: 'json' }, options);
    const any = [1, null, 'x'];
    assert.strictEqual(Any.encode(any), any);
    const Rows = define({ id: 'number' }, options).list;
    assert.deepStrictEqual(Rows.encode([{ id: 1 }, {}, null]), [[1], [null], null]);
    for (const layout of ['flat', 'columns']) {
      const Grid = define({ array: { id: 'number' } }, { ...options, layout });
      assert.ok(Array.isArray(Grid.encode([{ id: 1 }, { id: 'x' }])), layout);
      // A row that is not a record is a shape the layout cannot write.
      assert.throws(() => Grid.encode([{ id: 1 }, 5]), { code: 'object', path: '[1]' });
    }
    assert.deepStrictEqual(define(['number', 'string'], options).encode([1]), [1, null]);
    const Sparse = define({ a: 'number', b: '?string' }, { ...options, sparse: true });
    assert.deepStrictEqual(Sparse.encode({ b: 'x' }), [2, 'x']);
    assert.deepStrictEqual(Sparse.encode({ a: 1, b: 2 }), [3, 1, 2]);
  });

  // Checks are compiled out of a codec that does not ask for them: the
  // default codec carries the decode checks only, a trusting one none, and
  // neither checks the values given to encode.
  test(`Errors (${backend}): a codec carries only the checks its mode asks for`, () => {
    const definition = {
      id: 'number',
      role: { enum: ['a'] },
      list: { array: 'string' },
      rows: { array: { at: 'date' } },
      pair: ['number', 'string'],
      perms: { flags: ['a'] },
    };
    const CODEC = Symbol.for('alexify.protoarray.codec');
    const codec = define(definition, { ...options, validate: false })[CODEC];
    if (backend === 'codegen') {
      // E throws an encode error, F a decode error.
      const encodeChecks = ['E("required"', 'E("type"', 'E("enum"', '.accept(', '.checkedPack('];
      const decodeChecks = ["F('required'", 'F("type"', 'F("enum"', '.checkedUnpack('];
      for (const needle of [...encodeChecks, ...decodeChecks]) {
        assert.ok(!codec.source.includes(needle), needle);
      }
      const byDefault = define(definition, options)[CODEC];
      for (const needle of encodeChecks) assert.ok(!byDefault.source.includes(needle), needle);
      for (const needle of decodeChecks) assert.ok(byDefault.source.includes(needle), needle);
    }
    assert.deepStrictEqual(codec.encode({ id: 'x', role: 'b', list: [1], rows: [{}], pair: [] }), [
      'x',
      null,
      [1],
      [[null]],
      [null, null],
      null,
    ]);
  });

  test(`Errors (${backend}): decode without validation never converts a stray value`, () => {
    const schema = define(
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
    const User = named('User', { id: 'number', home: { city: 'string' } }, options);
    assert.throws(() => User.decode([]), { code: 'required', path: 'id', schema: 'User' });
    assert.throws(() => User.decode([1, [2]]), { path: 'home.city', schema: 'User' });
    assert.throws(() => User.parse('{'), { code: 'json', schema: 'User' });
    assert.throws(() => User.list.decode([[1, ['Kyiv']], []]), { path: '[1].id', schema: 'User' });
    assert.throws(() => define({ id: 'number' }, options).decode([]), { schema: '' });
  });
}

// The boundary of a schema turns a stack overflow into a decode error and
// leaves any other foreign error alone.
test('Errors: the decode boundary', () => {
  const schema = define({ id: 'number' });
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
    // Only an exhausted call stack is a depth problem; any other RangeError is foreign.
    codec.decode = () => {
      throw new RangeError('Maximum call stack size exceeded');
    };
    assert.throws(() => schema.decode([1]), { code: 'structure', path: '' });
    codec.decode = () => {
      throw new RangeError('Invalid array length');
    };
    assert.throws(() => schema.decode([1]), {
      name: 'RangeError',
      message: 'Invalid array length',
    });
  } finally {
    codec.decode = decode;
  }
  // Encode the same: a recursion counts its levels, any other stack that runs
  // out (a chain of entities deeper than the stack) is a depth error too.
  const { encode } = codec;
  try {
    codec.encode = () => {
      throw new RangeError('Maximum call stack size exceeded');
    };
    assert.throws(() => schema.encode({ id: 1 }), { name: 'EncodeError', code: 'depth' });
  } finally {
    codec.encode = encode;
  }
});

// A cyclic value, or one nested deeper than the call stack, is a value the
// schema cannot encode: an encode error like any other, never a RangeError.
// With maxDepth it is found at the limit, with its path.
for (const [backend, options] of BACKENDS) {
  test(`Errors (${backend}): a value nested too deeply to encode is an encode error`, () => {
    const definition = { v: 'number', kids: { array: 'Node' } };
    let value = { v: 1, kids: [] };
    for (let i = 0; i < 100000; i++) value = { v: 1, kids: [value] };
    const cycle = { v: 1, kids: [] };
    cycle.kids.push(cycle);
    for (const [limit, message] of [
      [{}, 'Value is nested too deeply'],
      [{ maxDepth: 512 }, /^Field "kids\[0\][^"]*" is nested too deeply$/],
    ]) {
      const Node = named('Node', definition, { ...options, ...limit });
      const expected = { name: 'EncodeError', code: 'depth', schema: 'Node', message };
      assert.throws(() => Node.encode(value), expected);
      assert.throws(() => Node.encode(cycle), expected);
      assert.throws(() => Node.stringify(cycle), expected);
      const Loose = Schema.from(Node, { ...options, ...limit, validate: false });
      assert.throws(() => Loose.encode(cycle), expected);
    }
  });
}

// What a value given to encode may be: a lookup never throws over it, a fake
// byte array is not one, and an array is not a record.
for (const [backend, options] of BACKENDS) {
  test(`Errors (${backend}): enum and union lookups never throw over the value`, () => {
    const hostile = [
      Object.create(null),
      [Symbol('s')],
      {
        toString() {
          throw new Error('boom');
        },
      },
      Symbol('x'),
      1n,
    ];
    const E = define({ role: { enum: ['a', 'b'] } }, options);
    const P = define({ union: [{ k: { enum: ['a'] } }], discriminator: 'k' }, options);
    for (const value of hostile) {
      // An enum value outside the enum travels as null; the discriminator of a
      // union picks the branch, so one outside the union cannot be written.
      assert.deepStrictEqual(E.encode({ role: value }), [null]);
      assert.throws(() => P.encode({ k: value }), { code: 'union', path: 'k' });
    }
  });

  test(`Errors (${backend}): only a real byte array is one`, () => {
    const B = define({ data: 'bytes' }, options);
    // What is not a byte array is trusted and travels as it is.
    const fake = { [Symbol.toStringTag]: 'Uint8Array', length: 1 };
    assert.deepStrictEqual(B.encode({ data: fake }), [fake]);
    const clamped = new Uint8ClampedArray(1);
    assert.strictEqual(B.encode({ data: clamped })[0], clamped);
    const view = new DataView(new ArrayBuffer(1));
    assert.strictEqual(B.encode({ data: view })[0], view);
    // A view from another realm and a subclass are byte arrays.
    const foreign = vm.runInNewContext('new Uint8Array([1, 2])');
    assert.deepStrictEqual(B.encode({ data: foreign }), ['AQI=']);
    class Bytes extends Uint8Array {}
    assert.deepStrictEqual(B.encode({ data: Bytes.from([1, 2]) }), ['AQI=']);
  });

  test(`Errors (${backend}): an array is not a record`, () => {
    for (const validate of [true, false]) {
      const mode = { ...options, validate };
      const User = named('User', { id: 'number', home: { city: 'string' } }, mode);
      assert.throws(() => User.encode([1]), { code: 'object', path: '', schema: 'User' });
      assert.throws(() => User.encode({ id: 1, home: ['Kyiv'] }), { code: 'object', path: 'home' });
      assert.throws(() => User.list.encode([[1]]), { code: 'object', path: '[0]' });
      const Packet = define({ union: [{ k: { enum: ['a'] } }], discriminator: 'k' }, mode);
      assert.throws(() => Packet.encode([0]), { code: 'object', path: '' });
      const Sparse = define({ a: '?number' }, { ...mode, sparse: true });
      assert.throws(() => Sparse.encode([1]), { code: 'object', path: '' });
      const Outer = define({ s: { a: '?number' } }, { ...mode, sparse: ['s'] });
      assert.throws(() => Outer.encode({ s: [1] }), { code: 'object', path: 's' });
    }
  });
}

test('Errors: a code of the caller reads as itself, and nothing is read from a prototype', () => {
  assert.strictEqual(new DecodeError('custom', 'x').message, 'Field "x" custom');
  assert.strictEqual(new DecodeError('toString', '').message, 'Value toString');
  assert.strictEqual(new DecodeError('structure', '', 'toString').message, 'Value toString');
  assert.strictEqual(new EncodeError('constructor').message, 'Value constructor');
  assert.strictEqual(new DecodeError('schema', '', 'v1').id, 'v1');
  assert.strictEqual(new DecodeError('type', '', 'number').id, undefined);
});

test('Errors: whatever a getter throws passes through encode as it is', () => {
  const schema = define({ s: 'string' });
  for (const thrown of [null, undefined, 'text', 5]) {
    const value = {
      get s() {
        throw thrown;
      },
    };
    assert.throws(
      () => schema.encode(value),
      (error) => error === thrown,
    );
  }
});

test("Errors: a dictionary's key is the payload's, and a path carries it quoted", () => {
  const forged = 'x"\n2026-10-16 INFO admin logged in\u001b[2J';
  const cases = [
    ['plain', 'd.plain'],
    ['', 'd[""]'],
    ['[0]', 'd["[0]"]'],
    ['a.b', 'd["a.b"]'],
    [forged, `d[${JSON.stringify(forged)}]`],
    ['k'.repeat(64), `d.${'k'.repeat(64)}`],
    ['k'.repeat(100000), `d[${JSON.stringify(`${'k'.repeat(64)}…`)}]`],
  ];
  for (const [backend, options] of BACKENDS) {
    const scalars = define({ d: { type: 'object', key: 'string', value: 'number' } }, options);
    const records = define(
      { d: { type: 'object', key: 'string', value: { n: 'number' } } },
      options,
    );
    const lists = define(
      { d: { type: 'object', key: 'string', value: { array: 'date' } } },
      options,
    );
    for (const [key, path] of cases) {
      const label = `${backend} ${key.slice(0, 20)}`;
      assert.throws(() => scalars.decode([{ [key]: 'x' }]), { code: 'type', path }, label);
      assert.throws(() => records.decode([{ [key]: ['x'] }]), { path: `${path}.n` }, label);
      assert.throws(() => lists.decode([{ [key]: 5 }]), { path }, label);
      assert.throws(() => records.encode({ d: { [key]: 5 } }), { code: 'object', path }, label);
      assert.throws(
        () => scalars.decode([{ [key]: 'x' }]),
        (error) => !error.message.includes('\n') && error.message.length < 200,
        label,
      );
    }
    // At the root too.
    const root = define({ type: 'object', key: 'string', value: 'number' }, options);
    assert.throws(() => root.decode({ 'a b': 'x' }), { path: '["a b"]' }, backend);
  }
});

test('Errors: a path deeper than 64 levels keeps both its ends', () => {
  for (const [backend, options] of BACKENDS) {
    const Node = named('Node', { name: '?string', next: '?Node' }, options);
    let wire = [5];
    for (let i = 0; i < 300; i++) wire = ['x', wire];
    assert.throws(
      () => Node.decode(wire),
      (error) => {
        assert.strictEqual(error.code, 'type', backend);
        assert.strictEqual(error.path, `${'next.'.repeat(31)}next[…].${'next.'.repeat(32)}name`);
        assert.ok(error.message.includes(error.path));
        return true;
      },
    );
  }
});

// A Map, a Set or a Date is told by its brand, not by the tag it claims: a
// fake one is not one, on either backend, and a date of another type of value
// converts as encode trusts it.
test('Errors: values that claim a kind they do not have', () => {
  const fake = (tag) => ({ [Symbol.toStringTag]: tag });
  for (const [backend, options] of BACKENDS) {
    const schema = define(
      {
        'm?': { type: 'map', key: 'string', value: 'number' },
        's?': { set: 'number' },
        'd?': 'date',
      },
      options,
    );
    assert.throws(() => schema.encode({ m: fake('Map') }), { code: 'map', path: 'm' }, backend);
    assert.throws(() => schema.encode({ s: fake('Set') }), { code: 'set', path: 's' }, backend);
    assert.deepStrictEqual(
      schema.encode({ d: Object.assign(fake('Date'), { valueOf: () => 5 }) }),
      [null, null, 5],
    );
    // Of another realm, the real ones are still what they are.
    const realm = vm.runInNewContext(
      '({ m: new Map([["a", 1]]), s: new Set([2]), d: new Date(7) })',
    );
    assert.deepStrictEqual(schema.encode(realm), [['a', 1], [2], 7], backend);
    const big = define({ n: 'bigint' }, options);
    assert.deepStrictEqual(big.encode({ n: 5 }), ['5']);
    assert.deepStrictEqual(big.encode({ n: 1.5 }), [1.5]);
    const odd = Object.create(null);
    assert.strictEqual(big.encode({ n: odd })[0], odd);
  }
});
