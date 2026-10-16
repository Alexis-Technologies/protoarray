const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, SchemaDefinitionError } = require('../../index.js');
const { resolve, register } = require('../../resolve.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { define, named, model } = require('../support/schema.js');

const incompatible = (writer, reader, expected, options) => {
  assert.throws(
    () => resolve(writer, reader, options),
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
  test(`Resolve (${backend}): the writer's wire under the reader's keys`, () => {
    const definition = { id: 'number', fullName: 'string', legacy: '?string' };
    const V1 = define(definition, options);
    const V2 = named(
      'User',
      {
        email: { type: 'string', default: 'none' },
        id: 'number',
        name: { type: 'string', aliases: ['fullName'] },
        nick: '?string',
      },
      options,
    );
    const R = resolve(V1, V2);
    assert.strictEqual(R.backend, backend);
    assert.strictEqual(R.name, 'User');
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
    const Same = define(definition, options);
    assert.strictEqual(resolve(Same, V1), V1);
    // A collection of resolved records reads the writer's rows.
    assert.strictEqual(R.list.id, V1.list.id);
    assert.deepStrictEqual(R.list.decode([wire, [3, 'C']]), [
      decoded,
      { email: 'none', id: 3, name: 'C', nick: null },
    ]);
  });

  test(`Resolve (${backend}): validation follows the reader's options`, () => {
    const W = define({ a: 'number', b: '?string', c: 'string' }, options);
    const R = resolve(W, define({ a: 'number', b: 'string' }, options));
    // Required on decode is the reader's.
    assert.throws(() => R.decode([1, null, 'x']), { code: 'required', path: 'b' });
    // Encode trusts the values: c, required by the writer, has no value in
    // the reader's object and is written as null.
    assert.deepStrictEqual(R.encode({ a: 1, b: 'x' }), [1, 'x', null]);
    const Loose = resolve(W, define({ a: 'number' }, { ...options, validate: false }));
    assert.deepStrictEqual(Loose.decode(['x']), { a: 'x' });
  });

  test(`Resolve (${backend}): scalar conversions`, () => {
    const W = define(
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
    const R = resolve(
      W,
      define(
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
        options,
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
    assert.deepStrictEqual(R.encode({ ...valid, big: 7n })[1], 7);
    assert.deepStrictEqual(R.encode({ ...valid, big: 7 })[1], 7);
    // The reader's null for a value the writer requires is written as null.
    assert.deepStrictEqual(R.encode(decoded)[4], null);
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
    const Strict = resolve(W, define({ e: { enum: ['a'] } }, options));
    assert.throws(() => Strict.decode([1, 1, 1, 1, 1]), { code: 'enum', path: 'e' });
    assert.deepStrictEqual(Strict.decode([1, 1, 1, 1, 0]), { e: 'a' });
    // Trusted, the writer's value passes through.
    const Loose = resolve(W, define({ e: { enum: ['a'] } }, { ...options, validate: false }));
    assert.deepStrictEqual(Loose.decode([1, 1, 1, 1, 1]), { e: 'b' });
    assert.deepStrictEqual(Loose.decode([1, 1, 1, 1, 9]), { e: 9 });
    const LooseBig = resolve(W, define({ big: 'bigint' }, { ...options, validate: false }));
    assert.deepStrictEqual(LooseBig.decode([1, 'x']), { big: 'x' });
    // The writer's required fields after it keep their places as nulls.
    assert.deepStrictEqual(LooseBig.encode({ big: 'x' }), [null, 'x', ...Array(8).fill(null)]);
    const LooseFlags = resolve(
      W,
      define({ f: { flags: ['old'] } }, { ...options, validate: false }),
    );
    assert.deepStrictEqual(LooseFlags.decode([1, 1, 1, 1, 0, 0, 'x', 'z']), { f: 'z' });
    assert.deepStrictEqual(LooseFlags.decode([1, 1, 1, 1, 0, 0, 'x', [4]]), { f: { old: true } });
  });

  test(`Resolve (${backend}): conversions without validation`, () => {
    const W = define(
      { big: 'integer', e: { enum: ['a', 'b'] }, s: 'string', gone: '?string' },
      options,
    );
    const loose = { ...options, validate: false };
    const R = resolve(
      W,
      define({ big: 'bigint', e: { enum: ['a'] }, s: { enum: ['x'] }, gone: 'null' }, loose),
    );
    assert.deepStrictEqual(R.decode([1, 0, 'x', 'dropped']), {
      big: 1n,
      e: 'a',
      s: 'x',
      gone: null,
    });
    assert.deepStrictEqual(R.decode([1, 1, 'q']), { big: 1n, e: 'b', s: 'q', gone: null });
    assert.deepStrictEqual(R.encode({ big: 2n, e: 'b', s: 'x', gone: 'any' }), [2, 1, 'x']);
    // The reader's null slot holds nothing: whatever it is given, it writes null.
    const Optional = define({ big: 'integer', gone: '?string' }, options);
    const Dropped = resolve(Optional, define({ gone: 'null', big: 'number' }, options));
    assert.deepStrictEqual(Dropped.encode({ big: 1, gone: 'x' }), [1]);
    assert.deepStrictEqual(Dropped.decode([1, 'x']), { gone: null, big: 1 });
    // One schema used twice resolves once, and both places share it.
    const twice = { Struct: {}, home: 'Address', work: 'Address' };
    const { Twice } = model({ Address: { Struct: {}, city: 'string' }, Twice: twice }, options);
    const Reader = model(
      {
        Address: { Struct: {}, city: 'string', zip: '?string' },
        Twice: { ...twice, note: '?string' },
      },
      options,
    ).Twice;
    const RT = resolve(Twice, Reader);
    assert.notStrictEqual(RT, Reader);
    assert.strictEqual(RT.toString(), '{home:@Address,work:@Address}');
    assert.deepStrictEqual(RT.decode([['a'], ['b']]), {
      home: { city: 'a', zip: null },
      work: { city: 'b', zip: null },
      note: null,
    });
    assert.throws(() => RT.decode([['a'], [1]]), { code: 'type', path: 'work.city' });
    assert.deepStrictEqual(RT.encode({ home: { city: 'a', zip: 'z' }, work: { city: 'b' } }), [
      ['a'],
      ['b'],
    ]);
  });

  test(`Resolve (${backend}): collections, tuples and nested records`, () => {
    const W = define(
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
    const R = resolve(
      W,
      define(
        {
          nested: { y: '?number', z: { type: 'string', default: 'z' } },
          list: { set: { b: '?string', a: 'number' } },
          tags: { array: 'string' },
          seen: { map: { string: 'number' } },
          prices: { object: { string: 'bigint' } },
          pair: ['number', 'string'],
          short: ['number', '?string', { type: 'number', default: 3 }],
        },
        options,
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
    assert.throws(() => R.encode({ ...decoded, list: new Set([5]) }), {
      code: 'object',
      path: 'list[0]',
    });
    assert.throws(() => R.encode({ ...decoded, seen: { k: 1 } }), { code: 'map', path: 'seen' });
    // The writer's third element of `pair` is optional: the reader's two
    // elements leave it null.
    assert.deepStrictEqual(R.encode(decoded)[4], [1, 'p', null]);
  });

  test(`Resolve (${backend}): unions pair branches by their values`, () => {
    const W = define(
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
    const R = resolve(
      W,
      define(
        {
          union: [
            { y: '?string', k: { enum: ['c', 'b'] } },
            { k: { enum: ['a'] }, x: 'number', extra: { type: 'number', default: 9 } },
          ],
          discriminator: 'k',
        },
        options,
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
    const List = resolve(W.list, R.list);
    assert.deepStrictEqual(List.decode([[0, 1]]), [{ k: 'a', x: 1, extra: 9 }]);
  });

  test(`Resolve (${backend}): recursion and schemas reached by a reference`, () => {
    const T1 = named('Tree', { v: 'number', kids: { array: 'Tree' }, x: '?string' }, options);
    const T2 = named(
      'Tree',
      { value: { type: 'number', aliases: ['v'] }, kids: { array: 'Tree' } },
      options,
    );
    const RT = resolve(T1, T2);
    const tree = { v: 1, kids: [{ v: 2, kids: [], x: 'a' }] };
    const read = { value: 1, kids: [{ value: 2, kids: [] }] };
    assert.deepStrictEqual(RT.decode(T1.encode(tree)), read);
    assert.deepStrictEqual(RT.encode(read), [1, [[2, []]]]);
    // Errors name the reader's keys, through the recursion.
    assert.throws(() => RT.decode([1, [['x', []]]]), { code: 'type', path: 'kids[0].value' });
    // A recursion inside a schema reached by a reference compiles a codec of its own.
    const node = { Struct: {}, id: 'number', next: '?Node' };
    const head = { Struct: {}, head: 'Node', size: 'number' };
    const H1 = model({ Node: node, Head: head }, options).Head;
    const H2 = model(
      { Node: { ...node, tag: '?string' }, Head: { Struct: {}, size: 'number', head: 'Node' } },
      options,
    ).Head;
    const RH = resolve(H1, H2);
    const wire = H1.encode({ head: { id: 1, next: { id: 2 } }, size: 2 });
    const value = { id: 1, next: { id: 2, next: null, tag: null }, tag: null };
    assert.deepStrictEqual(RH.decode(wire), { size: 2, head: value });
    assert.deepStrictEqual(RH.encode({ size: 2, head: value }), wire);
    assert.throws(() => RH.decode([[1, ['x']], 2]), { code: 'type', path: 'head.next.id' });
    // A layout inside a record reads the writer's layout.
    const P1 = define(
      { items: { array: { a: 'number' } } },
      { ...options, layout: { items: 'flat' } },
    );
    const P2 = define({ items: { array: { a: 'number', b: '?number' } } }, options);
    const RP = resolve(P1, P2);
    const items = [
      { a: 1, b: null },
      { a: 2, b: null },
    ];
    assert.deepStrictEqual(RP.decode([[1, 2]]), { items });
    assert.deepStrictEqual(RP.encode({ items }), [[1, 2]]);
    assert.throws(() => RP.decode([[1, 'x']]), { code: 'type', path: 'items[1].a' });
    // A reader json slot takes the writer's decoded value.
    const RJ = resolve(P1, define({ items: 'json' }, options));
    assert.deepStrictEqual(RJ.decode([[1, 2]]), { items: [{ a: 1 }, { a: 2 }] });
    const Root = resolve(H1, define('json', options));
    assert.deepStrictEqual(Root.decode(wire), {
      head: { id: 1, next: { id: 2, next: null } },
      size: 2,
    });
    assert.strictEqual(Root.toString(), H1.toString());
  });

  test(`Resolve (${backend}): layouts and sparse records are the writer's`, () => {
    const S1 = define({ a: '?number', b: '?string', c: '?number' }, { ...options, sparse: true });
    const RS = resolve(S1, define({ c: '?number', a: '?number' }, options));
    assert.strictEqual(RS.layout, 'sparse');
    assert.deepStrictEqual(RS.decode(S1.encode({ a: 1, b: 'x', c: 3 })), { c: 3, a: 1 });
    assert.deepStrictEqual(RS.encode({ c: 5 }), [4, 5]);
    const C1 = define({ array: { a: 'number', b: 'string' } }, { ...options, layout: 'columns' });
    const RC = resolve(C1, define({ array: { b: 'string', a: 'number', z: '?string' } }, options));
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
    const W = define(wide, { ...options, sparse: true });
    const RW = resolve(W, define({ f35: '?number', f2: '?number' }, options));
    assert.deepStrictEqual(RW.decode(W.encode({ f1: 1, f2: 2, f31: 3, f35: 4 })), {
      f35: 4,
      f2: 2,
    });
    assert.deepStrictEqual(RW.encode({ f2: 1, f35: 2 }), [4, 1, 16, 2]);
    assert.throws(() => RW.decode([1, 1, 7], { strict: true }), { code: 'extra' });
  });

  test(`Resolve (${backend}): root scalars and tuples`, () => {
    const R = resolve(define('?integer', options), define('bigint', options));
    assert.strictEqual(R.decode(5), 5n);
    assert.throws(() => R.decode(null), { code: 'required' });
    assert.strictEqual(R.encode(null), null);
    assert.strictEqual(R.encode(7n), 7);
    const W = define(['number', 'string'], options);
    const T = resolve(W, define(['number'], options));
    assert.deepStrictEqual(T.decode([1, 'x']), [1]);
    // The element the writer requires and the reader does not have is written as null.
    assert.deepStrictEqual(T.encode([1]), [1, null]);
    const Required = resolve(define('integer', options), define('number', options));
    assert.strictEqual(Required.decode(3), 3);
    assert.throws(() => Required.decode(null), { code: 'required' });
    assert.strictEqual(Required.encode(null), null);
  });
}

for (const [backend, options] of BACKENDS) {
  test(`Resolve (${backend}): a resolved schema writes the writer's text`, () => {
    const W = define(
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
      for (const validate of [true, false]) {
        const R = resolve(
          W,
          define(
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
  const W = define({ address: { town: 'string' }, orders: { array: { code: 'string' } } });
  const reader = define({ address: { city: 'string' }, orders: { array: { sku: 'string' } } });
  incompatible(W, reader, { field: 'address.city' });
  const R = resolve(W, reader, {
    aliases: { 'address.city': 'town', 'orders[].sku': ['old', 'code'] },
  });
  assert.deepStrictEqual(R.decode([['Kyiv'], [['A-1']]]), {
    address: { city: 'Kyiv' },
    orders: [{ sku: 'A-1' }],
  });
  // A writer field is claimed once: the first reader field to name it wins.
  // metaschema refuses one alias on two fields, the option does not.
  const Twice = resolve(
    define({ a: 'string' }),
    define({ x: { type: 'string', aliases: ['a'] }, y: '?string' }),
    { aliases: { y: 'a' } },
  );
  assert.deepStrictEqual(Twice.decode(['v']), { x: 'v', y: null });
  const Option = resolve(define({ a: 'string' }), define({ x: 'string', y: '?string' }), {
    aliases: { x: 'a', y: 'a' },
  });
  assert.deepStrictEqual(Option.decode(['v']), { x: 'v', y: null });
  // A path no field of the reader is at would lose the value without a word.
  for (const path of ['adress.city', 'orders.sku', 'address.city.x']) {
    const aliases = { 'address.city': 'town', 'orders[].sku': 'code', [path]: 'x' };
    assert.throws(() => resolve(W, reader, { aliases }), {
      code: 'ERR_INVALID_OPTIONS',
      field: path,
      message: `Option "aliases" names no field of the reader at "${path}"`,
    });
  }
  for (const options of [
    1,
    { other: 1 },
    { aliases: [] },
    { aliases: { a: 1 } },
    { aliases: { a: [''] } },
  ]) {
    assert.throws(() => resolve(W, reader, options), { code: 'ERR_INVALID_OPTIONS' });
  }
  assert.strictEqual(resolve(W, Schema.from(W), {}).toString(), W.toString());
  assert.strictEqual(resolve(W, Schema.from(W), { aliases: undefined }).id, W.id);
  // Both sides are protoarray schemas: a metaschema one is built first.
  for (const [writer, other] of [
    [W, {}],
    [null, W],
    [W.source, W],
    [W, reader.source],
  ]) {
    assert.throws(() => resolve(writer, other), {
      code: 'ERR_SCHEMA_EXPECTED',
      message: 'Schema instance expected',
    });
  }
});

test('Resolve: register() installs Schema.resolve', () => {
  const W = define({ id: 'number', fullName: 'string' });
  const reader = define({ id: 'number', name: { type: 'string', aliases: ['fullName'] } });
  assert.strictEqual(Schema.resolve, undefined);
  register();
  register();
  assert.strictEqual(Schema.resolve, resolve);
  assert.ok(!Object.keys(Schema).includes('resolve'));
  assert.deepStrictEqual(Schema.resolve(W, reader).decode([1, 'A']), { id: 1, name: 'A' });
});

test('Resolve: what cannot be read is an error when resolving', () => {
  const from = (definition) => define(definition);
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
  // A value of a branch the reader dropped is an error on decode, whichever
  // place it has in the branch; the others read as the reader's branch.
  for (const values of [
    ['a', 'b'],
    ['b', 'a'],
  ]) {
    const writer = from({ union: [{ k: { enum: values }, n: 'number' }], discriminator: 'k' });
    const reader = from({ union: [{ k: { enum: ['b'] }, n: 'number' }], discriminator: 'k' });
    const resolved = resolve(writer, reader);
    const at = values.indexOf('b');
    assert.deepStrictEqual(resolved.decode([at, 1]), { k: 'b', n: 1 });
    assert.throws(() => resolved.decode([1 - at, 1]), { code: 'union', path: 'k' });
    assert.deepStrictEqual(resolved.encode({ k: 'b', n: 2 }), [at, 2]);
    assert.deepStrictEqual(writer.decode(resolved.encode({ k: 'b', n: 2 })), { k: 'b', n: 2 });
  }
  // A null slot on the reader's side drops the writer's value; on the writer's
  // side it fills an optional reader slot.
  assert.deepStrictEqual(resolve(from({ a: 'null' }), from({ a: '?string' })).decode([null]), {
    a: null,
  });
  assert.deepStrictEqual(
    resolve(from({ a: { x: 'string' } }), from({ a: 'null' })).decode([['x']]),
    {
      a: null,
    },
  );
});

test('Resolve: a referenced entity that changed is read through', () => {
  const versions = [
    { city: 'string', street: 'string' },
    { street: 'string', city: 'string' },
  ].map(
    (address) =>
      model({ Address: { Struct: {}, ...address }, User: { Struct: {}, home: 'Address' } }).User,
  );
  const [writer, reader] = versions;
  const resolved = resolve(writer, reader);
  assert.notStrictEqual(resolved, reader);
  assert.strictEqual(resolved.id, writer.id);
  const wire = writer.encode({ home: { city: 'Kyiv', street: 'Main' } });
  assert.deepStrictEqual(resolved.decode(wire), { home: { street: 'Main', city: 'Kyiv' } });
  // The same version, references and all: the reader itself.
  const same = Schema.from(writer);
  assert.strictEqual(resolve(writer, same), same);
});

test('Resolve: through an alias, to the entity it stands for', () => {
  const versions = [{}, { 'y?': 'number' }].map(
    (more) =>
      model({
        Point: { Struct: {}, x: 'number', ...more },
        Spot: 'Point',
        Holder: { Struct: {}, p: 'Spot' },
      }).Holder,
  );
  const resolved = resolve(versions[0], versions[1]);
  assert.deepStrictEqual(resolved.decode([[1]]), { p: { x: 1, y: null } });
  assert.deepStrictEqual(resolved.encode({ p: { x: 1, y: 2 } }), [[1]]);
});

test("Resolve: a resolved schema has the writer's id, whatever its fingerprint", () => {
  const fingerprint = (text) => `v${text.length}`;
  const writer = define({ a: 'number' }, { fingerprint });
  const resolved = resolve(writer, define({ a: 'number', 'b?': 'string' }));
  assert.strictEqual(resolved.id, writer.id);
  assert.strictEqual(resolved.id, 'v10');
  const SIGNATURE = Symbol.for('alexify.protoarray.signature');
  assert.strictEqual(resolved[SIGNATURE], writer[SIGNATURE]);
});

test('Resolve: a chain too long for the stack is an error, not a RangeError', () => {
  const chain = (extra) => {
    const entities = {};
    for (let i = 0; i < 10000; i++) {
      entities[`E${i}`] = {
        fields: { n: { type: `E${i + 1}`, one: `E${i + 1}`, required: false } },
      };
    }
    entities.E10000 = { fields: { v: { type: 'number' }, ...extra } };
    return Schema.from({ format: 1, root: 'E0', entities }, { codegen: false });
  };
  const writer = chain({});
  const reader = chain({ w: { type: 'string', required: false } });
  incompatible(writer, reader, { message: 'The schemas are nested too deeply to resolve' });
});

test('Resolve: a root scalar that changes its optionality only', () => {
  const pairs = [
    ['string', '?string'],
    ['?string', 'string'],
  ];
  for (const [w, r] of pairs) {
    const writer = define(w);
    const reader = define(r);
    const resolved = resolve(writer, reader);
    assert.strictEqual(resolved.decode('x'), 'x');
    assert.strictEqual(resolved.id, writer.id);
  }
  assert.strictEqual(resolve(define('string'), define('?string')).decode(null), null);
  assert.throws(() => resolve(define('?string'), define('string')).decode(null), {
    code: 'required',
  });
});

test('Resolve: a resolved schema is no version of its own', () => {
  const { SchemaRegistry } = require('../../registry.js');
  const writer = define({ a: 'number' });
  const reader = define({ a: 'number', 'b?': 'string' }, { stringify: 'native' });
  const resolved = resolve(writer, reader);
  for (const [w, r] of [
    [resolved, reader],
    [writer, resolved],
  ]) {
    assert.throws(() => resolve(w, r), {
      code: 'ERR_SCHEMA_EXPECTED',
      message: 'A resolved schema is no version to resolve: give its writer or its reader',
    });
  }
  assert.throws(() => new SchemaRegistry([resolved]), {
    code: 'ERR_SCHEMA_EXPECTED',
    message: 'A resolved schema is no version of its own: give its writer or its reader',
  });
  // It keeps the reader's options: here, no text builder.
  const SETTINGS = Symbol.for('alexify.protoarray.settings');
  assert.strictEqual(resolved[SETTINGS].stringify, 'native');
});

test('Resolve: long enums and many branches resolve in linear time', () => {
  const values = Array.from({ length: 40000 }, (_, i) => `v${i}`);
  const enums = (list) => define({ e: { enum: list } });
  const started = Date.now();
  const resolved = resolve(enums(values), enums(values.slice().reverse()));
  assert.ok(Date.now() - started < 2000);
  assert.deepStrictEqual(resolved.decode([3]), { e: 'v3' });
});
