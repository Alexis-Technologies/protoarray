const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');

for (const [backend, options] of BACKENDS) {
  // Encode errors below need the values checked: 'both'.
  const both = { ...options, validate: 'both' };

  test(`Types (${backend}): enum`, () => {
    const E = Schema.from({ role: { enum: ['admin', 'editor'] } }, both);
    assert.throws(() => E.encode({ role: 'nope' }), {
      code: 'enum',
      path: 'role',
      message: 'Field "role" is not of enum: admin, editor',
    });
    for (const validate of [false, true]) {
      const LooseE = Schema.from(E.definition, { ...options, validate });
      assert.deepStrictEqual(LooseE.encode({ role: 'nope' }), [null]);
      assert.deepStrictEqual(LooseE.encode({ role: {} }), [null]);
    }
    assert.throws(() => E.decode([null]), { code: 'required', path: 'role' });
    for (const bad of [1.5, '1', 2, -1, true]) {
      assert.throws(() => E.decode([bad]), { code: 'enum' });
    }
    const Optional = Schema.from({ role: { enum: ['admin'], required: false } }, options);
    assert.deepStrictEqual(Optional.encode({}), []);
    assert.deepStrictEqual(Optional.decode([]), { role: null });
    const Numeric = Schema.from({ code: { enum: [10, 20] } }, options);
    assert.deepStrictEqual(Numeric.encode({ code: 20 }), [1]);
    assert.deepStrictEqual(Numeric.decode([1]), { code: 20 });
    const Defaulted = Schema.from({ role: { enum: ['a', 'b'], default: 'b' } }, options);
    assert.deepStrictEqual(Defaulted.decode([]), { role: 'b' });
    assert.deepStrictEqual(Defaulted.decode([0]), { role: 'a' });
    assert.throws(() => E.decode([Symbol('admin')]), { code: 'enum', path: 'role' });
    const values = Array.from({ length: 40 }, (_, i) => `v${i}`);
    const Wide = Schema.from({ role: { enum: values } }, options);
    assert.deepStrictEqual(Wide.encode({ role: 'v39' }), [39]);
    assert.deepStrictEqual(Wide.decode([39]), { role: 'v39' });
    assert.throws(() => Wide.decode([40]), { code: 'enum' });
  });

  test(`Types (${backend}): date`, () => {
    const D = Schema.from({ at: 'date', list: { array: 'date' } }, both);
    assert.deepStrictEqual(D.encode({ at: new Date(5), list: [new Date(1), 2] }), [5, [1, 2]]);
    assert.throws(() => D.encode({ at: 'nope', list: [] }), { code: 'type', path: 'at' });
    assert.throws(() => D.encode({ at: 1, list: [new Date(NaN)] }), {
      code: 'type',
      path: 'list[0]',
      message: 'Field "list[0]" is not of expected type: date',
    });
    for (const validate of [false, true]) {
      const LooseD = Schema.from(D.definition, { ...options, validate });
      assert.deepStrictEqual(LooseD.encode({ at: 'nope', list: [new Date(NaN)] }), [null, [null]]);
    }
    assert.deepStrictEqual(D.decode([5, [1]]), { at: new Date(5), list: [new Date(1)] });
    assert.throws(() => D.decode(['x']), { code: 'type', path: 'at' });
    assert.throws(() => D.decode([5, [1, 'x']]), { code: 'type', path: 'list[1]' });
    assert.throws(() => D.decode([5, [1, null]]), { code: 'type', path: 'list[1]' });
    const Loose = Schema.from({ list: { array: '?date' } }, options);
    assert.deepStrictEqual(Loose.decode([[1, null]]), { list: [new Date(1), null] });
  });

  test(`Types (${backend}): bigint`, () => {
    const B = Schema.from({ n: 'bigint' }, options);
    assert.deepStrictEqual(B.encode({ n: 10n }), ['10']);
    assert.deepStrictEqual(B.encode({ n: -5 }), ['-5']);
    assert.deepStrictEqual(B.decode(['10']), { n: 10n });
    assert.deepStrictEqual(B.decode(['-5']), { n: -5n });
    for (const bad of ['1.5', 10, '', 'abc']) {
      assert.throws(() => B.decode([bad]), { code: 'type', path: 'n' });
    }
  });

  test(`Types (${backend}): flags`, () => {
    const F = Schema.from({ p: { flags: ['a', 'b', 'c'] } }, both);
    assert.deepStrictEqual(F.encode({ p: { a: true, c: 1, zzz: true } }), [5]);
    assert.deepStrictEqual(F.encode({ p: {} }), [0]);
    assert.throws(() => F.encode({ p: 'str' }), {
      code: 'type',
      path: 'p',
      message: 'Field "p" is not of expected type: flags',
    });
    for (const validate of [false, true]) {
      assert.deepStrictEqual(
        Schema.from(F.definition, { ...options, validate }).encode({ p: 'str' }),
        [0],
      );
    }
    assert.deepStrictEqual(F.decode([5]), { p: { a: true, b: false, c: true } });
    assert.deepStrictEqual(F.decode([13]), { p: { a: true, b: false, c: true } });
    assert.deepStrictEqual(Object.keys(F.decode([0]).p), ['a', 'b', 'c']);
    for (const bad of [1.5, -1, '5', 5n, Symbol('5')]) {
      assert.throws(() => F.decode([bad]), { code: 'type', path: 'p' });
    }
    const Optional = Schema.from({ p: { flags: ['a'], required: false } }, options);
    assert.deepStrictEqual(Optional.encode({}), []);
    assert.deepStrictEqual(Optional.decode([]), { p: null });
    // A decoder takes the array form too, and ignores the words it has no names for.
    assert.deepStrictEqual(F.decode([[5, 7]]), { p: { a: true, b: false, c: true } });
    for (const bad of [[], [1.5], [1, -1], ['1'], [null]]) {
      assert.throws(() => F.decode([bad]), { code: 'type', path: 'p' });
    }
  });

  test(`Types (${backend}): flags past 31 names take an array of words`, () => {
    const names = Array.from({ length: 70 }, (_, i) => `n${i}`);
    const W = Schema.from({ p: { flags: names } }, options);
    assert.deepStrictEqual(W.encode({ p: {} }), [0]);
    assert.deepStrictEqual(W.encode({ p: { n0: true, n30: true } }), [1073741825]);
    assert.deepStrictEqual(W.encode({ p: { n31: true } }), [[0, 1]]);
    assert.deepStrictEqual(W.encode({ p: { n0: true, n69: true } }), [[1, 0, 128]]);
    const decoded = W.decode([[1, 0, 128]]).p;
    assert.deepStrictEqual(Object.keys(decoded), names);
    assert.deepStrictEqual(
      names.filter((name) => decoded[name]),
      ['n0', 'n69'],
    );
    assert.strictEqual(W.decode([1]).p.n0, true);
    assert.strictEqual(W.decode([1]).p.n31, false);
    assert.strictEqual(W.decode([[0, 1]]).p.n31, true);
    // Without validation a stray value stays as it is and a stray word counts as 0.
    const Loose = Schema.from(W.definition, { ...options, validate: false });
    assert.strictEqual(Loose.decode(['x']).p, 'x');
    assert.strictEqual(Loose.decode([[1, 'x', 1n]]).p.n0, true);
    assert.strictEqual(Loose.decode([[1, 'x', 1n]]).p.n62, false);
  });

  test(`Types (${backend}): decimals travel as scaled integers`, () => {
    const P = Schema.from(
      {
        price: { type: 'number', decimals: 2 },
        rate: { type: 'number', decimals: 4, required: false },
        whole: { type: 'number', decimals: 0, required: false },
        list: { array: { type: 'number', decimals: 1 }, required: false },
      },
      both,
    );
    assert.deepStrictEqual(P.encode({ price: 19.99 }), [1999]);
    assert.deepStrictEqual(P.decode([1999]).price, 19.99);
    assert.deepStrictEqual(
      P.encode({ price: 0.1 + 0.2, rate: 0.12345, whole: 2.5 }),
      [30, 1235, 3],
    );
    assert.deepStrictEqual(P.decode([30, 1235, 3]), {
      price: 0.3,
      rate: 0.1235,
      whole: 3,
      list: null,
    });
    assert.deepStrictEqual(P.encode({ price: 1, list: [1.25, -0.04] }), [100, null, null, [13, 0]]);
    assert.ok(Object.is(P.encode({ price: -0.001 })[0], 0));
    assert.deepStrictEqual(P.decode([-1999]).price, -19.99);
    // Math.round rounds half up, on the double: 1.005 is 1.00499999999999989…
    assert.deepStrictEqual(P.encode({ price: 1.005 }), [100]);
    assert.deepStrictEqual(P.encode({ price: -2.5 / 100 }), [-2]);
    for (const bad of [19.99, '1999', 2 ** 53]) {
      assert.throws(() => P.decode([bad]), {
        code: 'type',
        path: 'price',
        message: 'Field "price" is not of expected type: number(2)',
      });
    }
    for (const bad of ['19.99', NaN, Infinity, 1e14]) {
      assert.throws(() => P.encode({ price: bad }), { code: 'type', path: 'price' });
    }
    assert.throws(() => P.encode({ price: 1, list: [1, 'x'] }), { code: 'type', path: 'list[1]' });
    const Loose = Schema.from(P.definition, { ...options, validate: false });
    assert.deepStrictEqual(Loose.encode({ price: 'x' }), ['x']);
    assert.deepStrictEqual(Loose.decode(['x']).price, 'x');
    assert.deepStrictEqual(Loose.decode([19.99]).price, 0.1999);
    // By default the value is trusted on the way in and the wire checked on the way out.
    const Default = Schema.from(P.definition, options);
    assert.deepStrictEqual(Default.encode({ price: 'x' }), ['x']);
    assert.deepStrictEqual(Default.encode({ price: 1e14 }), [1e16]);
    assert.throws(() => Default.decode([1e16]), { code: 'type', path: 'price' });
  });

  test(`Types (${backend}): bytes travel as base64`, () => {
    const B = Schema.from({ data: 'bytes', list: { array: '?bytes', required: false } }, both);
    const cases = [
      [[], ''],
      [[1], 'AQ=='],
      [[1, 2], 'AQI='],
      [[1, 2, 3], 'AQID'],
      [[0, 255, 254, 62, 63], 'AP/+Pj8='],
    ];
    for (const [bytes, text] of cases) {
      assert.deepStrictEqual(B.encode({ data: new Uint8Array(bytes) }), [text]);
      const decoded = B.decode([text]).data;
      assert.strictEqual(Object.getPrototypeOf(decoded), Uint8Array.prototype);
      assert.deepStrictEqual(Array.from(decoded), bytes);
    }
    // A Buffer or a view into a larger buffer goes in; a plain array of its own comes out.
    const big = new Uint8Array(65536).map((_, i) => i % 251);
    const view = new Uint8Array(big.buffer, 10, 1000);
    const wire = B.encode({ data: Buffer.from(big), list: [view, null] });
    const back = B.decode(wire);
    assert.deepStrictEqual(back.data, big);
    assert.deepStrictEqual(back.list[0], view.slice());
    assert.strictEqual(back.list[0].buffer.byteLength, 1000);
    assert.strictEqual(back.list[1], null);
    assert.ok(!Buffer.isBuffer(back.data));
    for (const bad of [[1, 2], new Uint16Array(2), new ArrayBuffer(2), 'AQI=', {}]) {
      assert.throws(() => B.encode({ data: bad }), {
        code: 'type',
        path: 'data',
        message: 'Field "data" is not of expected type: bytes',
      });
    }
    for (const bad of ['AQI', 'AQI==', 'A=QI', 'a b=', '*AQI', 'AB==', '-_8=', 'AQ\rI=', 5]) {
      assert.throws(() => B.decode([bad]), { code: 'type', path: 'data' });
    }
    assert.throws(() => B.decode([null]), { code: 'required', path: 'data' });
    // Without validation a value with no wire form of its type stays as it is.
    const Loose = Schema.from(B.definition, { ...options, validate: false });
    assert.deepStrictEqual(Loose.encode({ data: 'AQI=' }), ['AQI=']);
    assert.deepStrictEqual(Schema.from(B.definition, options).encode({ data: 'AQI=' }), ['AQI=']);
    assert.strictEqual(Loose.decode(['AQI']).data, 'AQI');
    assert.strictEqual(Loose.decode([5]).data, 5);
    assert.deepStrictEqual(Array.from(Loose.decode(['AQI=']).data), [1, 2]);
  });

  test(`Types (${backend}): json is never required`, () => {
    const J = Schema.from({ j: 'json', k: { type: 'json' }, n: 'number' }, options);
    assert.deepStrictEqual(J.decode([null, undefined, 1]), { j: null, k: null, n: 1 });
    assert.deepStrictEqual(J.encode({ n: 1 }), [null, null, 1]);
    assert.deepStrictEqual(J.encode({ j: [1, { x: undefined }], n: 1 }), [
      [1, { x: undefined }],
      null,
      1,
    ]);
    const List = Schema.from({ array: 'json' }, options);
    const values = [1, null, 'x'];
    assert.strictEqual(List.decode(values), values);
  });

  test(`Types (${backend}): tuples have a fixed arity`, () => {
    const T = Schema.from({ t: ['number', '?string', 'date'] }, both);
    assert.deepStrictEqual(T.encode({ t: [1, 'x', new Date(5)] }), [[1, 'x', 5]]);
    assert.throws(() => T.encode({ t: [1] }), { code: 'required', path: 't[2]' });
    assert.throws(() => T.encode({ t: ['1', 'x', 5] }), { code: 'type', path: 't[0]' });
    assert.deepStrictEqual(T.encode({ t: [1, null, 5, 'extra'] }), [[1, null, 5]]);
    for (const validate of [false, true]) {
      const LooseT = Schema.from(T.definition, { ...options, validate });
      assert.deepStrictEqual(LooseT.encode({ t: [1] }), [[1, null, null]]);
    }
    assert.deepStrictEqual(T.decode([[1, null, 5]]), { t: [1, null, new Date(5)] });
    assert.throws(() => T.decode([[1]]), {
      code: 'structure',
      path: 't',
      message: 'Field "t" has a wrong length',
    });
    assert.throws(() => T.decode([[1, 2, 5]]), { code: 'type', path: 't[1]' });
    assert.throws(() => T.decode([[null, 'x', 5]]), { code: 'required', path: 't[0]' });
    assert.throws(() => T.decode([[1, 'x', null]]), { code: 'required', path: 't[2]' });
    assert.throws(() => T.decode(['x']), { code: 'structure', path: 't' });
    const Loose = Schema.from({ t: ['number', 'string'] }, { ...options, validate: false });
    assert.deepStrictEqual(Loose.decode([['x']]), { t: ['x', null] });
    const Root = Schema.from(['number', 'string'], both);
    assert.deepStrictEqual(Root.encode([1, 's']), [1, 's']);
    assert.throws(() => Root.decode([1]), { code: 'structure', path: '' });
    assert.throws(() => Root.decode(null), { code: 'structure', path: '' });
    assert.throws(() => Root.encode(null), { code: 'array', path: '' });
    assert.throws(() => Root.encode(5), { code: 'array', message: 'Value is not an array' });
    assert.throws(() => Root.encode({}), { code: 'array', path: '' });
    assert.throws(() => T.encode({ t: 5 }), { code: 'array', path: 't' });
  });

  test(`Types (${backend}): defaults are decoded values`, () => {
    const D = Schema.from(
      {
        n: { type: 'number', default: 0 },
        s: { type: 'string', default: 'x' },
        b: { type: 'boolean', default: true },
        j: { type: 'json', default: 'any' },
      },
      options,
    );
    assert.deepStrictEqual(D.decode([]), { n: 0, s: 'x', b: true, j: 'any' });
    assert.deepStrictEqual(D.decode([null, null, null, null]), { n: 0, s: 'x', b: true, j: 'any' });
    assert.deepStrictEqual(D.decode([1, 'y', false, 0]), { n: 1, s: 'y', b: false, j: 0 });
    assert.deepStrictEqual(D.encode({ n: 0, s: 'x', b: true, j: 'any' }), [0, 'x', true, 'any']);
    assert.deepStrictEqual(D.encode({}), []);
    assert.throws(() => D.decode(['x']), { code: 'type', path: 'n' });
    // -0 has no JSON form: it is +0 everywhere, so both backends agree.
    const Z = Schema.from({ z: { type: 'number', default: -0 } }, options);
    assert.ok(Object.is(Z.decode([]).z, 0));
    assert.strictEqual(Z.toString(), '{z:?number=0}');
  });

  test(`Types (${backend}): arrays of converted scalars`, () => {
    const A = Schema.from(
      { list: { array: { enum: ['a', 'b'] } }, big: { array: 'bigint' } },
      both,
    );
    assert.throws(() => A.encode({ list: ['b', 'zzz'], big: [1n] }), {
      code: 'enum',
      path: 'list[1]',
    });
    assert.throws(() => A.encode({ list: ['b', null], big: [1n] }), {
      code: 'type',
      path: 'list[1]',
      message: 'Field "list[1]" is not of expected type: a, b',
    });
    assert.deepStrictEqual(A.encode({ list: ['b'], big: [1n, 2, '-3'] }), [[1], ['1', '2', '-3']]);
    for (const validate of [false, true]) {
      const LooseA = Schema.from(A.definition, { ...options, validate });
      assert.deepStrictEqual(LooseA.encode({ list: ['b', 'zzz'], big: [1n] }), [[1, null], ['1']]);
    }
    assert.deepStrictEqual(A.decode([[1, 0], ['1']]), { list: ['b', 'a'], big: [1n] });
    assert.throws(() => A.decode([[1, null], ['1']]), { code: 'type', path: 'list[1]' });
    assert.throws(() => A.decode([[1, 7], ['1']]), { code: 'enum', path: 'list[1]' });
    assert.throws(() => A.decode([[1], 'x']), { code: 'structure', path: 'big' });
  });
}

