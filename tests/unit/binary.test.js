const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { Schema, DecodeError, EncodeError, SchemaDefinitionError } = require('../../index.js');
const { toBinary, fromBinary, register } = require('../../binary.js');
const { resolve } = require('../../resolve.js');
const codegen = require('../../src/codegen.js');
const { kernel } = require('../../src/binary/wire.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { VECTORS, Address } = require('../support/vectors.js');
const { generate } = require('../support/generate.js');
const { define, named, model } = require('../support/schema.js');

const RUNTIME = {
  node: require('../../src/runtime/node.js'),
  browser: require('../../src/runtime/browser.js'),
};

const SEEDS = 120;

// The options of the text wire a binary wire has no form for.
const refused = (options = {}) =>
  options.intern !== undefined || options.delta !== undefined || options.layout !== undefined;

const roundTrip = (schema, value) => normalize(fromBinary(schema, toBinary(schema, value)));
const expected = (schema, value) => normalize(schema.decode(schema.encode(value)));

const outcome = (fn) => {
  try {
    return { value: normalize(fn()) };
  } catch (error) {
    if (!(error instanceof DecodeError || error instanceof EncodeError)) {
      return { name: error.name, message: error.message };
    }
    const { name, code, path, message, schema } = error;
    return { name, code, path, message, schema };
  }
};

const GARBAGE = ['oops', 1.5, [], {}, null, true, -1];
const BAD_VALUES = [...GARBAGE, undefined, NaN, new Date(NaN), 1n, 'b', [null]];

// A copy of the value with one slot, at any depth, replaced by garbage.
const corrupt = (value, random) => {
  const copy = Array.isArray(value) ? value.slice() : { ...value };
  const keys = Object.keys(copy);
  if (keys.length === 0) return copy;
  const key = keys[Math.floor(random() * keys.length)];
  const inner = copy[key];
  const deeper = inner !== null && typeof inner === 'object' && !(inner instanceof Date);
  if (deeper && random() < 0.5) copy[key] = corrupt(inner, random);
  else copy[key] = BAD_VALUES[Math.floor(random() * BAD_VALUES.length)];
  return copy;
};

// A copy of the message with one byte changed, one appended or the end cut.
const corruptBytes = (bytes, random) => {
  const roll = random();
  if (roll < 0.1) return bytes.subarray(0, Math.floor(random() * bytes.length));
  if (roll < 0.2) return Uint8Array.from([...bytes, Math.floor(random() * 256)]);
  const copy = Uint8Array.from(bytes);
  copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
  return copy;
};

for (const [backend, options] of BACKENDS) {
  test(`Binary (${backend}): the vectors round-trip, or are refused for their wire options`, () => {
    for (const vector of VECTORS) {
      const schema = define(vector.definition, { ...vector.options, ...options });
      assert.strictEqual(schema.backend, backend);
      if (refused(vector.options)) {
        assert.throws(
          () => toBinary(schema, vector.value),
          { name: 'SchemaDefinitionError', code: 'ERR_NO_BINARY_FORM' },
          vector.name,
        );
        continue;
      }
      const bytes = toBinary(schema, vector.value);
      assert.strictEqual(Object.getPrototypeOf(bytes), Uint8Array.prototype, vector.name);
      assert.deepStrictEqual(normalize(fromBinary(schema, bytes)), expected(schema, vector.value));
    }
  });

  test(`Binary (${backend}): strings of every form come back as they were`, () => {
    const S = define({ s: 'string', list: { array: 'string' } }, options);
    const lone = String.fromCharCode(0xd800);
    const strings = [
      '',
      'a',
      'abcdefgh',
      'abcdefghi',
      'ыы',
      'ы'.repeat(4),
      'x'.repeat(21),
      'x'.repeat(22),
      'Олена',
      'ы'.repeat(21),
      'ы'.repeat(22),
      '€'.repeat(21),
      '€'.repeat(22),
      '😀',
      '😀'.repeat(10),
      '😀'.repeat(11),
      `${lone}lone`,
      `lone${lone}`,
      `${lone.repeat(21)}`,
      `long ${lone} ${'x'.repeat(30)}`,
      String.fromCharCode(0xdc00),
      String.fromCharCode(0x2028, 0x2029),
      'Шановні студенти! У зв’язку з проведенням конференції заняття переносяться. '.repeat(4),
      'a'.repeat(5000),
      'ы'.repeat(40000),
    ];
    for (const s of strings) {
      const value = { s, list: [s, 'b'] };
      assert.deepStrictEqual(
        roundTrip(S, value),
        expected(S, value),
        JSON.stringify(s).slice(0, 40),
      );
    }
  });

  test(`Binary (${backend}): integers, dates, decimals and bigints at their edges`, () => {
    const N = define(
      {
        i: 'integer',
        'd?': 'date',
        m: { type: 'number', decimals: 2 },
        z: { type: 'number', decimals: 0 },
        g: 'bigint',
        n: 'number',
      },
      options,
    );
    const edges = [
      0,
      1,
      -1,
      63,
      64,
      -64,
      -65,
      2 ** 31 - 1,
      2 ** 31,
      -(2 ** 31),
      -(2 ** 31) - 1,
      2 ** 52,
      2 ** 52 + 1,
      -(2 ** 52) - 1,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ];
    for (const i of edges) {
      const value = {
        i,
        d: new Date(Math.max(-8.64e15, Math.min(8.64e15, i))),
        m: i / 100,
        z: i,
        g: BigInt(i) ** 3n,
        n: i / 7,
      };
      assert.deepStrictEqual(roundTrip(N, value), expected(N, value), String(i));
    }
    const special = { i: 0, d: new Date(NaN), m: 0, z: 0, g: -0n, n: -0 };
    assert.deepStrictEqual(roundTrip(N, special), expected(N, special));
    assert.throws(() => toBinary(N, { ...special, m: 1e300 }), { code: 'type', path: 'm' });
    assert.throws(() => toBinary(N, { ...special, z: NaN }), {
      message: 'Field "z" is not of expected type: number(0)',
    });
  });

  test(`Binary (${backend}): wide flags, long enums, collections and tuples`, () => {
    const C = define(
      {
        wide: { flags: Array.from({ length: 70 }, (_, i) => `n${i}`) },
        few: { flags: ['x', 'y'] },
        many: { enum: Array.from({ length: 300 }, (_, i) => `e${i}`) },
        ids: { set: 'integer' },
        seen: { map: { string: 'date' } },
        scores: { map: { number: '?string' } },
        prices: { object: { string: { type: 'number', decimals: 2 } } },
        notes: { object: { string: '?json' } },
        pair: ['number', '?string'],
        maybe: { array: '?integer' },
        'nothing?': 'null',
        'byte?': 'boolean',
        bytes: 'bytes',
      },
      options,
    );
    const value = {
      wide: { n0: true, n30: true, n31: true, n61: true, n62: true, n69: true },
      few: { y: true },
      many: 'e299',
      ids: new Set([3, 1, 2]),
      seen: new Map([
        ['a', new Date(1)],
        ['b', new Date(2)],
      ]),
      scores: new Map([
        [1.5, 'x'],
        [2, null],
      ]),
      prices: { x: 1.25, y: 0, __proto__: 3 },
      notes: { a: { any: [1] }, b: null },
      pair: [1.5],
      maybe: [1, null, 3],
      nothing: null,
      byte: false,
      bytes: new Uint8Array([0, 255, 7]),
    };
    assert.deepStrictEqual(roundTrip(C, value), expected(C, value));
    const empty = {
      wide: {},
      few: {},
      many: 'e0',
      ids: new Set(),
      seen: new Map(),
      scores: new Map(),
      prices: {},
      notes: {},
      pair: [0, 'two'],
      maybe: [],
      bytes: new Uint8Array(0),
    };
    assert.deepStrictEqual(roundTrip(C, empty), expected(C, empty));
    // A Set given as an array, as the text wire takes it.
    assert.deepStrictEqual(
      roundTrip(C, { ...empty, ids: [2, 1] }),
      expected(C, { ...empty, ids: [2, 1] }),
    );
  });

  test(`Binary (${backend}): roots of every kind`, () => {
    const cases = [
      ['string', 'Alex'],
      ['?string', null],
      ['?string', 'x'],
      ['number', 1.5],
      [{ array: '?json' }, [{ a: 1 }, null]],
      [['number', '?string'], [1]],
      [{ set: 'string' }, new Set(['a'])],
      [{ map: { string: 'number' } }, new Map([['a', 1]])],
      [{ object: { string: 'boolean' } }, { a: true }],
      [
        {
          union: [
            { Struct: {}, type: { enum: ['a'] }, x: 'number' },
            { Struct: {}, type: { enum: ['b'] }, y: 'string', on: 'boolean' },
          ],
          discriminator: 'type',
        },
        { type: 'b', y: 'why', on: true },
      ],
    ];
    for (const [definition, value] of cases) {
      const schema = define(definition, options);
      assert.deepStrictEqual(roundTrip(schema, value), expected(schema, value), schema.toString());
    }
    const required = define('string', options);
    // A null root scalar travels as its presence byte, as the text wire writes null for it,
    // and is refused on decode where it is required.
    assert.deepStrictEqual(toBinary(required, null), Uint8Array.of(0));
    assert.throws(() => fromBinary(required, Uint8Array.of(0)), { code: 'required', path: '' });
    assert.throws(() => fromBinary(required, Uint8Array.of(2)), { code: 'structure', path: '' });
    assert.strictEqual(fromBinary(define('?string', options), Uint8Array.of(0)), null);
  });

  test(`Binary (${backend}): references, recursion, aliases, embedded schemas and the list`, () => {
    const { User, Alias } = model(
      {
        Address: { Struct: {}, city: 'string' },
        User: { Struct: {}, home: 'Address', work: '?Address' },
        Alias: 'User',
      },
      options,
    );
    const value = { home: { city: 'Kyiv' } };
    assert.deepStrictEqual(roundTrip(User, value), expected(User, value));
    assert.deepStrictEqual(roundTrip(Alias, value), expected(Alias, value));
    assert.deepStrictEqual(toBinary(Alias, value), toBinary(User, value));
    assert.throws(() => toBinary(User, { home: 1 }), {
      code: 'object',
      path: 'home',
      schema: 'User',
    });
    assert.throws(() => fromBinary(Alias, Uint8Array.of(1, 1, 128)), {
      code: 'structure',
      path: 'home.city',
      schema: 'Alias',
    });
    const Node = named('Node', { value: 'number', kids: { array: 'Node' } }, options);
    const tree = {
      value: 1,
      kids: [
        { value: 2, kids: [] },
        { value: 3, kids: [{ value: 4, kids: [] }] },
      ],
    };
    assert.deepStrictEqual(roundTrip(Node, tree), expected(Node, tree));
    assert.throws(() => toBinary(Node, { value: 1, kids: [{ value: 2, kids: [null] }] }), {
      code: 'type',
      path: 'kids[0].kids[0]',
    });
    // A schema without numbers reaches one that reads them.
    const { Outer } = model(
      { Inner: { Struct: {}, x: 'number' }, Outer: { Struct: {}, inner: 'Inner', tag: 'string' } },
      options,
    );
    const outer = { inner: { x: 1.5 }, tag: 't' };
    assert.deepStrictEqual(roundTrip(Outer, outer), expected(Outer, outer));
    const embedded = define({ id: 'number', home: Address }, options);
    const home = { id: 1, home: { city: 'Lviv' } };
    assert.deepStrictEqual(roundTrip(embedded, home), expected(embedded, home));
    const users = [{ home: { city: 'A' } }, { home: { city: 'B' }, work: { city: 'C' } }];
    assert.deepStrictEqual(roundTrip(User.list, users), expected(User.list, users));
    assert.throws(() => fromBinary(User.list, toBinary(User.list, users).subarray(0, 4)), {
      code: 'structure',
      path: '[0].home.city',
    });
  });

  test(`Binary (${backend}): encode checks the shapes the wire is built from`, () => {
    const S = define(
      {
        id: 'integer',
        address: { city: 'string', zip: '?string' },
        tags: { array: 'string' },
        orders: { array: { sku: 'string', qty: 'number' } },
        ids: { set: 'integer' },
        seen: { map: { string: 'date' } },
        prices: { object: { string: 'number' } },
        pair: ['number', 'string'],
        packet: {
          union: [
            { Struct: {}, type: { enum: ['call'] }, id: 'string' },
            { Struct: {}, type: { enum: ['event'] }, name: 'string' },
          ],
          discriminator: 'type',
        },
      },
      options,
    );
    const ok = {
      id: 1,
      address: { city: 'K' },
      tags: [],
      orders: [],
      ids: new Set(),
      seen: new Map(),
      prices: {},
      pair: [1, 'a'],
      packet: { type: 'call', id: '7' },
    };
    assert.deepStrictEqual(roundTrip(S, ok), expected(S, ok));
    const cases = [
      [null, 'required', ''],
      [[], 'object', ''],
      [{ ...ok, address: [] }, 'object', 'address'],
      [{ ...ok, tags: 'x' }, 'array', 'tags'],
      [{ ...ok, tags: ['a', null] }, 'type', 'tags[1]'],
      [{ ...ok, orders: [null] }, 'type', 'orders[0]'],
      [{ ...ok, orders: [{ sku: 'a', qty: 1 }, 5] }, 'object', 'orders[1]'],
      [{ ...ok, ids: 5 }, 'set', 'ids'],
      [{ ...ok, seen: {} }, 'map', 'seen'],
      [{ ...ok, seen: new Map([['a', null]]) }, 'type', 'seen[0]'],
      [{ ...ok, prices: [] }, 'object', 'prices'],
      [{ ...ok, prices: { a: 1, 'b c': null } }, 'type', 'prices["b c"]'],
      [{ ...ok, pair: {} }, 'array', 'pair'],
      [{ ...ok, packet: 1 }, 'object', 'packet'],
      [{ ...ok, packet: { type: 'nope' } }, 'union', 'packet.type'],
    ];
    for (const [value, code, path] of cases) {
      assert.throws(
        () => toBinary(S, value),
        (error) => error instanceof EncodeError && error.code === code && error.path === path,
        `${code} at ${JSON.stringify(path)}`,
      );
    }
    // A trusted value of the wrong type is written as it is, as on the text wire.
    assert.doesNotThrow(() => toBinary(S, { ...ok, id: 'x' }));
    // A string slot holds a string and a bytes slot a Uint8Array: the binary wire has no form
    // for anything else, where the text wire carries it as it is.
    const T = define(
      { s: 'string', y: 'bytes', m: { map: { string: 'number' } }, j: 'json', g: 'bigint' },
      options,
    );
    const fine = { s: 'x', y: new Uint8Array(1), m: new Map([['k', 1]]), j: null, g: 1n };
    assert.deepStrictEqual(roundTrip(T, fine), expected(T, fine));
    assert.throws(() => toBinary(T, { ...fine, s: 1 }), { code: 'type', path: 's' });
    assert.throws(() => toBinary(T, { ...fine, s: {} }), {
      message: 'Field "s" is not of expected type: string',
    });
    assert.throws(() => toBinary(T, { ...fine, y: 'AQ==' }), { code: 'type', path: 'y' });
    assert.throws(() => toBinary(T, { ...fine, m: new Map([[1, 1]]) }), {
      code: 'type',
      path: 'm[0]',
    });
    // What JSON has no text for travels as null, as on the text wire; a bigint slot takes a
    // trusted value's text.
    const loose = { ...fine, j: () => 1, g: 7 };
    assert.deepStrictEqual(roundTrip(T, loose), { ...expected(T, { ...fine, g: 7 }), j: null });
  });

  test(`Binary (${backend}): decode checks the wire, with paths and the schema's name`, () => {
    const S = named(
      'Thing',
      {
        id: 'integer',
        role: { enum: ['a', 'b'] },
        on: 'boolean',
        at: 'date',
        big: 'bigint',
        address: { city: 'string' },
        tags: { array: 'string' },
        seen: { map: { string: '?date' } },
        notes: { object: { string: 'string' } },
        maybe: { array: '?integer' },
        'last?': 'number',
      },
      options,
    );
    const value = {
      id: 1,
      role: 'b',
      on: true,
      at: new Date(5),
      big: 12n,
      address: { city: 'K' },
      tags: ['a'],
      seen: new Map([['k', null]]),
      notes: { n: 'v' },
      maybe: [null, 2],
      last: 1.5,
    };
    const bytes = toBinary(S, value);
    assert.deepStrictEqual(normalize(fromBinary(S, bytes)), expected(S, value));
    const edit = (fn) => {
      const copy = Uint8Array.from(bytes);
      fn(copy);
      return copy;
    };
    const header = bytes[0];
    // Positions: header 2 bytes, id, role, (on in the header), at, big (length + digits).
    const roleAt = 3;
    const check = (message, code, path) => {
      assert.throws(
        () => fromBinary(S, message),
        (error) =>
          error instanceof DecodeError &&
          error.code === code &&
          error.path === path &&
          error.schema === 'Thing',
        `${code} at ${JSON.stringify(path)}`,
      );
    };
    check(new Uint8Array(0), 'structure', '');
    check(bytes.subarray(0, 1), 'structure', '');
    check(bytes.subarray(0, bytes.length - 1), 'structure', 'last');
    check(
      edit((c) => (c[roleAt] = 2)),
      'enum',
      'role',
    );
    check(
      edit((c) => (c[0] = header & ~1)),
      'required',
      'id',
    );
    check(
      edit((c) => (c[1] = 0)),
      'required',
      'notes',
    );
    assert.throws(() => fromBinary(S, 'text'), { code: 'structure', path: '', schema: 'Thing' });
    assert.throws(() => fromBinary(S, [1]), { message: 'Value is not a Uint8Array' });
    // A message from another realm is still bytes.
    const foreign = vm.runInNewContext('new Uint8Array(bytes)', { bytes: Array.from(bytes) });
    assert.deepStrictEqual(normalize(fromBinary(S, foreign)), expected(S, value));
    assert.deepStrictEqual(normalize(fromBinary(S, Buffer.from(bytes))), expected(S, value));
    // Every truncation of a message of every kind is refused.
    for (let cut = 0; cut < bytes.length; cut++) {
      assert.throws(() => fromBinary(S, bytes.subarray(0, cut)), DecodeError, `cut ${cut}`);
    }
  });

  test(`Binary (${backend}): a corrupted boolean, date, bigint, presence byte or tag`, () => {
    const B = define({ b: { array: 'boolean' } }, options);
    assert.throws(() => fromBinary(B, Uint8Array.of(1, 1, 2)), { code: 'type', path: 'b[0]' });
    const D = define({ d: { array: 'date' } }, options);
    const far = toBinary(D, { d: [new Date(8.64e15)] });
    assert.deepStrictEqual(normalize(fromBinary(D, far)), expected(D, { d: [new Date(8.64e15)] }));
    const kernelOf = kernel(RUNTIME.node);
    const w = new kernelOf.Writer();
    w.u8(1);
    w.u8(1);
    w.svar(8.64e15 + 1);
    assert.throws(() => fromBinary(D, w.finish()), { code: 'type', path: 'd[0]' });
    const G = define({ g: { array: 'bigint' } }, options);
    w.reset();
    w.u8(1);
    w.u8(1);
    w.string('12x');
    assert.throws(() => fromBinary(G, w.finish()), { code: 'type', path: 'g[0]' });
    const M = define({ m: { map: { string: '?number' } } }, options);
    w.reset();
    w.u8(1);
    w.u8(1);
    w.string('k');
    w.u8(2);
    assert.throws(() => fromBinary(M, w.finish()), { code: 'structure', path: 'm[0]' });
    const U = define(
      {
        union: [
          { Struct: {}, type: { enum: ['a'] }, x: 'number' },
          { Struct: {}, type: { enum: ['b'] }, y: 'string' },
        ],
        discriminator: 'type',
      },
      options,
    );
    const Loose = define(U.source, { ...options, validate: false });
    for (const schema of [U, Loose]) {
      assert.throws(() => fromBinary(schema, Uint8Array.of(7)), { code: 'union', path: 'type' });
    }
    const T = define({ t: ['number', '?string'] }, options);
    assert.throws(() => fromBinary(T, Uint8Array.of(1)), { code: 'structure', path: 't' });
    assert.throws(() => fromBinary(T, Uint8Array.of(1, 2)), { code: 'required', path: 't[0]' });
    // A list of required items cannot be longer than the bytes left.
    const L = define({ l: { array: 'integer' } }, options);
    assert.throws(() => fromBinary(L, Uint8Array.of(1, 200)), { code: 'structure', path: 'l' });
    // An enum past 256 values takes a varint.
    const E = define({ e: { enum: Array.from({ length: 300 }, (_, i) => `e${i}`) } }, options);
    assert.throws(() => fromBinary(E, Uint8Array.of(1, 0xff)), { code: 'structure', path: 'e' });
    assert.throws(() => fromBinary(E, Uint8Array.of(1, 0xff, 0x7f)), { code: 'enum', path: 'e' });
    // A presence bit set on a null field reads a null.
    const Z = define({ z: 'null', s: 'string' }, options);
    assert.deepStrictEqual(fromBinary(Z, Uint8Array.of(3, 2, 65)), { z: null, s: 'A' });
  });

  test(`Binary (${backend}): a union past 256 tag values, and boolean defaults`, () => {
    const branch = (name, from, count, field) => ({
      Struct: {},
      type: { enum: Array.from({ length: count }, (_, i) => `${name}${from + i}`) },
      ...field,
    });
    const definition = {
      union: [branch('a', 0, 200, { x: 'number' }), branch('b', 200, 100, { y: 'string' })],
      discriminator: 'type',
    };
    for (const validate of [true, false]) {
      const W = define(definition, { ...options, validate });
      for (const value of [
        { type: 'a0', x: 1 },
        { type: 'a199', x: 2 },
        { type: 'b299', y: 'z' },
      ]) {
        assert.deepStrictEqual(roundTrip(W, value), expected(W, value), value.type);
      }
      const tag = toBinary(W, { type: 'b299', y: 'z' }).subarray(0, 2);
      assert.deepStrictEqual(tag, Uint8Array.of(0xab, 0x02));
      assert.throws(() => toBinary(W, { type: 'c' }), { code: 'union', path: 'type' });
      assert.throws(() => fromBinary(W, Uint8Array.of(0xac, 0x02)), {
        code: 'union',
        path: 'type',
      });
      if (validate) {
        assert.throws(() => fromBinary(W, Uint8Array.of(0xab)), {
          code: 'structure',
          path: 'type',
        });
      }
    }
    const D = define(
      {
        on: { type: 'boolean', default: true },
        off: { type: 'boolean', default: false },
        n: 'number',
      },
      options,
    );
    assert.deepStrictEqual(fromBinary(D, toBinary(D, { n: 1 })), { on: true, off: false, n: 1 });
    const set = { on: false, off: true, n: 1 };
    assert.deepStrictEqual(fromBinary(D, toBinary(D, set)), set);
  });

  test(`Binary (${backend}): without validation the wire is trusted`, () => {
    const S = define(
      {
        role: { enum: ['a', 'b'] },
        many: { enum: Array.from({ length: 300 }, (_, i) => `e${i}`) },
        n: 'number',
        s: 'string',
      },
      { ...options, validate: false },
    );
    const value = { role: 'b', many: 'e299', n: 1.5, s: 'x' };
    assert.deepStrictEqual(roundTrip(S, value), expected(S, value));
    const bytes = toBinary(S, value);
    bytes[1] = 9;
    assert.strictEqual(fromBinary(S, bytes).role, undefined);
    const Wide = define(
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, '?string'])),
      { ...options, validate: false, sparse: true },
    );
    assert.deepStrictEqual(
      roundTrip(Wide, { f0: 'a', f39: 'z' }),
      expected(Wide, { f0: 'a', f39: 'z' }),
    );
  });
}

