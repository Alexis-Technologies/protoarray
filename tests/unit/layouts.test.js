const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');

for (const [backend, options] of BACKENDS) {
  test(`Layouts (${backend}): sparse records carry a presence mask`, () => {
    const S = Schema.from(
      { a: 'number', b: '?string', c: '?string' },
      { ...options, sparse: true },
    );
    assert.strictEqual(S.layout, 'sparse');
    assert.deepStrictEqual(S.encode({ a: 1 }), [1, 1]);
    assert.deepStrictEqual(S.encode({ a: 1, c: 'x' }), [5, 1, 'x']);
    assert.deepStrictEqual(S.encode({ a: 1, b: null, c: 'x' }), [5, 1, 'x']);
    assert.deepStrictEqual(S.encode({}), [0]);
    assert.deepStrictEqual(S.decode([5, 1, 'x']), { a: 1, b: null, c: 'x' });
    assert.deepStrictEqual(S.decode([5, 1, 'x', 'ignored']), { a: 1, b: null, c: 'x' });
    assert.throws(() => S.decode([5, 1, 'x', 'ignored'], { strict: true }), {
      code: 'extra',
      path: '',
    });
    assert.throws(() => S.decode([0]), { code: 'required', path: 'a' });
    assert.throws(() => S.decode([1]), { code: 'required', path: 'a' });
    assert.throws(() => S.decode([]), {
      code: 'structure',
      path: '',
      message: 'Value is not a sparse mask',
    });
    assert.throws(() => S.decode(['x']), { code: 'structure' });
    assert.throws(() => S.decode([1.5]), { code: 'structure' });
    assert.throws(() => S.decode([3, 1, 2]), { code: 'type', path: 'b' });
    const Outer = Schema.from({ s: S, list: { array: S } }, options);
    assert.deepStrictEqual(Outer.encode({ s: { a: 1 }, list: [{ a: 2, c: 'x' }] }), [
      [1, 1],
      [[5, 2, 'x']],
    ]);
    assert.deepStrictEqual(Outer.decode([[1, 1], [[5, 2, 'x']]]), {
      s: { a: 1, b: null, c: null },
      list: [{ a: 2, b: null, c: 'x' }],
    });
    assert.throws(() => Outer.decode([[1, 1], [[5, 2, 3]]]), { path: 'list[0].c' });
  });

  test(`Layouts (${backend}): sparse records use up to 31 bits`, () => {
    const definition = {};
    for (let i = 0; i < 31; i++) definition[`f${i}`] = '?number';
    const S = Schema.from(definition, { ...options, sparse: true });
    assert.deepStrictEqual(S.encode({ f30: 1 }), [1073741824, 1]);
    assert.strictEqual(S.decode([1073741824, 1]).f30, 1);
    assert.strictEqual(S.decode([1073741824, 1]).f0, null);
  });

  test(`Layouts (${backend}): flat concatenates fixed-width rows`, () => {
    const F = Schema.from(
      { array: { a: 'number', b: '?string', c: { x: 'number' } } },
      { ...options, layout: 'flat' },
    );
    assert.strictEqual(F.layout, 'flat');
    const list = [
      { a: 1, c: { x: 1 } },
      { a: 2, b: 'y', c: { x: 2 } },
    ];
    const wire = F.encode(list);
    assert.deepStrictEqual(wire, [1, null, [1], 2, 'y', [2]]);
    assert.deepStrictEqual(F.decode(wire), [
      { a: 1, b: null, c: { x: 1 } },
      { a: 2, b: 'y', c: { x: 2 } },
    ]);
    assert.deepStrictEqual(F.encode([]), []);
    assert.deepStrictEqual(F.decode([]), []);
    assert.deepStrictEqual(F.encode([null]), [null, null, null]);
    assert.throws(() => F.decode([null, null, null]), { code: 'required', path: '[0].a' });
    assert.throws(() => F.decode([1]), {
      code: 'structure',
      path: '',
      message: 'Value has a wrong length',
    });
    assert.throws(() => F.decode('x'), { code: 'structure' });
    assert.throws(() => F.decode([1, null, [1], 2, 'y', ['x']]), { path: '[1].c.x', code: 'type' });
    assert.deepStrictEqual(F.decode(wire, { strict: true }), F.decode(wire));
  });

  test(`Layouts (${backend}): columns transpose the rows`, () => {
    const C = Schema.from(
      { array: { a: 'number', b: '?string' } },
      { ...options, layout: 'columns' },
    );
    assert.strictEqual(C.layout, 'columns');
    const wire = C.encode([{ a: 1 }, { a: 2, b: 'y' }]);
    assert.deepStrictEqual(wire, [
      [1, 2],
      [null, 'y'],
    ]);
    assert.deepStrictEqual(C.decode(wire), [
      { a: 1, b: null },
      { a: 2, b: 'y' },
    ]);
    assert.deepStrictEqual(C.encode([]), [[], []]);
    assert.deepStrictEqual(C.decode([]), []);
    assert.deepStrictEqual(C.decode([[], []]), []);
    assert.deepStrictEqual(C.encode([null]), [[null], [null]]);
    assert.throws(() => C.decode([[null], [null]]), { code: 'required', path: '[0].a' });
    assert.deepStrictEqual(C.decode([[1, 2]]), [
      { a: 1, b: null },
      { a: 2, b: null },
    ]);
    assert.throws(() => C.decode([[1, 2], [null]]), {
      code: 'structure',
      path: '[1]',
      message: 'Field "[1]" has a wrong length',
    });
    assert.throws(() => C.decode([[1], 'x']), {
      code: 'structure',
      path: '[1]',
      message: 'Field "[1]" is not an array',
    });
    assert.throws(() => C.decode([[1], [5]]), { code: 'type', path: '[0].b' });
    assert.throws(() => C.decode('x'), { code: 'structure', path: '' });
    assert.deepStrictEqual(
      C.decode([
        [1, 2],
        [null, 'y'],
        [9, 9],
      ]),
      [
        { a: 1, b: null },
        { a: 2, b: 'y' },
      ],
    );
    assert.throws(
      () =>
        C.decode(
          [
            [1, 2],
            [null, 'y'],
            [9, 9],
          ],
          { strict: true },
        ),
      { code: 'extra' },
    );
  });
}
