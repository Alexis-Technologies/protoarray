const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, SchemaDefinitionError } = require('../../index.js');
const { BACKENDS, normalize } = require('../support/backends.js');

const incompatible = (writer, reader, expected, options) => {
  assert.throws(
    () => Schema.resolve(writer, reader, options),
    (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.strictEqual(error.code, 'ERR_INCOMPATIBLE');
      if (expected.field !== undefined) assert.strictEqual(error.field, expected.field);
      if (expected.message !== undefined) assert.strictEqual(error.message, expected.message);
      return true;
    },
  );
};

for (const [backend, options] of BACKENDS) {
  const both = { ...options, validate: 'both' };

  test(`Resolve (${backend}): the writer's wire under the reader's keys`, () => {
    const V1 = Schema.from({ id: 'number', fullName: 'string', legacy: '?string' }, options);
    const V2 = new Schema(
      'User',
      {
        email: { type: 'string', default: 'none' },
        id: 'number',
        name: { type: 'string', aliases: ['fullName'] },
        nick: '?string',
      },
      options,
    );
    const R = Schema.resolve(V1, V2);
    assert.strictEqual(R.backend, backend);
    assert.strictEqual(R.name, 'User');
    assert.strictEqual(R.definition, V2.definition);
    assert.deepStrictEqual(R.keys, ['email', 'id', 'name', 'nick']);
    assert.strictEqual(R.id, V1.id);
    assert.strictEqual(R.toString(), V1.toString());
    assert.strictEqual(R.layout, 'dense');
    const wire = V1.encode({ id: 1, fullName: 'Alex', legacy: 'x' });
    const decoded = R.decode(wire);
    assert.deepStrictEqual(decoded, { email: 'none', id: 1, name: 'Alex', nick: null });
    assert.deepStrictEqual(Object.keys(decoded), R.keys);
    // Written back as the writer writes: its positions, the reader's values.
    assert.deepStrictEqual(R.encode({ id: 2, name: 'Bo', email: 'e' }), [2, 'Bo']);
    assert.deepStrictEqual(V1.decode(R.encode(decoded)), { id: 1, fullName: 'Alex', legacy: null });
    assert.strictEqual(R.stringify(decoded), '[1,"Alex"]');
    assert.deepStrictEqual(R.parse('[1,"Alex","x"]'), decoded);
    assert.throws(() => R.decode([1, 'Alex', 'x', 4], { strict: true }), { code: 'extra' });
    assert.throws(() => R.decode([1]), { code: 'required', path: 'name' });
    assert.throws(() => R.decode(['x', 'y']), { code: 'type', path: 'id' });
    // The same canonical form: nothing to resolve.
    const Same = Schema.from(V1.definition, options);
    assert.strictEqual(Schema.resolve(Same, V1), V1);
    // A collection of resolved records reads the writer's rows.
    assert.strictEqual(R.list.id, V1.list.id);
    assert.deepStrictEqual(R.list.decode([wire, [3, 'C']]), [
      decoded,
      { email: 'none', id: 3, name: 'C', nick: null },
    ]);
  });

  test(`Resolve (${backend}): validation follows the reader's options`, () => {
    const W = Schema.from({ a: 'number', b: '?string', c: 'string' }, options);
    const R = Schema.resolve(W, Schema.from({ a: 'number', b: 'string' }, both));
    // Required on decode is the reader's, on encode the writer's: c is
    // required by the writer and the reader has no value for it.
    assert.throws(() => R.decode([1, null, 'x']), { code: 'required', path: 'b' });
    assert.throws(() => R.encode({ a: 1, b: 'x' }), {
      code: 'required',
      path: 'c',
      message: 'Field "c" is required',
    });
    assert.strictEqual(R.check({ a: 1, b: 'x' }).path, 'c');
    const Trusting = Schema.resolve(W, Schema.from({ a: 'number', b: 'string' }, options));
    assert.deepStrictEqual(Trusting.encode({ a: 1, b: 'x' }), [1, 'x', null]);
    assert.strictEqual(Trusting.check({ a: 'x', b: 'x' }).path, 'a');
    const Loose = Schema.resolve(W, Schema.from({ a: 'number' }, { ...options, validate: false }));
    assert.deepStrictEqual(Loose.decode(['x']), { a: 'x' });
  });

  test(`Resolve (${backend}): scalar conversions`, () => {
    const W = Schema.from(
      {
        i: 'integer',
        big: 'integer',
        d: { type: 'number', decimals: 2 },
        wide: { type: 'number', decimals: 2 },
        e: { enum: ['a', 'b', 'c'] },
        s: { enum: ['x', 'y'] },
        choice: 'string',
        f: { flags: ['read', 'write', 'old'] },
        gone: '?string',
        any: 'date',
      },
      options,
    );
    const R = Schema.resolve(
      W,
      Schema.from(
        {
          i: 'number',
          big: 'bigint',
          d: 'number',
          wide: { type: 'number', decimals: 4 },
          e: { enum: ['c', 'a'], required: false },
          s: 'string',
          choice: { enum: ['x', 'y'], default: 'y' },
          f: { flags: ['admin', 'write', 'read'] },
          gone: 'null',
          any: 'json',
        },
        both,
      ),
    );
    const wire = W.encode({
      i: 3,
      big: 2 ** 40,
      d: 1.25,
      wide: 2.5,
      e: 'b',
      s: 'y',
      choice: 'q',
      f: { read: true, old: true },
      gone: 'x',
      any: new Date(5),
    });
    assert.deepStrictEqual(wire, [3, 2 ** 40, 125, 250, 1, 1, 'q', 5, 'x', 5]);
    const decoded = R.decode(wire);
    assert.deepStrictEqual(normalize(decoded), {
      i: 3,
      big: { $bigint: String(2 ** 40) },
      d: 1.25,
      wide: 2.5,
      // An enum value the reader dropped: the default, else null when optional.
      e: null,
      s: 'y',
      choice: 'y',
      f: { admin: false, write: false, read: true },
      gone: null,
      any: { $date: 5 },
    });
    assert.deepStrictEqual(R.decode([3, 1, 1, 1, 0, 0, 'x', 0, null, 1]).e, 'a');
    // Encoding goes through the writer's types.
    const back = R.encode({ ...decoded, e: 'a', choice: 'x', f: { write: true, admin: true } });
    assert.deepStrictEqual(back, [3, 2 ** 40, 125, 250, 0, 1, 'x', 2, null, 5]);
    const valid = { ...decoded, e: 'a' };
    assert.throws(() => R.encode({ ...valid, big: 2n ** 60n }), { code: 'type', path: 'big' });
    assert.throws(() => R.encode({ ...valid, big: 1.5 }), { code: 'type', path: 'big' });
    assert.deepStrictEqual(R.encode({ ...valid, big: 7 })[1], 7);
    assert.throws(() => R.encode({ ...valid, choice: 1 }), { code: 'enum', path: 'choice' });
    // The reader's null for a value the writer requires.
    assert.throws(() => R.encode(decoded), { code: 'required', path: 'e' });
    assert.throws(() => R.decode([1.5, 1, 1, 1, 0, 0, 'x', 0, null, 1]), { path: 'i' });
    assert.throws(() => R.decode([1, 1.5, 1, 1, 0, 0, 'x', 0, null, 1]), {
      code: 'type',
      path: 'big',
      message: 'Field "big" is not of expected type: integer',
    });
    assert.throws(() => R.decode([1, 1, 1, 1, 7, 0, 'x', 0, null, 1]), {
      code: 'enum',
      message: 'Field "e" is not of enum: c, a',
    });
    assert.throws(() => R.decode([1, 1, 1, 1, 0, 7, 'x', 0, null, 1]), {
      code: 'enum',
      message: 'Field "s" is not of enum: x, y',
    });
    assert.throws(() => R.decode([1, 1, 1, 1, 0, 0, 1, 0, null, 1]), {
      code: 'enum',
      path: 'choice',
    });
    assert.throws(() => R.decode([1, 1, 1, 1, 0, 0, 'x', 'x', null, 1]), {
      code: 'type',
      path: 'f',
    });
    // A value the reader cannot place in a required slot is an error.
    const Strict = Schema.resolve(W, Schema.from({ e: { enum: ['a'] } }, options));
    assert.throws(() => Strict.decode([1, 1, 1, 1, 1]), { code: 'enum', path: 'e' });
    assert.deepStrictEqual(Strict.decode([1, 1, 1, 1, 0]), { e: 'a' });
    // Trusted, the writer's value passes through.
    const Loose = Schema.resolve(
      W,
      Schema.from({ e: { enum: ['a'] } }, { ...options, validate: false }),
    );
    assert.deepStrictEqual(Loose.decode([1, 1, 1, 1, 1]), { e: 'b' });
    assert.deepStrictEqual(Loose.decode([1, 1, 1, 1, 9]), { e: 9 });
    const LooseBig = Schema.resolve(
      W,
      Schema.from({ big: 'bigint' }, { ...options, validate: false }),
    );
    assert.deepStrictEqual(LooseBig.decode([1, 'x']), { big: 'x' });
    // The writer's required fields after it keep their places as nulls.
    assert.deepStrictEqual(LooseBig.encode({ big: 'x' }), [null, 'x', ...Array(8).fill(null)]);
    const LooseFlags = Schema.resolve(
      W,
      Schema.from({ f: { flags: ['old'] } }, { ...options, validate: false }),
    );
    assert.deepStrictEqual(LooseFlags.decode([1, 1, 1, 1, 0, 0, 'x', 'z']), { f: 'z' });
    assert.deepStrictEqual(LooseFlags.decode([1, 1, 1, 1, 0, 0, 'x', [4]]), { f: { old: true } });
  });

  test(`Resolve (${backend}): conversions without validation`, () => {
    const W = Schema.from(
      { big: 'integer', e: { enum: ['a', 'b'] }, s: 'string', gone: '?string' },
      options,
    );
    const loose = { ...options, validate: false };
    const R = Schema.resolve(
      W,
      Schema.from({ big: 'bigint', e: { enum: ['a'] }, s: { enum: ['x'] }, gone: 'null' }, loose),
    );
    assert.deepStrictEqual(R.decode([1, 0, 'x', 'dropped']), {
      big: 1n,
      e: 'a',
      s: 'x',
      gone: null,
    });
    assert.deepStrictEqual(R.decode([1, 1, 'q']), { big: 1n, e: 'b', s: 'q', gone: null });
    assert.deepStrictEqual(R.encode({ big: 2n, e: 'b', s: 'x', gone: 'any' }), [2, 1, 'x']);
    const Optional = Schema.from({ big: 'integer', gone: '?string' }, options);
    const Checked = Schema.resolve(Optional, Schema.from({ gone: 'null', big: 'number' }, both));
    assert.throws(() => Checked.encode({ big: 1, gone: 'x' }), {
      code: 'type',
      message: 'Field "gone" is not of expected type: null',
    });
    // One schema used twice resolves once, and both places share it.
    const Address = Schema.from({ city: 'string' }, options);
    const Twice = Schema.from({ home: Address, work: Address }, options);
    const Reader = Schema.from({ city: 'string', zip: '?string' }, options);
    const RT = Schema.resolve(Twice, Schema.from({ home: Reader, work: Reader }, options));
    assert.deepStrictEqual(RT.decode([['a'], ['b']]), {
      home: { city: 'a', zip: null },
      work: { city: 'b', zip: null },
    });
  });

  test(`Resolve (${backend}): collections, tuples and nested records`, () => {
    const W = Schema.from(
      {
        list: { array: { a: 'number', b: '?string' } },
        tags: { set: 'string' },
        seen: { map: { string: 'integer' } },
        prices: { object: { string: 'integer' } },
        pair: ['number', 'string', '?boolean'],
        short: ['number'],
        nested: { x: '?number', y: '?number' },
      },
      options,
    );
    const R = Schema.resolve(
      W,
      Schema.from(
        {
          nested: { y: '?number', z: { type: 'string', default: 'z' } },
          list: { set: { b: '?string', a: 'number' } },
          tags: { array: 'string' },
          seen: { map: { string: 'number' } },
          prices: { object: { string: 'bigint' } },
          pair: ['number', 'string'],
          short: ['number', '?string', { type: 'number', default: 3 }],
        },
        both,
      ),
    );
    const wire = W.encode({
      list: [{ a: 1 }, { a: 2, b: 'x' }],
      tags: ['t'],
      seen: new Map([['k', 4]]),
      prices: { tea: 5 },
      pair: [1, 'p', true],
      short: [9],
      nested: { x: 1, y: 2 },
    });
    const decoded = R.decode(wire);
    assert.deepStrictEqual(normalize(decoded), {
      nested: { y: 2, z: 'z' },
      list: {
        $set: [
          { b: null, a: 1 },
          { b: 'x', a: 2 },
        ],
      },
      tags: ['t'],
      seen: { $map: [['k', 4]] },
      prices: { tea: { $bigint: '5' } },
      pair: [1, 'p'],
      short: [9, null, 3],
    });
    const back = R.encode(decoded);
    assert.deepStrictEqual(back, [
      [[1], [2, 'x']],
      ['t'],
      ['k', 4],
      { tea: 5 },
      [1, 'p', null],
      [9],
      [null, 2],
    ]);
    assert.throws(
      () => R.decode([[[1], ['x']], ['t'], ['k', 4], { tea: 5 }, [1, 'p', true], [9], [1]]),
      {
        code: 'type',
        path: 'list[1].a',
      },
    );
    assert.throws(() => R.encode({ ...decoded, list: [null] }), { code: 'type', path: 'list[0]' });
    assert.throws(() => R.encode({ ...decoded, seen: new Map([['k', null]]) }), {
      code: 'type',
      path: 'seen[0]',
    });
    // The writer's third element of `pair` is optional: the reader's two
    // elements leave it null.
    assert.deepStrictEqual(R.encode(decoded)[4], [1, 'p', null]);
  });

  test(`Resolve (${backend}): unions pair branches by their values`, () => {
    const W = Schema.from(
      {
        union: [
          { k: { enum: ['a'] }, x: 'number' },
          { k: { enum: ['b', 'c'] }, y: 'string' },
          { k: { enum: ['z'] }, n: '?number' },
        ],
        discriminator: 'k',
      },
      options,
    );
    const R = Schema.resolve(
      W,
      Schema.from(
        {
          union: [
            { y: '?string', k: { enum: ['c', 'b'] } },
            { k: { enum: ['a'] }, x: 'number', extra: { type: 'number', default: 9 } },
          ],
          discriminator: 'k',
        },
        both,
      ),
    );
    assert.deepStrictEqual(R.decode(W.encode({ k: 'a', x: 1 })), { k: 'a', x: 1, extra: 9 });
    const c = R.decode(W.encode({ k: 'c', y: 'q' }));
    assert.deepStrictEqual(c, { y: 'q', k: 'c' });
    assert.deepStrictEqual(Object.keys(c), ['y', 'k']);
    assert.deepStrictEqual(R.encode({ k: 'b', y: 'w' }), [1, 'w']);
    // The writer's branch the reader has no values of cannot be read, and the
    // reader cannot write a value the writer does not know.
    assert.throws(() => R.decode([3]), { code: 'union', path: 'k' });
    assert.throws(() => R.decode(W.encode({ k: 'z' })), { code: 'union', path: 'k' });
    assert.throws(() => R.encode({ k: 'z' }), { code: 'union', path: 'k' });
    assert.throws(() => R.encode({ k: 'q' }), { code: 'union', path: 'k' });
    const List = Schema.resolve(W.list, R.list);
    assert.deepStrictEqual(List.decode([[0, 1]]), [{ k: 'a', x: 1, extra: 9 }]);
  });

  test(`Resolve (${backend}): recursion and embedded schemas`, () => {
    const T1 = new Schema('Tree', { v: 'number', kids: { array: 'Tree' }, x: '?string' }, options);
    const T2 = new Schema(
      'Tree',
      { value: { type: 'number', aliases: ['v'] }, kids: { array: 'Tree' } },
      both,
    );
    const RT = Schema.resolve(T1, T2);
    const tree = { v: 1, kids: [{ v: 2, kids: [], x: 'a' }] };
    const read = { value: 1, kids: [{ value: 2, kids: [] }] };
    assert.deepStrictEqual(RT.decode(T1.encode(tree)), read);
    assert.deepStrictEqual(RT.encode(read), [1, [[2, []]]]);
    assert.strictEqual(
      RT.check({ value: 1, kids: [{ value: 'x', kids: [] }] }).path,
      'kids[0].value',
    );
    // A recursion inside an embedded schema compiles a codec of its own.
    const N1 = new Schema('Node', { id: 'number', next: '?Node' }, options);
    const N2 = new Schema('Node', { id: 'number', next: '?Node', tag: '?string' }, both);
    const H1 = Schema.from({ head: N1, size: 'number' }, options);
    const RH = Schema.resolve(H1, Schema.from({ size: 'number', head: N2 }, both));
    const wire = H1.encode({ head: { id: 1, next: { id: 2 } }, size: 2 });
    const head = { id: 1, next: { id: 2, next: null, tag: null }, tag: null };
    assert.deepStrictEqual(RH.decode(wire), { size: 2, head });
    assert.deepStrictEqual(RH.encode({ size: 2, head }), wire);
    assert.strictEqual(
      RH.check({ size: 2, head: { id: 1, next: { id: 'x' } } }).path,
      'head.next.id',
    );
    // A layout inside a record reads the writer's layout.
    const Flat = Schema.from({ array: { a: 'number' } }, { ...options, layout: 'flat' });
    const P1 = Schema.from({ items: Flat }, options);
    const P2 = Schema.from({ items: { array: { a: 'number', b: '?number' } } }, both);
    const RP = Schema.resolve(P1, P2);
    const items = [
      { a: 1, b: null },
      { a: 2, b: null },
    ];
    assert.deepStrictEqual(RP.decode([[1, 2]]), { items });
    assert.deepStrictEqual(RP.encode({ items }), [[1, 2]]);
    assert.strictEqual(RP.check({ items: [{ a: 'x' }] }).path, 'items[0].a');
    // A reader json slot takes the writer's decoded value.
    const RJ = Schema.resolve(P1, Schema.from({ items: 'json' }, options));
    assert.deepStrictEqual(RJ.decode([[1, 2]]), { items: [{ a: 1 }, { a: 2 }] });
    const Root = Schema.resolve(H1, Schema.from('json', options));
    assert.deepStrictEqual(Root.decode(wire), {
      head: { id: 1, next: { id: 2, next: null } },
      size: 2,
    });
    assert.strictEqual(Root.toString(), H1.toString());
  });

  test(`Resolve (${backend}): layouts and sparse records are the writer's`, () => {
    const S1 = Schema.from(
      { a: '?number', b: '?string', c: '?number' },
      { ...options, sparse: true },
    );
    const RS = Schema.resolve(S1, Schema.from({ c: '?number', a: '?number' }, options));
    assert.strictEqual(RS.layout, 'sparse');
    assert.deepStrictEqual(RS.decode(S1.encode({ a: 1, b: 'x', c: 3 })), { c: 3, a: 1 });
    assert.deepStrictEqual(RS.encode({ c: 5 }), [4, 5]);
    const C1 = Schema.from(
      { array: { a: 'number', b: 'string' } },
      { ...options, layout: 'columns' },
    );
    const RC = Schema.resolve(
      C1,
      Schema.from({ array: { b: 'string', a: 'number', z: '?string' } }, options),
    );
    assert.strictEqual(RC.layout, 'columns');
    const rows = [
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ];
    assert.deepStrictEqual(RC.decode(C1.encode(rows)), [
      { b: 'x', a: 1, z: null },
      { b: 'y', a: 2, z: null },
    ]);
    assert.deepStrictEqual(RC.encode(rows), C1.encode(rows));
    // A wide sparse record skips the reader's missing fields in every segment.
    const wide = {};
    for (let i = 0; i < 40; i++) wide[`f${i}`] = '?number';
    const W = Schema.from(wide, { ...options, sparse: true });
    const RW = Schema.resolve(W, Schema.from({ f35: '?number', f2: '?number' }, options));
    assert.deepStrictEqual(RW.decode(W.encode({ f1: 1, f2: 2, f31: 3, f35: 4 })), {
      f35: 4,
      f2: 2,
    });
    assert.deepStrictEqual(RW.encode({ f2: 1, f35: 2 }), [4, 1, 16, 2]);
    assert.throws(() => RW.decode([1, 1, 7], { strict: true }), { code: 'extra' });
  });

  test(`Resolve (${backend}): root scalars and tuples`, () => {
    const R = Schema.resolve(Schema.from('?integer', options), Schema.from('bigint', both));
    assert.strictEqual(R.decode(5), 5n);
    assert.throws(() => R.decode(null), { code: 'required' });
    assert.strictEqual(R.encode(null), null);
    assert.strictEqual(R.encode(7n), 7);
    const W = Schema.from(['number', 'string'], options);
    const T = Schema.resolve(W, Schema.from(['number'], both));
    assert.deepStrictEqual(T.decode([1, 'x']), [1]);
    // The writer requires the element the reader does not have.
    assert.throws(() => T.encode([1]), { code: 'required', path: '[1]' });
    assert.deepStrictEqual(Schema.resolve(W, Schema.from(['number'], options)).encode([1]), [
      1,
      null,
    ]);
    const Required = Schema.resolve(Schema.from('integer', options), Schema.from('number', both));
    assert.throws(() => Required.encode(null), { code: 'required' });
  });
}