test('Binary: both backends write the same bytes on random schemas and read what the schema decodes', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, value, random } = generate(seed);
    const schemas = BACKENDS.map(([, options]) => define(definition, options));
    const bytes = schemas.map((schema) => toBinary(schema, value));
    assert.deepStrictEqual(bytes[1], bytes[0], `seed ${seed}`);
    const want = expected(schemas[0], value);
    // Without validation the same bytes read the same.
    for (const [, options] of BACKENDS) {
      const loose = define(definition, { ...options, validate: false });
      assert.deepStrictEqual(toBinary(loose, value), bytes[0], `seed ${seed}`);
      assert.deepStrictEqual(normalize(fromBinary(loose, bytes[0])), want, `seed ${seed}`);
    }
    for (const schema of schemas) {
      assert.deepStrictEqual(normalize(fromBinary(schema, bytes[0])), want, `seed ${seed}`);
      for (let cut = 0; cut < bytes[0].length; cut++) {
        assert.throws(
          () => fromBinary(schema, bytes[0].subarray(0, cut)),
          DecodeError,
          `seed ${seed}, truncated at ${cut} of ${bytes[0].length}`,
        );
      }
    }
    for (let i = 0; i < 6; i++) {
      const bad = corrupt(value, random);
      const outcomes = schemas.map((schema) => outcome(() => toBinary(schema, bad)));
      assert.deepStrictEqual(outcomes[1], outcomes[0], `seed ${seed}, corrupted value ${i}`);
    }
    for (let i = 0; i < 12; i++) {
      const bad = corruptBytes(bytes[0], random);
      const outcomes = schemas.map((schema) => outcome(() => fromBinary(schema, bad)));
      assert.deepStrictEqual(outcomes[1], outcomes[0], `seed ${seed}, corrupted bytes ${i}`);
    }
  }
});

