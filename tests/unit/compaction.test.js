const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { BACKENDS, normalize } = require('../support/backends.js');

for (const [backend, options] of BACKENDS) {
  const both = { ...options, validate: 'both' };
  const loose = { ...options, validate: false };

  test(`Delta (${backend}): columns of integers, dates and decimals`, () => {
    const record = {
      id: { type: 'integer', delta: true },
      at: { type: 'date', delta: true, required: false },
      price: { type: 'number', decimals: 2, delta: true },
      n: { type: 'number', delta: true },
      name: 'string',
    };
    const C = Schema.from({ array: record }, { ...options, layout: 'columns' });
    assert.strictEqual(
      C.toString(),
      'columns[{id:integer~,at:?date~,price:number(2)~,n:number~,name:string}]',
    );
    const rows = [
      { id: 100, at: new Date(1000), price: 1.5, n: 7, name: 'a' },
      { id: 101, at: null, price: 1.25, n: 7, name: 'b' },
      { id: 98, at: new Date(900), price: 2, n: -3, name: 'c' },
    ];
    const wire = C.encode(rows);
    assert.deepStrictEqual(wire, [
      [100, 1, -3],
      [1000, null, -100],
      [150, -25, 75],
      [7, 0, -10],
      ['a', 'b', 'c'],
    ]);
    assert.deepStrictEqual(normalize(C.decode(wire)), normalize(rows));
    // Only integers have exact differences: checked whatever `validate` says.
    for (const schema of [C, Schema.from(C.definition, { ...loose, layout: 'columns' })]) {
      assert.throws(() => schema.encode([{ ...rows[0], n: 1.5 }]), {
        code: 'type',
        path: '[0].n',
        message: 'Field "[0].n" is not of expected type: number',
      });
      assert.throws(
        () => schema.encode([rows[0], { ...rows[1], n: Number.MAX_SAFE_INTEGER }, rows[2]]),
        {
          code: 'type',
          path: '[2].n',
        },
      );
    }
    const ids = (column) => [column, [null, null], [1, 1], [1, 1], ['a', 'b']];
    for (const column of [
      [1, 'x'],
      [1, 0.5],
      [Number.MAX_SAFE_INTEGER, 1],
    ]) {
      assert.throws(() => C.decode(ids(column)), {
        code: 'type',
        path: '[1].id',
        message: 'Field "[1].id" is not of expected type: integer',
      });
    }
    // A column that is missing is a column of nulls, as without delta.
    assert.throws(() => C.decode([[1]]), { code: 'required', path: '[0].price' });
    const Loose = Schema.from(C.definition, { ...loose, layout: 'columns' });
    const looseRows = Loose.decode([[1, 'x', 2], null, [1, 1, 1], [0, 0, 0], ['a', 'b', 'c']]);
    assert.deepStrictEqual(
      looseRows.map((row) => row.id),
      [1, 'x', 3],
    );
    // Outside columns `delta` changes nothing on the wire.
    const Rows = Schema.from({ array: record }, options);
    assert.deepStrictEqual(Rows.encode(rows)[1], [101, null, 125, 7, 'b']);
    const Flat = Schema.from({ array: record }, { ...options, layout: 'flat' });
    assert.deepStrictEqual(Flat.encode(rows).slice(0, 5), [100, 1000, 150, 7, 'a']);
  });

  test(`Delta (${backend}): lists of integers`, () => {
    const S = Schema.from(
      {
        ids: { array: 'integer', delta: true },
        at: { type: 'array', value: '?date', delta: true, required: false },
        prices: { array: { type: 'number', decimals: 2 }, delta: true },
      },
      both,
    );
    assert.strictEqual(S.toString(), '{ids:~[integer],at:?~[?date],prices:~[number(2)]}');
    const value = { ids: [5, 7, 6], at: [new Date(10), null, new Date(4)], prices: [1.5, 1.75] };
    const wire = S.encode(value);
    assert.deepStrictEqual(wire, [
      [5, 2, -1],
      [10, null, -6],
      [150, 25],
    ]);
    assert.deepStrictEqual(normalize(S.decode(wire)), normalize(value));
    assert.deepStrictEqual(S.encode({ ids: [], prices: [] }), [[], null, []]);
    for (const ids of [
      [1.5],
      [null],
      ['1'],
      'x',
      [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ]) {
      assert.throws(() => S.encode({ ids, prices: [] }), {
        code: 'type',
        path: 'ids',
        message: 'Field "ids" is not of expected type: [integer]',
      });
    }
    // Checked on encode whatever `validate` says.
    const Loose = Schema.from(S.definition, loose);
    assert.throws(() => Loose.encode({ ids: [0.5], prices: [] }), { code: 'type', path: 'ids' });
    assert.deepStrictEqual(Loose.encode({ ids: [2], prices: [] }), [[2], null, []]);
    for (const ids of [[1.5], [null], ['x'], 'x', [Number.MAX_SAFE_INTEGER, 1]]) {
      assert.throws(() => S.decode([ids, null, []]), { code: 'type', path: 'ids' });
    }
    assert.deepStrictEqual(Loose.decode([[1, 'x', 2], null, 'y']), {
      ids: [1, 'x', 3],
      at: null,
      prices: 'y',
    });
    for (const definition of [
      { a: { array: 'string', delta: true } },
      { a: { array: 'integer', delta: 1 } },
      { a: { set: 'integer', delta: true } },
      { a: { type: 'string', delta: true } },
      { a: { type: 'boolean', delta: false } },
    ]) {
      assert.throws(() => Schema.from(definition), {
        code: 'ERR_INVALID_DEFINITION',
        message: 'delta is true on an integer, a number, a date or decimals at "a"',
      });
    }
    assert.throws(() => Schema.from({ a: { set: 'integer', delta: true } }), {
      code: 'ERR_INVALID_DEFINITION',
    });
  });

  test(`Intern (${backend}): one string table per message`, () => {
    const Address = Schema.from(
      { city: { type: 'string', intern: true }, street: 'string' },
      options,
    );
    const User = new Schema(
      'User',
      {
        name: 'string',
        role: { type: 'string', intern: true },
        home: Address,
        work: '?Address',
        tags: { array: { type: 'string', intern: true } },
      },
      { ...both, schemas: { Address } },
    );
    assert.strictEqual(
      User.toString(),
      '{name:string,role:string*,home:{city:string*,street:string},work:?@Address,tags:[string*]}',
    );
    const value = {
      name: 'Alex',
      role: 'admin',
      home: { city: 'Kyiv', street: 'A' },
      work: { city: 'Kyiv', street: 'B' },
      tags: ['admin', 'x'],
    };
    const wire = User.encode(value);
    assert.deepStrictEqual(wire, [
      ['admin', 'Kyiv', 'x'],
      ['Alex', 0, [1, 'A'], [1, 'B'], [0, 2]],
    ]);
    assert.deepStrictEqual(User.decode(wire), value);
    assert.strictEqual(User.stringify(value), JSON.stringify(wire));
    assert.deepStrictEqual(User.parse(JSON.stringify(wire)), value);
    // A list shares one table; a schema used on its own has its own.
    assert.deepStrictEqual(User.list.encode([value, { ...value, role: 'guest' }])[0], [
      'admin',
      'Kyiv',
      'x',
      'guest',
    ]);
    assert.deepStrictEqual(Address.encode({ city: 'Lviv', street: 'S' }), [['Lviv'], [0, 'S']]);
    assert.strictEqual(User.check(value), null);
    assert.strictEqual(User.check({ ...value, role: 1 }).path, 'role');
    assert.throws(() => User.encode({ ...value, role: 1 }), { code: 'type', path: 'role' });
    for (const bad of [null, [], [[]], [['a'], [], 1], {}, [{}, []]]) {
      assert.throws(() => User.decode(bad), {
        code: 'structure',
        message: 'Value is not an interned payload: [table, body]',
      });
    }
    assert.throws(() => User.decode([[1], ['A', 0, [0, 'x'], null, []]]), { code: 'structure' });
    for (const index of [5, -1, 0.5, 'admin']) {
      assert.throws(() => User.decode([['admin'], ['A', index, [0, 'x'], null, []]]), {
        code: 'type',
        path: 'role',
        message: 'Field "role" is not of expected type: string',
      });
    }
    // Trusted, a stray index or table passes through.
    const Loose = new Schema('User', User.definition, { ...loose, schemas: { Address } });
    assert.deepStrictEqual(Loose.decode([[1], ['A', 5, [0, 'x'], null, []]]).role, 5);
    assert.deepStrictEqual(Loose.decode([[1], ['A', 0, [0, 'x'], null, []]]).role, 1);
    assert.deepStrictEqual(Loose.decode([[1], ['A', 'q', [0, 'x'], null, []]]).role, 'q');
    assert.deepStrictEqual(Loose.encode({ ...value, role: 1 })[0][0], 1);
  });

  test(`Intern (${backend}): the schema option, opting out, and recursion`, () => {
    const S = Schema.from(
      {
        a: 'string',
        b: { type: 'string', intern: false },
        c: ['string', '?string'],
        d: { map: { string: 'string' } },
        e: { enum: ['x'] },
      },
      { ...options, intern: true },
    );
    assert.strictEqual(
      S.toString(),
      '{a:string*,b:string,c:(string*,?string*),d:map<string,string*>,e:enum(x)}',
    );
    const value = { a: 'k', b: 'k', c: ['k', 'm'], d: new Map([['key', 'm']]), e: 'x' };
    const wire = S.encode(value);
    assert.deepStrictEqual(wire, [
      ['k', 'm'],
      [0, 'k', [0, 1], ['key', 1], 0],
    ]);
    assert.deepStrictEqual(normalize(S.decode(wire)), normalize(value));
    const Tree = new Schema(
      'Tree',
      { label: { type: 'string', intern: true }, kids: { array: 'Tree' } },
      options,
    );
    const tree = { label: 'a', kids: [{ label: 'b', kids: [{ label: 'a', kids: [] }] }] };
    const treeWire = Tree.encode(tree);
    assert.deepStrictEqual(treeWire, [
      ['a', 'b'],
      [0, [[1, [[0, []]]]]],
    ]);
    assert.deepStrictEqual(Tree.decode(treeWire), tree);
    for (const layout of ['flat', 'columns']) {
      const L = Schema.from(
        { array: { n: { type: 'string', intern: true } } },
        { ...options, layout },
      );
      const listWire = L.encode([{ n: 'a' }, { n: 'b' }, { n: 'a' }]);
      assert.deepStrictEqual(listWire[0], ['a', 'b']);
      assert.deepStrictEqual(L.decode(listWire), [{ n: 'a' }, { n: 'b' }, { n: 'a' }]);
    }
    assert.throws(() => Schema.from({ n: { type: 'number', intern: true } }), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'intern is a boolean on a string at "n"',
    });
    assert.throws(() => Schema.from({ n: { type: 'string', intern: 1 } }), {
      code: 'ERR_INVALID_DEFINITION',
    });
    assert.throws(() => Schema.from({ n: 'string' }, { intern: 'yes' }), {
      code: 'ERR_INVALID_OPTIONS',
    });
  });

  test(`Intern (${backend}): a call from inside another starts its own table`, () => {
    const Inner = Schema.from({ s: { type: 'string', intern: true } }, options);
    const Outer = Schema.from({ s: { type: 'string', intern: true }, raw: 'json' }, both);
    let inner;
    const value = {
      s: 'outer',
      get raw() {
        inner = Inner.encode({ s: 'inner' });
        return Inner.decode([['x'], [0]]);
      },
    };
    assert.deepStrictEqual(Outer.encode(value), [['outer'], [0, { s: 'x' }]]);
    assert.deepStrictEqual(inner, [['inner'], [0]]);
    // A failed call leaves no table behind.
    assert.throws(() => Outer.encode({ s: 1, raw: null }), { code: 'type' });
    assert.deepStrictEqual(Inner.encode({ s: 'y' }), [['y'], [0]]);
  });
}

