const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');

for (const [backend, options] of BACKENDS) {
  const V1 = Schema.from({ id: 'number', name: 'string' }, options);
  const V2 = Schema.from(
    { id: 'number', name: 'string', email: '?string', score: { type: 'number', default: 0 } },
    options,
  );

  test(`Evolution (${backend}): a newer decoder reads an older payload`, () => {
    const wire = V1.encode({ id: 1, name: 'Alex' });
    assert.deepStrictEqual(V2.decode(wire), { id: 1, name: 'Alex', email: null, score: 0 });
    assert.deepStrictEqual(V2.decode(wire, { strict: true }), {
      id: 1,
      name: 'Alex',
      email: null,
      score: 0,
    });
  });

  test(`Evolution (${backend}): an older decoder reads a newer payload`, () => {
    const wire = V2.encode({ id: 1, name: 'Alex', email: 'a@b.c', score: 5 });
    assert.deepStrictEqual(wire, [1, 'Alex', 'a@b.c', 5]);
    assert.deepStrictEqual(V1.decode(wire), { id: 1, name: 'Alex' });
    assert.throws(() => V1.decode(wire, { strict: true }), { code: 'extra', path: '' });
  });

  test(`Evolution (${backend}): a new required field without a default is breaking`, () => {
    const V3 = Schema.from({ id: 'number', name: 'string', org: 'string' }, options);
    assert.throws(() => V3.decode(V1.encode({ id: 1, name: 'x' })), {
      code: 'required',
      path: 'org',
    });
  });

  test(`Evolution (${backend}): nested records and arrays of records grow the same way`, () => {
    const A1 = Schema.from(
      { items: { array: { sku: 'string' } }, home: { city: 'string' } },
      options,
    );
    const A2 = Schema.from(
      {
        items: { array: { sku: 'string', qty: '?number' } },
        home: { city: 'string', zip: '?string' },
      },
      options,
    );
    const value = { items: [{ sku: 'A' }], home: { city: 'Kyiv' } };
    assert.deepStrictEqual(A2.decode(A1.encode(value)), {
      items: [{ sku: 'A', qty: null }],
      home: { city: 'Kyiv', zip: null },
    });
    const newer = A2.encode({
      items: [{ sku: 'A', qty: 2 }],
      home: { city: 'Kyiv', zip: '01001' },
    });
    assert.deepStrictEqual(A1.decode(newer), value);
    assert.throws(() => A1.decode(newer, { strict: true }), { code: 'extra', path: 'items[0]' });
  });

  test(`Evolution (${backend}): sparse records grow the same way`, () => {
    const S1 = Schema.from({ a: '?number', b: '?number' }, { ...options, sparse: true });
    const S2 = Schema.from(
      { a: '?number', b: '?number', c: '?number' },
      { ...options, sparse: true },
    );
    const newer = S2.encode({ a: 1, c: 3 });
    assert.deepStrictEqual(newer, [5, 1, 3]);
    assert.deepStrictEqual(S1.decode(newer), { a: 1, b: null });
    assert.throws(() => S1.decode(newer, { strict: true }), { code: 'extra' });
    assert.deepStrictEqual(S2.decode(S1.encode({ b: 2 })), { a: null, b: 2, c: null });
  });

  test(`Evolution (${backend}): sparse records grow past 31 fields`, () => {
    const narrow = {};
    for (let i = 0; i < 31; i++) narrow[`f${i}`] = '?number';
    const wide = { ...narrow };
    for (let i = 31; i < 40; i++) wide[`f${i}`] = '?number';
    const N = Schema.from(narrow, { ...options, sparse: true });
    const W = Schema.from(wide, { ...options, sparse: true });
    // An older decoder reads the first segment and ignores the next one.
    const wire = W.encode({ f0: 1, f35: 2 });
    assert.deepStrictEqual(wire, [1, 1, 16, 2]);
    assert.strictEqual(N.decode(wire).f0, 1);
    assert.throws(() => N.decode(wire, { strict: true }), { code: 'extra' });
    // A newer decoder reads an older payload as is.
    assert.deepStrictEqual(W.decode(N.encode({ f30: 7 })).f30, 7);
    assert.deepStrictEqual(W.encode({ f30: 7 }), N.encode({ f30: 7 }));
  });

  test(`Evolution (${backend}): flags grow past 31 names`, () => {
    const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const Narrow = Schema.from({ p: { flags: names.slice(0, 31) } }, options);
    const Wide = Schema.from({ p: { flags: names } }, options);
    assert.deepStrictEqual(Wide.encode({ p: { n1: true } }), Narrow.encode({ p: { n1: true } }));
    const wire = Wide.encode({ p: { n1: true, n35: true } });
    assert.deepStrictEqual(wire, [[2, 16]]);
    assert.deepStrictEqual(Narrow.decode(wire).p.n1, true);
    assert.deepStrictEqual(Wide.decode([2]).p.n35, false);
  });

  test(`Evolution (${backend}): columns grow the same way`, () => {
    const C1 = Schema.from({ array: { a: 'number' } }, { ...options, layout: 'columns' });
    const C2 = Schema.from(
      { array: { a: 'number', b: '?string' } },
      { ...options, layout: 'columns' },
    );
    const newer = C2.encode([{ a: 1, b: 'x' }, { a: 2 }]);
    assert.deepStrictEqual(C1.decode(newer), [{ a: 1 }, { a: 2 }]);
    assert.throws(() => C1.decode(newer, { strict: true }), { code: 'extra' });
    assert.deepStrictEqual(C2.decode(C1.encode([{ a: 1 }])), [{ a: 1, b: null }]);
  });

  test(`Evolution (${backend}): reordering positions is breaking`, () => {
    const X = Schema.from({ a: 'string', b: 'string' }, options);
    const Y = Schema.from({ b: 'string', a: 'string' }, options);
    assert.deepStrictEqual(Y.decode(X.encode({ a: 'A', b: 'B' })), { b: 'A', a: 'B' });
    assert.notStrictEqual(X.id, Y.id);
  });

  test(`Evolution (${backend}): appended enum values need the decoders first`, () => {
    const E1 = Schema.from({ r: { enum: ['a', 'b'] } }, options);
    const E2 = Schema.from({ r: { enum: ['a', 'b', 'c'] } }, options);
    assert.deepStrictEqual(E2.decode(E1.encode({ r: 'b' })), { r: 'b' });
    assert.throws(() => E1.decode(E2.encode({ r: 'c' })), { code: 'enum', path: 'r' });
  });

  test(`Evolution (${backend}): a union grows at the end, its branches like structs`, () => {
    const call = { Struct: {}, type: { enum: ['call'] }, id: 'string' };
    const U1 = Schema.from({ union: [call], discriminator: 'type' }, options);
    const U2 = Schema.from(
      {
        union: [
          { ...call, timeout: '?number' },
          { Struct: {}, type: { enum: ['event'] }, name: 'string' },
        ],
        discriminator: 'type',
      },
      options,
    );
    // A newer decoder reads every older packet; an older one reads the old
    // branches of a newer sender and ignores their new fields.
    assert.deepStrictEqual(U2.decode(U1.encode({ type: 'call', id: '1' })), {
      type: 'call',
      id: '1',
      timeout: null,
    });
    assert.deepStrictEqual(U1.decode(U2.encode({ type: 'call', id: '1', timeout: 5 })), {
      type: 'call',
      id: '1',
    });
    // A new branch needs the decoders first, like an appended enum value.
    assert.throws(() => U1.decode(U2.encode({ type: 'event', name: 'x' })), {
      code: 'union',
      path: 'type',
    });
    // A branch inserted before the others moves every later tag: breaking.
    const Moved = Schema.from(
      {
        union: [{ Struct: {}, type: { enum: ['event'] }, name: 'string' }, call],
        discriminator: 'type',
      },
      options,
    );
    assert.deepStrictEqual(Moved.decode(U1.encode({ type: 'call', id: '1' })), {
      type: 'event',
      name: '1',
    });
    assert.notStrictEqual(Moved.id, U2.id);
  });

  test(`Evolution (${backend}): renaming keeps the wire and changes the id`, () => {
    const Old = Schema.from({ name: 'string' }, options);
    const New = Schema.from({ fullName: 'string' }, options);
    assert.deepStrictEqual(New.decode(Old.encode({ name: 'Alex' })), { fullName: 'Alex' });
    assert.notStrictEqual(Old.id, New.id);
    assert.strictEqual(Old.id, Schema.from({ name: 'string' }, { codegen: !options.codegen }).id);
  });
}