// The edges of the converted types: word boundaries, the safe range, what an
// object may be.
for (const [backend, options] of BACKENDS) {
  test(`Types (${backend}): flags at the word boundaries`, () => {
    for (const size of [31, 32, 62, 63]) {
      const names = Array.from({ length: size }, (_, i) => `n${i}`);
      const F = Schema.from({ p: { flags: names } }, options);
      const last = names[size - 1];
      const wire = F.encode({ p: { [last]: true } });
      const words = Math.ceil(size / 31);
      const bit = 1 << ((size - 1) % 31);
      const expected = words === 1 ? bit : [...new Array(words - 1).fill(0), bit];
      assert.deepStrictEqual(wire, [expected], `${size} names`);
      const decoded = F.decode(wire).p;
      assert.strictEqual(decoded[last], true);
      assert.strictEqual(names.filter((name) => decoded[name]).length, 1);
    }
    const F = Schema.from({ p: { flags: ['a', 'b'] } }, { ...options, validate: 'both' });
    // The array form decodes whatever it holds, even where one word would do.
    assert.deepStrictEqual(F.decode([[1, 0]]).p, { a: true, b: false });
    assert.deepStrictEqual(F.decode([[1]]).p, { a: true, b: false });
    // An array is not a set of flags; any other object is read by name, so a
    // Date or a Map has none set.
    for (const bad of [[], ['a'], 'a', 1, true]) {
      assert.throws(() => F.encode({ p: bad }), { code: 'type', path: 'p' });
    }
    assert.deepStrictEqual(F.encode({ p: new Date(0) }), [0]);
    assert.deepStrictEqual(F.encode({ p: new Map([['a', true]]) }), [0]);
    assert.deepStrictEqual(Schema.from(F.definition, options).encode({ p: ['a'] }), [0]);
  });

  test(`Types (${backend}): decimals at the edges`, () => {
    const both = { ...options, validate: 'both' };
    const P = Schema.from({ n: { type: 'number', decimals: 2 } }, both);
    for (const bad of [-Infinity, -1e14, 1e14, '1']) {
      assert.throws(() => P.encode({ n: bad }), { code: 'type', path: 'n' });
    }
    assert.deepStrictEqual(P.encode({ n: -1e13 }), [-1e15]);
    assert.deepStrictEqual(P.decode([-(2 ** 53 - 1)]).n, -(2 ** 53 - 1) / 100);
    assert.throws(() => P.decode([-(2 ** 53)]), { code: 'type', path: 'n' });
    const Fine = Schema.from({ n: { type: 'number', decimals: 15 } }, both);
    assert.deepStrictEqual(Fine.encode({ n: 0.5 }), [500000000000000]);
    assert.deepStrictEqual(Fine.decode([500000000000000]).n, 0.5);
    assert.throws(() => Fine.encode({ n: 10 }), { code: 'type', path: 'n' });
    // At the root, in a sparse record, in a union, in a layout; checked by check().
    const Price = { type: 'number', decimals: 2 };
    const Root = Schema.from(Price, both);
    assert.strictEqual(Root.encode(1.5), 150);
    assert.strictEqual(Root.decode(150), 1.5);
    assert.strictEqual(Root.check('x').code, 'type');
    const Sparse = Schema.from({ a: '?string', p: Price }, { ...both, sparse: true });
    assert.deepStrictEqual(Sparse.encode({ p: 1.5 }), [2, 150]);
    assert.deepStrictEqual(Sparse.decode([2, 150]), { a: null, p: 1.5 });
    const U = Schema.from({ union: [{ k: { enum: ['a'] }, p: Price }], discriminator: 'k' }, both);
    assert.deepStrictEqual(U.encode({ k: 'a', p: 1.5 }), [0, 150]);
    assert.deepStrictEqual(U.decode([0, 150]), { k: 'a', p: 1.5 });
    assert.strictEqual(U.check({ k: 'a', p: 'x' }).path, 'p');
    for (const layout of ['flat', 'columns']) {
      const L = Schema.from({ array: { p: Price } }, { ...both, layout });
      const wire = L.encode([{ p: 1.5 }, { p: 2 }]);
      assert.deepStrictEqual(L.decode(wire), [{ p: 1.5 }, { p: 2 }]);
      assert.strictEqual(L.check([{ p: 'x' }]).path, '[0].p');
    }
    // A tuple element is a scalar type name: the long form is not one.
    assert.throws(() => Schema.from({ t: [Price] }), { code: 'ERR_INVALID_DEFINITION' });
  });
}