for (const [backend, options] of BACKENDS) {
  test(`Delta and intern (${backend}): resolved across wires`, () => {
    const W = Schema.from(
      {
        s: { type: 'string', intern: true },
        plain: 'string',
        n: { type: 'integer', delta: true },
        d: { array: 'integer', delta: true },
        p: { array: 'integer' },
      },
      options,
    );
    const R = Schema.resolve(
      W,
      Schema.from(
        {
          s: 'string',
          plain: { type: 'string', intern: true },
          n: 'integer',
          d: { array: 'integer' },
          p: { array: 'integer', delta: true },
        },
        options,
      ),
    );
    // The writer's wire: its table, its differences.
    const wire = W.encode({ s: 'x', plain: 'y', n: 1, d: [1, 2], p: [3, 4] });
    assert.deepStrictEqual(wire, [['x'], [0, 'y', 1, [1, 1], [3, 4]]]);
    assert.deepStrictEqual(R.decode(wire), { s: 'x', plain: 'y', n: 1, d: [1, 2], p: [3, 4] });
    assert.deepStrictEqual(R.encode({ s: 'z', plain: 'q', n: 2, d: [5, 7], p: [6] }), [
      ['z'],
      [0, 'q', 2, [5, 2], [6]],
    ]);
    // A delta column the reader does not have is still the writer's.
    const C = Schema.from(
      { array: { id: 'integer', n: { type: 'number', delta: true } } },
      { ...options, layout: 'columns' },
    );
    const RC = Schema.resolve(C, Schema.from({ array: { id: 'integer' } }, options));
    assert.deepStrictEqual(
      RC.decode(
        C.encode([
          { id: 1, n: 5 },
          { id: 2, n: 7 },
        ]),
      ),
      [{ id: 1 }, { id: 2 }],
    );
    assert.deepStrictEqual(RC.encode([{ id: 1 }]), [[1], [null]]);
    assert.throws(
      () =>
        RC.decode([
          [1, 2],
          [5, 'x'],
        ]),
      { code: 'type', path: '[1].n' },
    );
  });
}
