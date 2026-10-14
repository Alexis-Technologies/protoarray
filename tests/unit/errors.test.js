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
        items: { array: { sku: 'string' } },
        home: { city: 'string' },
        pair: ['number', 'string'],
        grid: { array: { array: 'number' } },
        tags: { array: 'string' },
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

  // A conversion that throws on its own (a Date from a BigInt) is the
  // caller's bug, not a wire problem: it is neither wrapped nor re-pathed.
  test(`Errors (${backend}): errors that are not encode errors pass through`, () => {
    const foreign = (error) =>
      error instanceof TypeError && !(error instanceof EncodeError) && error.code === undefined;
    const schema = Schema.from(
      { inner: { at: 'date' }, list: { array: { at: 'date' } }, pair: ['date', 'number'] },
      options,
    );
    assert.throws(() => schema.encode({ inner: { at: 1n } }), foreign);
    assert.throws(() => schema.encode({ list: [{ at: 1n }] }), foreign);
    assert.throws(() => schema.encode({ pair: [1n, 1] }), foreign);
    const Flat = Schema.from({ array: { at: 'date' } }, { ...options, layout: 'flat' });
    assert.throws(() => Flat.encode([{ at: 1n }]), foreign);
    const Cols = Schema.from({ array: { at: 'date' } }, { ...options, layout: 'columns' });
    assert.throws(() => Cols.encode([{ at: 1n }]), foreign);
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

test('Errors: a value nested too deeply to encode is the caller’s problem', () => {
  const Node = new Schema('Node', { v: 'number', kids: { array: 'Node' } });
  let value = { v: 1, kids: [] };
  for (let i = 0; i < 100000; i++) value = { v: 1, kids: [value] };
  assert.throws(() => Node.encode(value), RangeError);
});