for (const [backend, options] of BACKENDS) {
  test(`Resolve (${backend}): a resolved schema writes the writer's text`, () => {
    const W = Schema.from(
      {
        union: [
          { k: { enum: ['a'] }, n: 'integer', gone: 'integer' },
          { k: { enum: ['z'] }, at: 'date' },
        ],
        discriminator: 'k',
      },
      options,
    );
    for (const stringify of ['auto', 'builder']) {
      for (const validate of [true, 'both']) {
        const R = Schema.resolve(
          W,
          Schema.from(
            { union: [{ k: { enum: ['a'] }, n: 'integer' }], discriminator: 'k' },
            { ...options, stringify, validate },
          ),
        );
        const value = { k: 'a', n: 1 };
        const expected = (fn) => {
          try {
            return fn();
          } catch (error) {
            return `${error.code} ${error.path}`;
          }
        };
        assert.strictEqual(
          expected(() => R.stringify(value)),
          expected(() => JSON.stringify(R.encode(value))),
        );
        assert.strictEqual(
          expected(() => R.stringify({ k: 'z', at: new Date(1) })),
          expected(() => JSON.stringify(R.encode({ k: 'z', at: new Date(1) }))),
        );
      }
    }
  });
}

test('Resolve: aliases in the option, by reader path', () => {
  const W = Schema.from({ address: { town: 'string' }, orders: { array: { code: 'string' } } });
  const reader = Schema.from({ address: { city: 'string' }, orders: { array: { sku: 'string' } } });
  incompatible(W, reader, { field: 'address.city' });
  const R = Schema.resolve(W, reader, {
    aliases: { 'address.city': 'town', 'orders[].sku': ['old', 'code'] },
  });
  assert.deepStrictEqual(R.decode([['Kyiv'], [['A-1']]]), {
    address: { city: 'Kyiv' },
    orders: [{ sku: 'A-1' }],
  });
  // A writer field is claimed once: the first reader field to name it wins.
  const Twice = Schema.resolve(
    Schema.from({ a: 'string' }),
    Schema.from({
      x: { type: 'string', aliases: ['a'] },
      y: { type: 'string', aliases: ['a'], required: false },
    }),
  );
  assert.deepStrictEqual(Twice.decode(['v']), { x: 'v', y: null });
  for (const options of [
    1,
    { other: 1 },
    { aliases: [] },
    { aliases: { a: 1 } },
    { aliases: { a: [''] } },
  ]) {
    assert.throws(() => Schema.resolve(W, reader, options), { code: 'ERR_INVALID_OPTIONS' });
  }
  assert.strictEqual(Schema.resolve(W, Schema.from(W.definition), {}).toString(), W.toString());
  assert.strictEqual(Schema.resolve(W, Schema.from(W.definition), { aliases: undefined }).id, W.id);
  assert.throws(() => Schema.resolve(W, {}), { code: 'ERR_SCHEMA_EXPECTED' });
  assert.throws(() => Schema.resolve(null, W), { code: 'ERR_SCHEMA_EXPECTED' });
});