test('Binary: what the text wire shapes with its own options has no binary form', () => {
  const cases = [
    [{ tags: { array: 'string' } }, { intern: ['tags[]'] }, 'an interned string', 'tags[]'],
    [{ ids: { array: 'integer' } }, { delta: ['ids'] }, 'a list of differences', 'ids'],
    [
      { items: { array: { a: 'number' } } },
      { layout: { items: 'columns' } },
      'the columns layout',
      'items',
    ],
    [{ array: { a: 'number' } }, { layout: 'flat' }, 'the flat layout', ''],
    [{ pair: ['number', 'string'] }, { intern: ['pair[1]'] }, 'an interned string', 'pair[1]'],
    [
      { scores: { object: { string: 'string' } } },
      { intern: ['scores{}'] },
      'an interned string',
      'scores{}',
    ],
    [
      { seen: { map: { string: 'string' } } },
      { intern: ['seen{}'] },
      'an interned string',
      'seen{}',
    ],
    [
      {
        union: [
          { Struct: {}, type: { enum: ['a'] }, name: 'string' },
          { Struct: {}, type: { enum: ['b'] }, y: 'string' },
        ],
        discriminator: 'type',
      },
      { intern: ['[0].name'] },
      'an interned string',
      '[0].name',
    ],
    [
      { 'a.b': { array: { array: 'string' } } },
      { intern: ['["a.b"][][]'] },
      'an interned string',
      '["a.b"][][]',
    ],
    [
      { outer: { 'a.b': 'string', c: 'string' } },
      { intern: ['outer["a.b"]'] },
      'an interned string',
      'outer["a.b"]',
    ],
  ];
  for (const [definition, options, what, path] of cases) {
    const schema = named('S', definition, options);
    assert.throws(
      () => toBinary(schema, {}),
      (error) =>
        error instanceof SchemaDefinitionError &&
        error.code === 'ERR_NO_BINARY_FORM' &&
        error.schema === 'S' &&
        error.field === path &&
        error.message ===
          `The binary wire has no form for ${what}${path === '' ? '' : ` at "${path}"`}`,
      `${what} at ${JSON.stringify(path)}`,
    );
    assert.throws(() => fromBinary(schema, new Uint8Array(1)), { code: 'ERR_NO_BINARY_FORM' });
  }
  const writer = define({ id: 'number' });
  const reader = define({ id: 'number', name: '?string' });
  assert.throws(() => toBinary(resolve(writer, reader), { id: 1 }), {
    code: 'ERR_NO_BINARY_FORM',
    message: 'The binary wire has no form for a resolved schema',
  });
  assert.throws(() => toBinary({}, 1), { code: 'ERR_SCHEMA_EXPECTED' });
  assert.throws(() => fromBinary(null, new Uint8Array(1)), { code: 'ERR_SCHEMA_EXPECTED' });
});

