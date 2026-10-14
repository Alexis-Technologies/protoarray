const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');

for (const [backend, options] of BACKENDS) {
  test(`Types (${backend}): enum`, () => {
    const E = Schema.from({ role: { enum: ['admin', 'editor'] } }, options);
    assert.deepStrictEqual(E.encode({ role: 'nope' }), [null]);
    assert.deepStrictEqual(E.encode({ role: {} }), [null]);
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
    const D = Schema.from({ at: 'date', list: { array: 'date' } }, options);
    assert.deepStrictEqual(D.encode({ at: new Date(5), list: [new Date(1), 2] }), [5, [1, 2]]);
    assert.deepStrictEqual(D.encode({ at: 'nope', list: [new Date(NaN)] }), [null, [null]]);
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
    const F = Schema.from({ p: { flags: ['a', 'b', 'c'] } }, options);
    assert.deepStrictEqual(F.encode({ p: { a: true, c: 1, zzz: true } }), [5]);
    assert.deepStrictEqual(F.encode({ p: {} }), [0]);
    assert.deepStrictEqual(F.encode({ p: 'str' }), [0]);
    assert.deepStrictEqual(F.decode([5]), { p: { a: true, b: false, c: true } });
    assert.deepStrictEqual(F.decode([13]), { p: { a: true, b: false, c: true } });
    assert.deepStrictEqual(Object.keys(F.decode([0]).p), ['a', 'b', 'c']);
    for (const bad of [1.5, -1, '5', 5n, Symbol('5')]) {
      assert.throws(() => F.decode([bad]), { code: 'type', path: 'p' });
    }
    const Optional = Schema.from({ p: { flags: ['a'], required: false } }, options);
    assert.deepStrictEqual(Optional.encode({}), []);
    assert.deepStrictEqual(Optional.decode([]), { p: null });
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
    const T = Schema.from({ t: ['number', '?string', 'date'] }, options);
    assert.deepStrictEqual(T.encode({ t: [1, 'x', new Date(5)] }), [[1, 'x', 5]]);
    assert.deepStrictEqual(T.encode({ t: [1] }), [[1, null, null]]);
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
    const Root = Schema.from(['number', 'string'], options);
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
      options,
    );
    assert.deepStrictEqual(A.encode({ list: ['b', 'zzz'], big: [1n] }), [[1, null], ['1']]);
    assert.deepStrictEqual(A.decode([[1, 0], ['1']]), { list: ['b', 'a'], big: [1n] });
    assert.throws(() => A.decode([[1, null], ['1']]), { code: 'type', path: 'list[1]' });
    assert.throws(() => A.decode([[1, 7], ['1']]), { code: 'enum', path: 'list[1]' });
    assert.throws(() => A.decode([[1], 'x']), { code: 'structure', path: 'big' });
  });
}