test('Resolve: what cannot be read is an error when resolving', () => {
  const from = (definition) => Schema.from(definition);
  incompatible(from({ a: 'string' }), from({ a: 'string', b: 'number' }), {
    field: 'b',
    message: 'Field "b" is required and the writer does not have it at "b"',
  });
  incompatible(from({ a: 'number' }), from({ a: 'integer' }), {
    message: 'Cannot read number as integer at "a"',
  });
  incompatible(
    from({ a: { type: 'number', decimals: 4 } }),
    from({ a: { type: 'number', decimals: 2 } }),
    {
      field: 'a',
    },
  );
  incompatible(from({ a: 'number' }), from({ a: { type: 'number', decimals: 2 } }), { field: 'a' });
  incompatible(from({ a: { enum: [1, 2] } }), from({ a: 'string' }), { field: 'a' });
  incompatible(from({ a: 'string' }), from({ a: { x: 'string' } }), {
    message: 'Cannot read string as {x:string} at "a"',
  });
  incompatible(from({ a: { x: 'string' } }), from({ a: ['string'] }), { field: 'a' });
  incompatible(
    from({ a: { map: { string: 'number' } } }),
    from({ a: { map: { number: 'number' } } }),
    {
      field: 'a',
    },
  );
  incompatible(from({ a: 'null' }), from({ a: 'string' }), {
    message: 'The writer always sends null where the reader requires a value at "a"',
  });
  incompatible(from({ t: ['number'] }), from({ t: ['number', 'string'] }), {
    message: 'A required element the writer does not have at "t[1]"',
  });
  incompatible(
    from({ union: [{ k: { enum: ['a'] } }], discriminator: 'k' }),
    from({ union: [{ j: { enum: ['a'] } }], discriminator: 'j' }),
    { message: 'Cannot read a union on "k" as one on "j"' },
  );
  incompatible(
    from({ union: [{ k: { enum: ['a', 'b'] } }], discriminator: 'k' }),
    from({ union: [{ k: { enum: ['a'] } }, { k: { enum: ['b'] } }], discriminator: 'k' }),
    { message: 'The values a, b are split between branches' },
  );
  incompatible(
    from({ union: [{ k: { enum: ['a', 'b'] } }], discriminator: 'k' }),
    from({ union: [{ k: { enum: ['b'] } }], discriminator: 'k' }),
    { field: '' },
  );
  // A null slot on the reader's side drops the writer's value; on the writer's
  // side it fills an optional reader slot.
  assert.deepStrictEqual(
    Schema.resolve(from({ a: 'null' }), from({ a: '?string' })).decode([null]),
    {
      a: null,
    },
  );
  assert.deepStrictEqual(
    Schema.resolve(from({ a: { x: 'string' } }), from({ a: 'null' })).decode([['x']]),
    { a: null },
  );
});