test('Binary: register installs toBinary and fromBinary as non-enumerable methods, once', () => {
  const User = define({ id: 'number', name: '?string' });
  assert.strictEqual(User.toBinary, undefined);
  register();
  register();
  assert.deepStrictEqual(Object.keys(User), [
    'name',
    'snapshot',
    'source',
    'keys',
    'backend',
    'layout',
  ]);
  assert.ok(!Object.keys(Schema.prototype).includes('toBinary'));
  const bytes = User.toBinary({ id: 1 });
  assert.deepStrictEqual(User.fromBinary(bytes), { id: 1, name: null });
  assert.deepStrictEqual(User.list.fromBinary(User.list.toBinary([{ id: 2 }])), [
    { id: 2, name: null },
  ]);
});

test('Binary: generated code falls back to closures where the runtime refuses it, unless asked for', () => {
  const { compile } = codegen;
  codegen.compile = () => {
    throw new EvalError('blocked');
  };
  try {
    const auto = define({ id: 'number' });
    assert.strictEqual(auto.backend, 'codegen');
    assert.deepStrictEqual(fromBinary(auto, toBinary(auto, { id: 1 })), { id: 1 });
    const forced = define({ id: 'number' }, { codegen: true });
    assert.throws(() => toBinary(forced, { id: 1 }), EvalError);
  } finally {
    codegen.compile = compile;
  }
});

