const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { resolve } = require('../../resolve.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { define, named, model } = require('../support/schema.js');

for (const [backend, options] of BACKENDS) {
  const loose = { ...options, validate: false };

  test(`Delta (${backend}): columns of integers, dates and decimals`, () => {
    const record = {
      id: 'integer',
      at: { type: 'date', required: false },
      price: { type: 'number', decimals: 2 },
      n: 'number',
      name: 'string',
    };
    const delta = ['[].id', '[].at', '[].price', '[].n'];
    const C = define({ array: record }, { ...options, layout: 'columns', delta });
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
    for (const schema of [C, Schema.from(C, { ...loose, layout: 'columns', delta })]) {
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
    const Loose = Schema.from(C, { ...loose, layout: 'columns', delta });
    const looseRows = Loose.decode([[1, 'x', 2], null, [1, 1, 1], [0, 0, 0], ['a', 'b', 'c']]);
    assert.deepStrictEqual(
      looseRows.map((row) => row.id),
      [1, 'x', 3],
    );
    // Outside columns `delta` marks a lone number's form, as 1.x did, and
    // changes nothing on the wire.
    const Rows = define({ array: record }, { ...options, delta });
    assert.deepStrictEqual(Rows.encode(rows)[1], [101, null, 125, 7, 'b']);
    const Flat = define({ array: record }, { ...options, layout: 'flat', delta });
    assert.deepStrictEqual(Flat.encode(rows).slice(0, 5), [100, 1000, 150, 7, 'a']);
  });

  test(`Delta (${backend}): lists of decimals take only numbers they can scale`, () => {
    const Prices = define(
      { p: { array: { type: 'number', decimals: 2 } } },
      { ...options, delta: ['p'] },
    );
    assert.strictEqual(Prices.toString(), '{p:~[number(2)]}');
    assert.deepStrictEqual(Prices.encode({ p: [1.5, 1.75] }), [[150, 25]]);
    assert.deepStrictEqual(Prices.decode([[150, 25]]), { p: [1.5, 1.75] });
    for (const bad of ['1.5', 1e300]) {
      assert.throws(() => Prices.encode({ p: [1, bad] }), { code: 'type', path: 'p' });
    }
  });

  test(`Delta (${backend}): lists of integers`, () => {
    const delta = ['ids', 'at', 'prices'];
    const S = define(
      {
        ids: { array: 'integer' },
        at: { type: 'array', value: '?date', required: false },
        prices: { array: { type: 'number', decimals: 2 } },
      },
      { ...options, delta },
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
    const Loose = Schema.from(S, { ...loose, delta });
    assert.throws(() => Loose.encode({ ids: [0.5], prices: [] }), { code: 'type', path: 'ids' });
    assert.deepStrictEqual(Loose.encode({ ids: [2], prices: [] }), [[2], null, []]);
    for (const ids of [[1.5], [null], ['x'], 'x', [Number.MAX_SAFE_INTEGER, 1]]) {
      assert.throws(() => S.decode([ids, null, []]), { code: 'type', path: 'ids' });
    }
    // A date of another realm is a date; an object that claims the tag is not.
    const realm = require('node:vm').runInNewContext('new Date(10)');
    assert.deepStrictEqual(S.encode({ ids: [], at: [realm], prices: [] })[1], [10]);
    const fake = { [Symbol.toStringTag]: 'Date', valueOf: () => 10 };
    assert.throws(() => S.encode({ ids: [], at: [fake], prices: [] }), {
      code: 'type',
      path: 'at',
    });
    // Values a JSON text cannot hold are checked before they are added.
    const hostile = {
      valueOf: () => {
        throw new RangeError('not a number');
      },
    };
    for (const ids of [[1n], [Symbol('x')], [hostile], [1, 2n]]) {
      assert.throws(() => S.decode([ids, null, []]), { name: 'DecodeError', code: 'type' });
    }
    assert.deepStrictEqual(Loose.decode([[1, 'x', 2], null, 'y']), {
      ids: [1, 'x', 3],
      at: null,
      prices: 'y',
    });
    // `delta` names the lists and the numbers it applies to, and only those.
    for (const a of [
      { array: 'string' },
      { set: 'integer' },
      'string',
      'boolean',
      { x: 'integer' },
    ]) {
      assert.throws(() => define({ a }, { ...options, delta: ['a'] }), {
        name: 'SchemaDefinitionError',
        code: 'ERR_INVALID_OPTIONS',
        field: 'a',
        message:
          'Option "delta" takes an integer, a number, a date or decimals, or a list of them at "a"',
      });
    }
    assert.throws(() => define({ a: { array: 'integer' } }, { ...options, delta: ['b'] }), {
      code: 'ERR_INVALID_OPTIONS',
      message: 'Option "delta" names no place of the schema at "b"',
    });
    for (const invalid of [true, 1, 'a', [1]]) {
      assert.throws(() => define({ a: { array: 'integer' } }, { ...options, delta: invalid }), {
        code: 'ERR_INVALID_OPTIONS',
        message: 'Invalid option "delta"',
      });
    }
  });

  test(`Intern (${backend}): one string table per message`, () => {
    const entities = {
      Address: { Struct: {}, city: 'string', street: 'string' },
      User: {
        Struct: {},
        name: 'string',
        role: 'string',
        home: { city: 'string', street: 'string' },
        work: '?Address',
        tags: { array: 'string' },
      },
    };
    const interned = {
      Address: { intern: ['city'] },
      User: { intern: ['role', 'home.city', 'tags[]'] },
    };
    const { Address, User } = model(entities, { ...options, entities: interned });
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
    // An embedded schema is inlined: the options it was built with stay its own.
    const Alone = define({ city: 'string', street: 'string' }, { ...options, intern: ['city'] });
    assert.strictEqual(Alone.toString(), '{city:string*,street:string}');
    assert.strictEqual(
      define({ home: Alone.source }, options).toString(),
      '{home:{city:string,street:string}}',
    );
    // The values are trusted: what is not a string goes to the table as it is.
    assert.deepStrictEqual(User.encode({ ...value, role: 1 })[0][0], 1);
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
    const Loose = model(entities, { ...loose, entities: interned }).User;
    assert.deepStrictEqual(Loose.decode([[1], ['A', 5, [0, 'x'], null, []]]).role, 5);
    assert.deepStrictEqual(Loose.decode([[1], ['A', 0, [0, 'x'], null, []]]).role, 1);
    assert.deepStrictEqual(Loose.decode([[1], ['A', 'q', [0, 'x'], null, []]]).role, 'q');
    assert.deepStrictEqual(Loose.encode({ ...value, role: 1 })[0][0], 1);
  });

  test(`Intern (${backend}): every string or the ones named, and recursion`, () => {
    const definition = {
      a: 'string',
      b: 'string',
      c: ['string', '?string'],
      d: { map: { string: 'string' } },
      e: { enum: ['x'] },
    };
    // Every string of the schema, map keys excepted.
    const All = define(definition, { ...options, intern: true });
    assert.strictEqual(
      All.toString(),
      '{a:string*,b:string*,c:(string*,?string*),d:map<string,string*>,e:enum(x)}',
    );
    const value = { a: 'k', b: 'k', c: ['k', 'm'], d: new Map([['key', 'm']]), e: 'x' };
    const all = All.encode(value);
    assert.deepStrictEqual(all, [
      ['k', 'm'],
      [0, 0, [0, 1], ['key', 1], 0],
    ]);
    assert.deepStrictEqual(normalize(All.decode(all)), normalize(value));
    // A string left out of the paths travels as it is.
    const S = define(definition, { ...options, intern: ['a', 'c[0]', 'c[1]', 'd{}'] });
    assert.strictEqual(
      S.toString(),
      '{a:string*,b:string,c:(string*,?string*),d:map<string,string*>,e:enum(x)}',
    );
    const wire = S.encode(value);
    assert.deepStrictEqual(wire, [
      ['k', 'm'],
      [0, 'k', [0, 1], ['key', 1], 0],
    ]);
    assert.deepStrictEqual(normalize(S.decode(wire)), normalize(value));
    const Tree = named(
      'Tree',
      { label: 'string', kids: { array: 'Tree' } },
      { ...options, intern: ['label'] },
    );
    const tree = { label: 'a', kids: [{ label: 'b', kids: [{ label: 'a', kids: [] }] }] };
    const treeWire = Tree.encode(tree);
    assert.deepStrictEqual(treeWire, [
      ['a', 'b'],
      [0, [[1, [[0, []]]]]],
    ]);
    assert.deepStrictEqual(Tree.decode(treeWire), tree);
    for (const layout of ['flat', 'columns']) {
      const L = define({ array: { n: 'string' } }, { ...options, layout, intern: ['[].n'] });
      const listWire = L.encode([{ n: 'a' }, { n: 'b' }, { n: 'a' }]);
      assert.deepStrictEqual(listWire[0], ['a', 'b']);
      assert.deepStrictEqual(L.decode(listWire), [{ n: 'a' }, { n: 'b' }, { n: 'a' }]);
    }
    for (const n of ['number', 'date']) {
      assert.throws(() => define({ n }, { ...options, intern: ['n'] }), {
        name: 'SchemaDefinitionError',
        code: 'ERR_INVALID_OPTIONS',
        field: 'n',
        message: 'Option "intern" takes a string at "n"',
      });
    }
    for (const n of [{ array: 'string' }, { enum: ['x'] }, { s: 'string' }]) {
      assert.throws(() => define({ n }, { ...options, intern: ['n'] }), {
        name: 'SchemaDefinitionError',
        code: 'ERR_INVALID_OPTIONS',
        field: 'n',
      });
    }
    assert.throws(() => define({ n: 'string' }, { ...options, intern: ['x'] }), {
      code: 'ERR_INVALID_OPTIONS',
      message: 'Option "intern" names no place of the schema at "x"',
    });
    for (const intern of ['yes', 1, [1], { n: true }]) {
      assert.throws(() => define({ n: 'string' }, { ...options, intern }), {
        code: 'ERR_INVALID_OPTIONS',
        message: 'Invalid option "intern"',
      });
    }
  });

  test(`Intern (${backend}): a collection in a layout of its own shares the table`, () => {
    const Outer = define(
      { items: { array: { city: 'string' } }, n: 'number' },
      { ...options, layout: { items: 'flat' }, intern: ['items[].city'] },
    );
    const value = { items: [{ city: 'Kyiv' }, { city: 'Kyiv' }], n: 1 };
    assert.strictEqual(Outer.toString(), '{items:flat[{city:string*}],n:number}');
    assert.deepStrictEqual(Outer.encode(value), [['Kyiv'], [[0, 0], 1]]);
    assert.deepStrictEqual(Outer.decode(Outer.encode(value)), value);
    // Only a string takes the option, whatever the place is.
    for (const [definition, place] of [
      [{ n: { array: 'string' } }, 'n'],
      [{ n: { enum: ['a'] } }, 'n'],
      [{ n: { s: 'string' } }, 'n'],
    ]) {
      assert.throws(() => define(definition, { ...options, intern: [place] }), {
        code: 'ERR_INVALID_OPTIONS',
        message: `Option "intern" takes a string at "${place}"`,
      });
    }
  });

  test(`Intern (${backend}): a call from inside another starts its own table`, () => {
    const Inner = define({ s: 'string' }, { ...options, intern: ['s'] });
    const Outer = define(
      { s: 'string', raw: 'json', 'o?': { x: 'number' } },
      { ...options, intern: ['s'] },
    );
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
    assert.throws(() => Outer.encode({ s: 'a', raw: null, o: 5 }), { code: 'object', path: 'o' });
    assert.deepStrictEqual(Inner.encode({ s: 'y' }), [['y'], [0]]);
  });

  test(`Intern (${backend}): a recursion between entities writes one wire, whichever is built first`, () => {
    const A = { Struct: {}, s: 'string', b: '?B' };
    const B = { Struct: {}, n: 'number', a: '?A' };
    const interned = { ...options, entities: { A: { intern: ['s'] } } };
    const value = { n: 1, a: { s: 'x', b: { n: 2, a: { s: 'x', b: null } } } };
    const wire = [['x'], [1, [0, [2, [0]]]]];
    const built = [
      model({ A, B }, interned).B,
      model({ B, A }, interned).B,
      new Schema(model({ A, B }).A.snapshot, { ...interned, entity: 'B' }),
    ];
    for (const schema of built) {
      assert.deepStrictEqual(schema.encode(value), wire);
      assert.deepStrictEqual(schema.list.encode([value]), [['x'], [[1, [0, [2, [0]]]]]]);
      for (const other of built) assert.deepStrictEqual(other.decode(schema.encode(value)), value);
      assert.strictEqual(schema.id, built[0].id);
    }
    // Both ends of the recursion carry the table, and so does an entity
    // that only calls one of them.
    const C = { Struct: {}, b: 'B' };
    const { A: a, C: c } = model({ C, A, B }, interned);
    assert.deepStrictEqual(a.encode({ s: 'y', b: null }), [['y'], [0]]);
    assert.deepStrictEqual(c.encode({ b: { n: 3, a: null } }), [[], [[3]]]);
    // The head of a long chain of entities carries the table of its tail.
    const chain = {};
    for (let i = 0; i < 3000; i++) chain[`E${i}`] = { Struct: {}, 'next?': `E${i + 1}` };
    chain.E3000 = { Struct: {}, s: 'string' };
    const head = model(chain, { ...options, entities: { E3000: { intern: true } } }).E0;
    assert.deepStrictEqual(head.encode({ next: null }), [[], []]);
    assert.deepStrictEqual(head.encode({ next: { next: null } }), [[], [[]]]);
  });

  test(`Intern (${backend}): resolved across a recursion that holds the strings`, () => {
    const node = {
      fields: {
        name: { type: 'string' },
        kids: { type: 'array', required: false, value: { type: 'Node', one: 'Node' } },
      },
    };
    const snapshot = (more) => ({
      format: 1,
      root: 'Doc',
      entities: {
        Doc: {
          fields: { title: { type: 'number' }, tree: { type: 'Node', one: 'Node' }, ...more },
        },
        Node: node,
      },
    });
    const interned = { ...options, entities: { Node: { intern: true } } };
    const W = Schema.from(snapshot({}), interned);
    const R = Schema.from(snapshot({ extra: { type: 'string', required: false } }), interned);
    const value = { title: 1, tree: { name: 'a', kids: [{ name: 'b', kids: [] }] } };
    const resolved = resolve(W, R);
    assert.deepStrictEqual(resolved.encode(value), W.encode(value));
    assert.deepStrictEqual(resolved.decode(W.encode(value)), { ...value, extra: null });
  });
}

for (const [backend, options] of BACKENDS) {
  test(`Delta and intern (${backend}): resolved across wires`, () => {
    const definition = {
      s: 'string',
      plain: 'string',
      n: 'integer',
      d: { array: 'integer' },
      p: { array: 'integer' },
    };
    const W = define(definition, { ...options, intern: ['s'], delta: ['n', 'd'] });
    const R = resolve(W, define(definition, { ...options, intern: ['plain'], delta: ['p'] }));
    // The writer's wire: its table, its differences.
    const wire = W.encode({ s: 'x', plain: 'y', n: 1, d: [1, 2], p: [3, 4] });
    assert.deepStrictEqual(wire, [['x'], [0, 'y', 1, [1, 1], [3, 4]]]);
    assert.deepStrictEqual(R.decode(wire), { s: 'x', plain: 'y', n: 1, d: [1, 2], p: [3, 4] });
    assert.deepStrictEqual(R.encode({ s: 'z', plain: 'q', n: 2, d: [5, 7], p: [6] }), [
      ['z'],
      [0, 'q', 2, [5, 2], [6]],
    ]);
    // A delta column the reader does not have is still the writer's.
    const C = define(
      { array: { id: 'integer', n: 'number' } },
      { ...options, layout: 'columns', delta: ['[].n'] },
    );
    const RC = resolve(C, define({ array: { id: 'integer' } }, options));
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
