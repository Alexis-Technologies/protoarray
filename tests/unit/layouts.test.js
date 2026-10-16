const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');
const { define } = require('../support/schema.js');

for (const [backend, options] of BACKENDS) {
  test(`Layouts (${backend}): sparse records carry a presence mask`, () => {
    const S = define({ a: 'number', b: '?string', c: '?string' }, { ...options, sparse: true });
    assert.strictEqual(S.layout, 'sparse');
    assert.deepStrictEqual(S.encode({ a: 1 }), [1, 1]);
    assert.deepStrictEqual(S.encode({ a: 1, c: 'x' }), [5, 1, 'x']);
    assert.deepStrictEqual(S.encode({ a: 1, b: null, c: 'x' }), [5, 1, 'x']);
    // The value is trusted: a missing required field is simply absent.
    for (const validate of [false, true]) {
      const Loose = Schema.from(S, { ...options, sparse: true, validate });
      assert.deepStrictEqual(Loose.encode({}), [0]);
    }
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
    assert.throws(() => S.decode([1n]), {
      code: 'structure',
      message: 'Value is not a sparse mask',
    });
    // A mask is a non-negative 31-bit integer, in every mode.
    for (const validate of [true, false]) {
      const M = Schema.from(S, { ...options, sparse: true, validate });
      for (const bad of [-1, -2147483648, 2 ** 31, 2 ** 32, 1.5, '1']) {
        assert.throws(
          () => M.decode([bad, 1]),
          { code: 'structure', message: 'Value is not a sparse mask' },
          String(bad),
        );
      }
    }
    // A bit past the schema's fields claims no value: it is ignored, like an extra element.
    assert.deepStrictEqual(S.decode([9, 1]), { a: 1, b: null, c: null });
    assert.deepStrictEqual(S.decode([9, 1], { strict: true }), { a: 1, b: null, c: null });
    assert.throws(() => S.decode([9, 1, 'next'], { strict: true }), { code: 'extra' });
    assert.throws(() => S.decode([3, 1, 2]), { code: 'type', path: 'b' });
    // An embedded schema is inlined: its places are sparse by path.
    const Outer = define(
      { s: S.source, list: { array: S.source } },
      { ...options, sparse: ['s', 'list[]'] },
    );
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

  test(`Layouts (${backend}): a sparse mask is 31 bits`, () => {
    const definition = {};
    for (let i = 0; i < 31; i++) definition[`f${i}`] = '?number';
    const S = define(definition, { ...options, sparse: true });
    assert.deepStrictEqual(S.encode({ f30: 1 }), [1073741824, 1]);
    assert.strictEqual(S.decode([1073741824, 1]).f30, 1);
    assert.strictEqual(S.decode([1073741824, 1]).f0, null);
    // Up to 31 fields the wire is one segment, as in 1.0: whatever follows is extra.
    assert.deepStrictEqual(S.decode([1, 1, 'next']).f0, 1);
    assert.throws(() => S.decode([1, 1, 'next'], { strict: true }), { code: 'extra' });
  });

  test(`Layouts (${backend}): wider sparse records take a segment per 31 fields`, () => {
    const definition = {};
    for (let i = 0; i < 70; i++) definition[`f${i}`] = '?number';
    definition.f1 = 'number';
    const S = define(definition, { ...options, sparse: true });
    // [mask0, ...values0, mask1, ...values1, mask2, ...values2], trailing empty segments trimmed.
    assert.deepStrictEqual(S.encode({ f1: 1, f3: 2, f35: 3 }), [10, 1, 2, 16, 3]);
    assert.deepStrictEqual(S.encode({ f1: 1 }), [2, 1]);
    assert.deepStrictEqual(S.encode({ f1: 1, f65: 9 }), [2, 1, 0, 8, 9]);
    assert.deepStrictEqual(S.encode({ f1: 1, f61: 4, f62: 5 }), [2, 1, 1073741824, 4, 1, 5]);
    const decoded = S.decode([10, 1, 2, 16, 3]);
    assert.deepStrictEqual([decoded.f1, decoded.f3, decoded.f35, decoded.f36], [1, 2, 3, null]);
    assert.strictEqual(Object.keys(decoded).length, 70);
    assert.strictEqual(S.decode([2, 1, 0, 8, 9]).f65, 9);
    // A missing segment is a segment of nulls; a strict decoder counts every element.
    assert.strictEqual(S.decode([2, 1]).f35, null);
    assert.deepStrictEqual(S.decode([2, 1, 0, 0], { strict: true }).f1, 1);
    assert.throws(() => S.decode([2, 1, 0, 0, 0, 'x'], { strict: true }), { code: 'extra' });
    // Past the first segment the next element must be a mask.
    assert.throws(() => S.decode([2, 1, 'x']), {
      code: 'structure',
      path: '',
      message: 'Value is not a sparse mask',
    });
    assert.throws(() => S.decode([2, 1, 1.5]), { code: 'structure' });
    assert.throws(() => S.decode([2, 1, -1]), { code: 'structure' });
    assert.throws(() => S.decode([0, 0]), { code: 'required', path: 'f1' });
    assert.throws(() => S.decode([2, 1, 16, 'x']), { code: 'type', path: 'f35' });
    // The value is trusted on the way in.
    assert.deepStrictEqual(S.encode({ f1: 1, f40: 'x' }), [2, 1, 512, 'x']);
  });

  test(`Layouts (${backend}): flat concatenates fixed-width rows`, () => {
    const F = define(
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
    // A null row is trusted, as any value: a row of nulls.
    for (const validate of [false, true]) {
      const LooseF = Schema.from(F, { ...options, layout: 'flat', validate });
      assert.deepStrictEqual(LooseF.encode([null]), [null, null, null]);
    }
    assert.throws(() => F.decode([null, null, null]), { code: 'required', path: '[0].a' });
    assert.throws(() => F.decode([1]), {
      code: 'structure',
      path: '',
      message: 'Value has a wrong length',
    });
    assert.throws(() => F.decode('x'), { code: 'structure' });
    assert.throws(() => F.decode([1, null, [1], 2, 'y', ['x']]), { path: '[1].c.x', code: 'type' });
    assert.deepStrictEqual(F.decode(wire, { strict: true }), F.decode(wire));
    assert.throws(() => F.encode(5), { code: 'array', path: '', message: 'Value is not an array' });
    assert.throws(() => F.encode({}), {
      code: 'array',
      path: '',
      message: 'Value is not an array',
    });
    assert.throws(() => F.encode([list[0], 7]), { code: 'object', path: '[1]' });
    assert.throws(() => F.encode([{ a: 1, c: 7 }]), { code: 'object', path: '[0].c' });
  });

  test(`Layouts (${backend}): columns transpose the rows`, () => {
    const C = define({ array: { a: 'number', b: '?string' } }, { ...options, layout: 'columns' });
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
    for (const validate of [false, true]) {
      const LooseC = Schema.from(C, { ...options, layout: 'columns', validate });
      assert.deepStrictEqual(LooseC.encode([null]), [[null], [null]]);
    }
    assert.throws(() => C.decode([[null], [null]]), { code: 'required', path: '[0].a' });
    assert.deepStrictEqual(C.decode([[1, 2]]), [
      { a: 1, b: null },
      { a: 2, b: null },
    ]);
    // A column is named by its field, for every record.
    assert.throws(() => C.decode([[1, 2], [null]]), {
      code: 'structure',
      path: '[].b',
      message: 'Field "[].b" has a wrong length',
    });
    assert.throws(() => C.decode([[1], 'x']), {
      code: 'structure',
      path: '[].b',
      message: 'Field "[].b" is not an array',
    });
    assert.throws(() => C.decode([[1], [5]]), { code: 'type', path: '[0].b' });
    assert.throws(() => C.decode('x'), { code: 'structure', path: '' });
    // A null column, explicit or missing, is a column of nulls; the count comes
    // from the first column present.
    assert.throws(() => C.decode([null, ['y']]), { code: 'required', path: '[0].a' });
    assert.deepStrictEqual(C.decode([null, null]), []);
    assert.deepStrictEqual(C.decode([null]), []);
    assert.throws(() => C.decode([null, 'x']), {
      code: 'structure',
      path: '[].b',
      message: 'Field "[].b" is not an array',
    });
    assert.throws(() => C.decode([[1], undefined]), { code: 'structure', path: '[].b' });
    assert.throws(() => C.encode(5), { code: 'array', path: '', message: 'Value is not an array' });
    assert.throws(() => C.encode({}), {
      code: 'array',
      path: '',
      message: 'Value is not an array',
    });
    assert.throws(() => C.encode([{ a: 1 }, 'x']), { code: 'object', path: '[1]' });
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

// The segment boundaries: 31 fields fill one word, the 32nd starts a segment.
for (const [backend, options] of BACKENDS) {
  test(`Layouts (${backend}): sparse records at the segment boundaries`, () => {
    for (const size of [31, 32, 62, 63, 64]) {
      const definition = {};
      for (let i = 0; i < size; i++) definition[`f${i}`] = '?number';
      const S = define(definition, { ...options, sparse: true });
      const last = `f${size - 1}`;
      const wire = S.encode({ [last]: 7 });
      const segments = Math.ceil(size / 31);
      assert.strictEqual(wire.length, segments + 1, `${size} fields`);
      assert.strictEqual(wire[wire.length - 2], 1 << ((size - 1) % 31), `${size} mask`);
      const decoded = S.decode(wire);
      assert.strictEqual(decoded[last], 7);
      assert.strictEqual(Object.keys(decoded).length, size);
      assert.deepStrictEqual(S.decode(wire, { strict: true }), decoded);
      assert.deepStrictEqual(S.encode({}), [0]);
      assert.deepStrictEqual(S.encode({ f0: 1 }), [1, 1]);
      const Outer = define(
        { s: S.source, list: { array: S.source } },
        { ...options, sparse: ['s', 'list[]'] },
      );
      const outer = Outer.decode(Outer.encode({ s: { [last]: 7 }, list: [{ f0: 1 }] }));
      assert.strictEqual(outer.s[last], 7);
      assert.strictEqual(outer.list[0].f0, 1);
    }
  });
}