test('Binary: a call made while the schema is encoding takes a writer and a reader of its own', () => {
  const S = define({ j: 'json', n: 'number' });
  const other = { j: 'other', n: 2 };
  const expectedOther = toBinary(S, other);
  let inner;
  const value = {
    j: {
      toJSON() {
        inner = [toBinary(S, other), fromBinary(S, expectedOther)];
        return 'outer';
      },
    },
    n: 1,
  };
  const bytes = toBinary(S, value);
  assert.deepStrictEqual(fromBinary(S, bytes), { j: 'outer', n: 1 });
  assert.deepStrictEqual(inner[0], expectedOther);
  assert.deepStrictEqual(inner[1], other);
});

// The writer and reader of each runtime twin write the same bytes and read
// the same strings; the growth of the buffer and the varint edges are theirs
// to get right.
for (const platform of ['node', 'browser']) {
  test(`Binary: the wire kernel over the ${platform} runtime`, () => {
    const { Writer, Reader } = kernel(RUNTIME[platform]);
    const reference = kernel(RUNTIME.node);
    const lone = String.fromCharCode(0xd800);
    const strings = [
      '',
      'abc',
      'x'.repeat(21),
      'x'.repeat(22),
      'ы'.repeat(21),
      '€'.repeat(21),
      '😀'.repeat(5),
      `${lone}a`,
      `${'ы'.repeat(10)}${lone}`,
      `${'x'.repeat(40)}${lone}`,
      'Шановні студенти!'.repeat(50),
      'a'.repeat(3000),
    ];
    const w = new Writer();
    const expectedWriter = new reference.Writer();
    for (const s of strings) {
      w.string(s);
      expectedWriter.string(s);
    }
    const integers = [
      0,
      1,
      -1,
      63,
      64,
      -64,
      -65,
      2 ** 31,
      -(2 ** 31) - 1,
      2 ** 53 - 1,
      -(2 ** 53) + 1,
    ];
    for (const n of integers) {
      w.svar(n);
      w.uvar(Math.abs(n));
    }
    w.words(5, 3);
    w.words([1, 2], 3);
    w.raw(Uint8Array.from({ length: 300 }, (_, i) => i % 256));
    w.f64(Math.PI);
    const start = w.bitmap(10);
    w.mark(start, 9);
    const bytes = w.finish();
    assert.deepStrictEqual(bytes.subarray(0, expectedWriter.pos), expectedWriter.finish());
    const r = new Reader().reset(bytes, true);
    for (const s of strings) assert.strictEqual(r.string(), s, JSON.stringify(s).slice(0, 30));
    for (const n of integers) {
      assert.strictEqual(r.svar(), n);
      assert.strictEqual(r.uvar(), Math.abs(n));
    }
    assert.deepStrictEqual(r.words(3), [5, 0, 0]);
    assert.deepStrictEqual(r.words(3), [1, 2, 0]);
    assert.deepStrictEqual(
      r.raw(),
      Uint8Array.from({ length: 300 }, (_, i) => i % 256),
    );
    assert.strictEqual(r.f64(), Math.PI);
    assert.strictEqual(r.pos + 2, r.end);
    assert.strictEqual(r.u8(), 0);
    assert.strictEqual(r.u8(), 2);
    // A string or a byte array whose length runs past the message reads as undefined.
    assert.strictEqual(new Reader().reset(Uint8Array.of(8, 65), false).string(), undefined);
    assert.strictEqual(
      new Reader().reset(Uint8Array.of(0x80, 0x01, 65), false).string(),
      undefined,
    );
    assert.strictEqual(new Reader().reset(Uint8Array.of(5, 65), false).raw(), undefined);
    assert.strictEqual(new Reader().reset(new Uint8Array(0), false).string(), undefined);
    // A read-only varint past the end runs past it, which a backend checks.
    const past = new Reader().reset(Uint8Array.of(0x80), false);
    past.uvar();
    assert.ok(past.pos > past.end);
  });
}
