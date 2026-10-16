const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');
const { define } = require('../support/schema.js');

// The values given to encode are trusted, whatever `validate` says (it is about
// the wire): a value with no wire form of its type travels as null or as it is.
// Checking a value is metaschema's (`schema.source.check`).
for (const [backend, options] of BACKENDS) {
  test(`Types (${backend}): enum`, () => {
    const E = define({ role: { enum: ['admin', 'editor'] } }, options);
    for (const validate of [false, true]) {
      const LooseE = Schema.from(E, { ...options, validate });
      assert.deepStrictEqual(LooseE.encode({ role: 'nope' }), [null]);
      assert.deepStrictEqual(LooseE.encode({ role: {} }), [null]);
    }
    assert.throws(() => E.decode([null]), { code: 'required', path: 'role' });
    for (const bad of [1.5, '1', 2, -1, true]) {
      assert.throws(() => E.decode([bad]), { code: 'enum' });
    }
    assert.throws(() => E.decode([2]), {
      code: 'enum',
      path: 'role',
      message: 'Field "role" is not of enum: admin, editor',
    });
    const Optional = define({ role: { enum: ['admin'], required: false } }, options);
    assert.deepStrictEqual(Optional.encode({}), []);
    assert.deepStrictEqual(Optional.decode([]), { role: null });
    const Numeric = define({ code: { enum: [10, 20] } }, options);
    assert.deepStrictEqual(Numeric.encode({ code: 20 }), [1]);
    assert.deepStrictEqual(Numeric.decode([1]), { code: 20 });
    const Defaulted = define({ role: { enum: ['a', 'b'], default: 'b' } }, options);
    assert.deepStrictEqual(Defaulted.decode([]), { role: 'b' });
    assert.deepStrictEqual(Defaulted.decode([0]), { role: 'a' });
    assert.throws(() => E.decode([Symbol('admin')]), { code: 'enum', path: 'role' });
    const values = Array.from({ length: 40 }, (_, i) => `v${i}`);
    const Wide = define({ role: { enum: values } }, options);
    assert.deepStrictEqual(Wide.encode({ role: 'v39' }), [39]);
    assert.deepStrictEqual(Wide.decode([39]), { role: 'v39' });
    assert.throws(() => Wide.decode([40]), { code: 'enum' });
  });

  test(`Types (${backend}): date`, () => {
    const D = define({ at: 'date', list: { array: 'date' } }, options);
    assert.deepStrictEqual(D.encode({ at: new Date(5), list: [new Date(1), 2] }), [5, [1, 2]]);
    for (const validate of [false, true]) {
      const LooseD = Schema.from(D, { ...options, validate });
      assert.deepStrictEqual(LooseD.encode({ at: 'nope', list: [new Date(NaN)] }), [null, [null]]);
    }
    assert.deepStrictEqual(D.decode([5, [1]]), { at: new Date(5), list: [new Date(1)] });
    assert.throws(() => D.decode(['x']), { code: 'type', path: 'at' });
    assert.throws(() => D.decode([5, [1, 'x']]), { code: 'type', path: 'list[1]' });
    assert.throws(() => D.decode([5, [1, null]]), {
      code: 'type',
      path: 'list[1]',
      message: 'Field "list[1]" is not of expected type: date',
    });
    const Loose = define({ list: { array: '?date' } }, options);
    assert.deepStrictEqual(Loose.decode([[1, null]]), { list: [new Date(1), null] });
    // A valid date only: whole milliseconds within the range of Date.
    for (const at of [1.5, 8.64e15 + 1, -1e20, 1e300, NaN]) {
      assert.throws(() => D.decode([at, []]), { code: 'type', path: 'at' }, `${at}`);
    }
    assert.deepStrictEqual(D.decode([-8.64e15, []]).at, new Date(-8.64e15));
    const Deltas = define({ at: { array: 'date' } }, { ...options, delta: ['at'] });
    assert.throws(() => Deltas.decode([[8.64e15, 1]]), { code: 'type', path: 'at' });
    assert.deepStrictEqual(Deltas.decode([[5, 1]]).at, [new Date(5), new Date(6)]);
  });

  test(`Types (${backend}): bigint`, () => {
    const B = define({ n: 'bigint' }, options);
    assert.deepStrictEqual(B.encode({ n: 10n }), ['10']);
    assert.deepStrictEqual(B.encode({ n: -5 }), ['-5']);
    assert.deepStrictEqual(B.decode(['10']), { n: 10n });
    assert.deepStrictEqual(B.decode(['-5']), { n: -5n });
    for (const bad of ['1.5', 10, '', 'abc']) {
      assert.throws(() => B.decode([bad]), { code: 'type', path: 'n' });
    }
  });

  test(`Types (${backend}): flags`, () => {
    const F = define({ p: { flags: ['a', 'b', 'c'] } }, options);
    assert.deepStrictEqual(F.encode({ p: { a: true, c: 1, zzz: true } }), [5]);
    assert.deepStrictEqual(F.encode({ p: {} }), [0]);
    for (const validate of [false, true]) {
      assert.deepStrictEqual(Schema.from(F, { ...options, validate }).encode({ p: 'str' }), [0]);
    }
    assert.deepStrictEqual(F.decode([5]), { p: { a: true, b: false, c: true } });
    assert.deepStrictEqual(F.decode([13]), { p: { a: true, b: false, c: true } });
    assert.deepStrictEqual(Object.keys(F.decode([0]).p), ['a', 'b', 'c']);
    for (const bad of [1.5, -1, '5', 5n, Symbol('5')]) {
      assert.throws(() => F.decode([bad]), { code: 'type', path: 'p' });
    }
    assert.throws(() => F.decode(['5']), {
      message: 'Field "p" is not of expected type: flags',
    });
    const Optional = define({ p: { flags: ['a'], required: false } }, options);
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
    const W = define({ p: { flags: names } }, options);
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
    const Loose = Schema.from(W, { ...options, validate: false });
    assert.strictEqual(Loose.decode(['x']).p, 'x');
    assert.strictEqual(Loose.decode([[1, 'x', 1n]]).p.n0, true);
    assert.strictEqual(Loose.decode([[1, 'x', 1n]]).p.n62, false);
  });

  test(`Types (${backend}): decimals travel as scaled integers`, () => {
    const P = define(
      {
        price: { type: 'number', decimals: 2 },
        rate: { type: 'number', decimals: 4, required: false },
        whole: { type: 'number', decimals: 0, required: false },
        list: { array: { type: 'number', decimals: 1 }, required: false },
      },
      options,
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
    const Loose = Schema.from(P, { ...options, validate: false });
    assert.deepStrictEqual(Loose.encode({ price: 'x' }), ['x']);
    assert.deepStrictEqual(Loose.decode(['x']).price, 'x');
    assert.deepStrictEqual(Loose.decode([19.99]).price, 0.1999);
    // A value of another type is trusted on the way in; a number that scales
    // past the safe integers has no wire its decoder reads, so encode refuses
    // it whatever `validate` says, NaN and the infinities too.
    assert.deepStrictEqual(P.encode({ price: 'x' }), ['x']);
    const refused = {
      name: 'EncodeError',
      code: 'type',
      path: 'price',
      message: 'Field "price" is not of expected type: number(2)',
    };
    for (const schema of [P, Loose]) {
      for (const price of [1e14, -1e14, NaN, Infinity]) {
        assert.throws(() => schema.encode({ price }), refused);
        assert.throws(() => schema.stringify({ price }), refused);
      }
    }
    assert.deepStrictEqual(P.encode({ price: 9e13 }), [9e15]);
    assert.throws(() => P.encode({ price: 1, list: [1e15] }), { code: 'type', path: 'list[0]' });
    const Wide = define({ p: { type: 'number', decimals: 15 } }, options);
    assert.throws(() => Wide.encode({ p: 10 }), { code: 'type', path: 'p' });
    assert.deepStrictEqual(Wide.decode(Wide.encode({ p: 1 })), { p: 1 });
  });

  test(`Types (${backend}): bytes travel as base64`, () => {
    const B = define({ data: 'bytes', list: { array: '?bytes', required: false } }, options);
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
    for (const bad of ['AQI', 'AQI==', 'A=QI', 'a b=', '*AQI', 'AB==', '-_8=', 'AQ\rI=', 5]) {
      assert.throws(() => B.decode([bad]), {
        code: 'type',
        path: 'data',
        message: 'Field "data" is not of expected type: bytes',
      });
    }
    assert.throws(() => B.decode([null]), { code: 'required', path: 'data' });
    // A value with no wire form of its type stays as it is: on encode always,
    // on decode without validation.
    const Loose = Schema.from(B, { ...options, validate: false });
    assert.deepStrictEqual(Loose.encode({ data: 'AQI=' }), ['AQI=']);
    assert.deepStrictEqual(B.encode({ data: 'AQI=' }), ['AQI=']);
    assert.strictEqual(Loose.decode(['AQI']).data, 'AQI');
    assert.strictEqual(Loose.decode([5]).data, 5);
    assert.deepStrictEqual(Array.from(Loose.decode(['AQI=']).data), [1, 2]);
  });

  test(`Types (${backend}): json is never required`, () => {
    const J = define({ j: 'json', k: { type: 'json' }, n: 'number' }, options);
    assert.deepStrictEqual(J.decode([null, undefined, 1]), { j: null, k: null, n: 1 });
    assert.deepStrictEqual(J.encode({ n: 1 }), [null, null, 1]);
    assert.deepStrictEqual(J.encode({ j: [1, { x: undefined }], n: 1 }), [
      [1, { x: undefined }],
      null,
      1,
    ]);
    const List = define({ array: 'json' }, options);
    const values = [1, null, 'x'];
    assert.strictEqual(List.decode(values), values);
  });

  test(`Types (${backend}): tuples have a fixed arity`, () => {
    const T = define({ t: ['number', '?string', 'date'] }, options);
    assert.deepStrictEqual(T.encode({ t: [1, 'x', new Date(5)] }), [[1, 'x', 5]]);
    assert.deepStrictEqual(T.encode({ t: [1, null, 5, 'extra'] }), [[1, null, 5]]);
    for (const validate of [false, true]) {
      const LooseT = Schema.from(T, { ...options, validate });
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
    const Loose = define({ t: ['number', 'string'] }, { ...options, validate: false });
    assert.deepStrictEqual(Loose.decode([['x']]), { t: ['x', null] });
    const Root = define(['number', 'string'], options);
    assert.deepStrictEqual(Root.encode([1, 's']), [1, 's']);
    assert.throws(() => Root.decode([1]), { code: 'structure', path: '' });
    assert.throws(() => Root.decode(null), { code: 'structure', path: '' });
    assert.throws(() => Root.encode(null), { code: 'array', path: '' });
    assert.throws(() => Root.encode(5), { code: 'array', message: 'Value is not an array' });
    assert.throws(() => Root.encode({}), { code: 'array', path: '' });
    assert.throws(() => T.encode({ t: 5 }), { code: 'array', path: 't' });
  });

  test(`Types (${backend}): defaults are decoded values`, () => {
    const D = define(
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
    const Z = define({ z: { type: 'number', default: -0 } }, options);
    assert.ok(Object.is(Z.decode([]).z, 0));
    assert.strictEqual(Z.toString(), '{z:?number=0}');
  });

  test(`Types (${backend}): arrays of converted scalars`, () => {
    const A = define({ list: { array: { enum: ['a', 'b'] } }, big: { array: 'bigint' } }, options);
    assert.deepStrictEqual(A.encode({ list: ['b'], big: [1n, 2, '-3'] }), [[1], ['1', '2', '-3']]);
    for (const validate of [false, true]) {
      const LooseA = Schema.from(A, { ...options, validate });
      assert.deepStrictEqual(LooseA.encode({ list: ['b', 'zzz'], big: [1n] }), [[1, null], ['1']]);
      assert.deepStrictEqual(LooseA.encode({ list: ['b', null], big: [] }), [[1, null], []]);
    }
    assert.deepStrictEqual(A.decode([[1, 0], ['1']]), { list: ['b', 'a'], big: [1n] });
    assert.throws(() => A.decode([[1, null], ['1']]), {
      code: 'type',
      path: 'list[1]',
      message: 'Field "list[1]" is not of expected type: a, b',
    });
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
      const F = define({ p: { flags: names } }, options);
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
    const F = define({ p: { flags: ['a', 'b'] } }, options);
    // The array form decodes whatever it holds, even where one word would do.
    assert.deepStrictEqual(F.decode([[1, 0]]).p, { a: true, b: false });
    assert.deepStrictEqual(F.decode([[1]]).p, { a: true, b: false });
    // A value is read by name, so an array, a primitive, a Date or a Map has
    // none set.
    for (const value of [[], ['a'], 'a', 1, true, new Date(0), new Map([['a', true]])]) {
      assert.deepStrictEqual(F.encode({ p: value }), [0]);
    }
  });

  test(`Types (${backend}): decimals at the edges`, () => {
    const P = define({ n: { type: 'number', decimals: 2 } }, options);
    assert.deepStrictEqual(P.encode({ n: -1e13 }), [-1e15]);
    assert.deepStrictEqual(P.decode([-(2 ** 53 - 1)]).n, -(2 ** 53 - 1) / 100);
    assert.throws(() => P.decode([-(2 ** 53)]), { code: 'type', path: 'n' });
    // Past the safe range on the way in, the wire is refused on the way out.
    assert.throws(() => P.decode(P.encode({ n: -1e14 })), { code: 'type', path: 'n' });
    const Fine = define({ n: { type: 'number', decimals: 15 } }, options);
    assert.deepStrictEqual(Fine.encode({ n: 0.5 }), [500000000000000]);
    assert.deepStrictEqual(Fine.decode([500000000000000]).n, 0.5);
    assert.throws(() => Fine.decode(Fine.encode({ n: 10 })), { code: 'type', path: 'n' });
    // At the root, in a sparse record, in a union, in a layout; checked on decode.
    const Price = { type: 'number', decimals: 2 };
    const Root = define(Price, options);
    assert.strictEqual(Root.encode(1.5), 150);
    assert.strictEqual(Root.decode(150), 1.5);
    assert.throws(() => Root.decode(1.5), { code: 'type', path: '' });
    const Sparse = define({ a: '?string', p: Price }, { ...options, sparse: true });
    assert.deepStrictEqual(Sparse.encode({ p: 1.5 }), [2, 150]);
    assert.deepStrictEqual(Sparse.decode([2, 150]), { a: null, p: 1.5 });
    const U = define({ union: [{ k: { enum: ['a'] }, p: Price }], discriminator: 'k' }, options);
    assert.deepStrictEqual(U.encode({ k: 'a', p: 1.5 }), [0, 150]);
    assert.deepStrictEqual(U.decode([0, 150]), { k: 'a', p: 1.5 });
    assert.throws(() => U.decode([0, 'x']), { code: 'type', path: 'p' });
    for (const layout of ['flat', 'columns']) {
      const L = define({ array: { p: Price } }, { ...options, layout });
      const wire = L.encode([{ p: 1.5 }, { p: 2 }]);
      assert.deepStrictEqual(L.decode(wire), [{ p: 1.5 }, { p: 2 }]);
      const bad = layout === 'flat' ? [1.5] : [[1.5]];
      assert.throws(() => L.decode(bad), { code: 'type', path: '[0].p' });
    }
    const T = define({ t: [Price, '?number'] }, options);
    assert.deepStrictEqual(T.encode({ t: [1.5] }), [[150, null]]);
    assert.deepStrictEqual(T.decode([[150, null]]), { t: [1.5, null] });
  });
}

for (const [backend, options] of BACKENDS) {
  test(`Types (${backend}): integer, any, unknown and null`, () => {
    const S = define({ n: 'integer', a: 'any', u: 'unknown', z: 'null' }, options);
    assert.deepStrictEqual(S.decode([3]), { n: 3, a: null, u: null, z: null });
    assert.throws(() => S.decode([1.5]), {
      code: 'type',
      path: 'n',
      message: 'Field "n" is not of expected type: integer',
    });
    assert.throws(() => S.decode([]), { code: 'required', path: 'n' });
    // A null slot holds nothing else: whatever is given travels as null, and
    // validated, only null decodes.
    assert.deepStrictEqual(S.encode({ n: 1, z: 0 }), [1]);
    assert.throws(() => S.decode([1, null, null, 0]), {
      code: 'type',
      path: 'z',
      message: 'Field "z" is not of expected type: null',
    });
    const Loose = Schema.from(S, { ...options, validate: false });
    assert.deepStrictEqual(Loose.encode({ n: 1.5, z: 'x' }), [1.5]);
    assert.deepStrictEqual(Loose.decode([1.5, 1, 2, 'x']), { n: 1.5, a: 1, u: 2, z: 'x' });
    // A default of an integer is an integer; any and unknown are json.
    const D = define({ n: { type: 'integer', default: 2 } }, options);
    assert.deepStrictEqual(D.decode([]), { n: 2 });
    assert.strictEqual(define({ a: 'any' }).id, define({ a: 'json' }).id);
    const Items = define({ list: { array: 'integer' }, opt: { array: '?null' } }, options);
    assert.throws(() => Items.decode([[1, 2.5]]), { code: 'type', path: 'list[1]' });
    assert.deepStrictEqual(Items.encode({ list: [1], opt: [null] }), [[1], [null]]);
    assert.deepStrictEqual(Items.encode({ list: [1], opt: [null, 1] }), [[1], [null, null]]);
    assert.throws(() => Items.decode([[1], [null, 1]]), { code: 'type', path: 'opt[1]' });
  });

  test(`Types (${backend}): sets`, () => {
    const S = define({ tags: { set: 'string' }, at: { set: '?date', required: false } }, options);
    assert.deepStrictEqual(S.encode({ tags: ['a', 'b'] }), [['a', 'b']]);
    assert.deepStrictEqual(S.encode({ tags: new Set(['a']), at: new Set([new Date(1), null]) }), [
      ['a'],
      [1, null],
    ]);
    const decoded = S.decode([['a', 'b'], [2]]);
    assert.ok(decoded.tags instanceof Set);
    assert.deepStrictEqual([...decoded.tags], ['a', 'b']);
    assert.deepStrictEqual([...decoded.at], [new Date(2)]);
    for (const bad of [{}, 'ab', new Map(), 1]) {
      assert.throws(() => S.encode({ tags: bad }), {
        code: 'set',
        path: 'tags',
        message: 'Field "tags" is not a set',
      });
    }
    assert.throws(() => S.decode([new Set()]), { code: 'structure', path: 'tags' });
    assert.throws(() => S.decode([[1]]), { code: 'type', path: 'tags[0]' });
    assert.throws(() => S.decode([['a'], ['x']]), { code: 'type', path: 'at[0]' });
    const Records = define({ s: { set: { id: 'number' } } }, options);
    const wire = Records.encode({ s: new Set([{ id: 1 }, { id: 2 }]) });
    assert.deepStrictEqual(wire, [[[1], [2]]]);
    assert.deepStrictEqual([...Records.decode(wire).s], [{ id: 1 }, { id: 2 }]);
    assert.throws(() => Records.decode([[null]]), {
      code: 'type',
      path: 's[0]',
      message: 'Field "s[0]" is not of expected type: object',
    });
    const Nested = define({ s: { array: { set: 'number' } } }, options);
    assert.throws(() => Nested.decode([[null]]), {
      message: 'Field "s[0]" is not of expected type: set',
    });
  });

  test(`Types (${backend}): maps`, () => {
    const M = define({ m: { map: { string: 'date' } } }, options);
    const value = new Map([
      ['a', new Date(1)],
      ['b', new Date(2)],
    ]);
    assert.deepStrictEqual(M.encode({ m: value }), [['a', 1, 'b', 2]]);
    assert.deepStrictEqual(M.decode([['a', 1, 'b', 2]]).m, value);
    for (const bad of [{}, [], new Set()]) {
      assert.throws(() => M.encode({ m: bad }), {
        code: 'map',
        path: 'm',
        message: 'Field "m" is not a map',
      });
    }
    assert.throws(() => M.decode([['a']]), {
      code: 'structure',
      path: 'm',
      message: 'Field "m" has a wrong length',
    });
    assert.throws(() => M.decode([{}]), { code: 'structure', path: 'm' });
    assert.throws(() => M.decode([[1, 1]]), {
      code: 'type',
      path: 'm[0]',
      message: 'Field "m[0]" is not of expected type: string',
    });
    assert.throws(() => M.decode([['a', 1, 'b', 'x']]), { code: 'type', path: 'm[1]' });
    assert.throws(() => M.decode([['a', null]]), {
      code: 'type',
      message: 'Field "m[0]" is not of expected type: date',
    });
    // Trusted: a key travels as it is, a value with no wire form as null.
    assert.deepStrictEqual(M.encode({ m: new Map([[1, 'x']]) }), [[1, null]]);
    const Loose = Schema.from(M, { ...options, validate: false });
    assert.deepStrictEqual(Loose.encode({ m: new Map([[1, 'x']]) }), [[1, null]]);
    assert.deepStrictEqual(Loose.decode([[1, 'x']]).m, new Map([[1, 'x']]));
    const Numbers = define({ m: { map: { number: { id: '?number' } } } }, options);
    assert.throws(() => Numbers.decode([[1, ['x']]]), { code: 'type', path: 'm[0].id' });
    assert.deepStrictEqual(
      Numbers.decode([[1, [], 2, [3]]]).m,
      new Map([
        [1, { id: null }],
        [2, { id: 3 }],
      ]),
    );
    assert.throws(() => Numbers.decode([[1, null]]), { code: 'type', path: 'm[0]' });
  });

  test(`Types (${backend}): object dictionaries`, () => {
    const D = define({ d: { object: { string: 'date' } } }, options);
    assert.deepStrictEqual(D.encode({ d: { a: new Date(1) } }), [{ a: 1 }]);
    assert.deepStrictEqual(D.decode([{ a: 1 }]), { d: { a: new Date(1) } });
    for (const bad of [[], 'x']) {
      assert.throws(() => D.encode({ d: bad }), { code: 'object', path: 'd' });
    }
    assert.deepStrictEqual(D.encode({ d: { a: 'x' } }), [{ a: null }]);
    for (const bad of [[], null, 'x']) {
      assert.throws(() => D.decode([bad === null ? 1 : bad]), { code: 'structure', path: 'd' });
    }
    assert.throws(() => D.decode([{ a: 'x' }]), { code: 'type', path: 'd.a' });
    assert.throws(() => D.decode([{ a: null }]), { code: 'type', path: 'd.a' });
    // `__proto__` is a key like any other: never the prototype of a decoded
    // or an encoded dictionary.
    const hostile = JSON.parse('{"__proto__":1,"b":2}');
    const decoded = D.decode([hostile]).d;
    assert.strictEqual(Object.getPrototypeOf(decoded), Object.prototype);
    assert.deepStrictEqual(Object.keys(decoded), ['__proto__', 'b']);
    assert.strictEqual(Object.getOwnPropertyDescriptor(decoded, '__proto__').value.getTime(), 1);
    const wire = D.encode({ d: decoded });
    assert.strictEqual(JSON.stringify(wire), '[{"__proto__":1,"b":2}]');
    // Values that travel as they are keep the object itself.
    const Plain = define({ d: { object: { string: '?number' } } }, options);
    const source = { a: 1, b: null };
    assert.strictEqual(Plain.encode({ d: source })[0], source);
    assert.strictEqual(Plain.decode([source]).d, source);
    assert.throws(() => Plain.decode([{ a: 'x' }]), { code: 'type', path: 'd.a' });
    const Required = define({ d: { object: { string: 'number' } } }, options);
    assert.throws(() => Required.decode([{ a: null }]), { code: 'type', path: 'd.a' });
    const Root = define({ object: { string: { id: 'number' } } }, options);
    assert.deepStrictEqual(Root.encode({ x: { id: 1 } }), { x: [1] });
    assert.throws(() => Root.decode({ x: ['a'] }), { code: 'type', path: 'x.id' });
  });

  test(`Types (${backend}): tuples of any elements`, () => {
    const T = define(
      {
        t: [{ at: 'date' }, { x: 'number', y: '?number' }, { 'tag?': 'string' }, { list: 'json' }],
      },
      options,
    );
    assert.deepStrictEqual(T.encode({ t: [new Date(1), { x: 1 }, null, 5] }), [[1, [1], null, 5]]);
    assert.deepStrictEqual(T.decode([[1, [1], null, null]]), {
      t: [new Date(1), { x: 1, y: null }, null, null],
    });
    assert.strictEqual(T.toString(), '{t:(date,{x:number,y:?number},?string,?json)}');
    assert.throws(() => T.decode([[1, ['a'], null, null]]), { code: 'type', path: 't[1].x' });
    assert.throws(() => T.decode([[1, null, null, null]]), { code: 'required', path: 't[1]' });
    const D = define({ t: [{ type: 'number', default: 5 }, 'string'] }, options);
    assert.deepStrictEqual(D.decode([[null, 'a']]), { t: [5, 'a'] });
    assert.strictEqual(D.toString(), '{t:(?number=5,string)}');
  });
}
