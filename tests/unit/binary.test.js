const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { Schema, DecodeError, EncodeError, SchemaDefinitionError } = require('../../index.js');
const { toBinary, fromBinary, register } = require('../../binary.js');
const { resolve } = require('../../resolve.js');
const codegen = require('../../src/codegen.js');
const closuresBackend = require('../../src/binary/closures.js');
const { kernel } = require('../../src/binary/wire.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { VECTORS, Address } = require('../support/vectors.js');
const { CASES } = require('../support/binary-cases.js');
const GOLDEN = require('../fixtures/golden-binary.json');
const { generate } = require('../support/generate.js');
const { mutate } = require('../support/mutate.js');
const { define, named, model } = require('../support/schema.js');

const RUNTIME = {
  node: require('../../src/runtime/node.js'),
  browser: require('../../src/runtime/browser.js'),
};

const SEEDS = 120;

const BINARY = Symbol.for('alexify.protoarray.binary');

// The outcome of a call that may fail, without its value: what two codecs
// must agree on where they succeed on different wires.
const failure = (fn) => {
  const out = outcome(fn);
  return out.value === undefined ? out : 'ok';
};

const offsetOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return [error.code, error.offset];
  }
  return null;
};

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
      // The bytes are a contract, held to the fixture: a change is a new major version.
      assert.strictEqual(
        Buffer.from(bytes).toString('base64'),
        GOLDEN.vectors[vector.name],
        vector.name,
      );
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
    // A trusted value of the wrong type is written as it is where the wire has a form for
    // it (a NaN for a number), as on the text wire; an integer slot holds a safe integer, since
    // an infinity would never end a varint and a fraction would read back as another number.
    assert.doesNotThrow(() => toBinary(S, { ...ok, pair: ['x', 'a'] }));
    for (const bad of ['x', Infinity, -Infinity, NaN, 2 ** 70, 1.5, -(2 ** 53)]) {
      assert.throws(() => toBinary(S, { ...ok, id: bad }), { code: 'type', path: 'id' }, `${bad}`);
      assert.throws(
        () => toBinary(S, { ...ok, ids: new Set([1, bad]) }),
        { code: 'type', path: 'ids[1]' },
        `${bad}`,
      );
    }
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
    // Every truncation of a message of every kind is refused as a structure error, whatever
    // `validate` says: the structure of the wire is checked in every mode.
    const loose = new Schema('Thing', S, { ...options, validate: false });
    for (let cut = 0; cut < bytes.length; cut++) {
      for (const reader of [S, loose]) {
        assert.throws(
          () => fromBinary(reader, bytes.subarray(0, cut)),
          { name: 'DecodeError', code: 'structure' },
          `cut ${cut}, validate ${reader.validate}`,
        );
      }
    }
  });

  // The structure of the wire bounds every read and every count in both modes, so a message
  // of a few bytes cannot allocate past itself, loop for long or throw anything but a
  // DecodeError; a varint of more than eight bytes is refused rather than read as Infinity or
  // NaN, which no comparison would catch.
  test(`Binary (${backend}): the structure of the wire is checked whatever validate says`, () => {
    const LONG = [...new Array(150).fill(0x80), 0x00];
    const INFINITE = [...new Array(150).fill(0x81), 0x01];
    const varint = (n) => {
      const out = [];
      let u = n;
      while (u >= 0x80) {
        out.push((u & 0x7f) | 0x80);
        u = Math.floor(u / 0x80);
      }
      out.push(u);
      return out;
    };
    const kernelOf = kernel(RUNTIME.node);
    for (const validate of [true, false]) {
      const label = `validate ${validate}`;
      const rejects = (schema, bytes, path, code = 'structure') => {
        assert.throws(
          () => fromBinary(schema, Uint8Array.from(bytes)),
          { name: 'DecodeError', code, path },
          `${label}: ${code} at ${JSON.stringify(path)} for ${bytes.slice(0, 8)}`,
        );
      };
      const L = define({ items: { array: 'integer' } }, { ...options, validate });
      const [header] = toBinary(L, { items: [1] });
      const started = performance.now();
      rejects(L, [header, ...varint(2 ** 24)], 'items');
      rejects(L, [header, ...varint(2 ** 40)], 'items');
      rejects(L, [header, ...LONG, 1, 2, 3], 'items');
      rejects(L, [header, ...INFINITE], 'items');
      assert.ok(performance.now() - started < 1000, `${label}: counts are bounded, not read`);
      const N = define({ items: { array: '?integer' } }, { ...options, validate });
      rejects(N, [toBinary(N, { items: [1] })[0], ...varint(2 ** 24)], 'items');
      const T = define(
        { name: 'string', age: 'integer', y: 'bytes', j: 'json', g: 'bigint' },
        { ...options, validate },
      );
      const fine = { name: 'ab', age: 5, y: new Uint8Array(2), j: [1], g: 7n };
      const bytes = toBinary(T, fine);
      assert.deepStrictEqual(normalize(fromBinary(T, bytes)), normalize(fine));
      const [head] = bytes;
      // A length of Infinity or NaN runs the string past the message.
      rejects(T, [head, ...LONG, 0x61, 0x62], 'name');
      rejects(T, [head, ...INFINITE], 'name');
      // An odd length of UTF-16 is no string of the wire.
      rejects(T, [head, (3 << 1) | 1, 0x61, 0x00, 0x62], 'name');
      // A bytes slot whose length runs past the message.
      const w = new kernelOf.Writer();
      w.u8(head);
      w.string('ab');
      w.svar(5);
      w.uvar(2 ** 30);
      rejects(T, Array.from(w.finish()), 'y');
      // The text of a json or a bigint slot must parse, in every mode.
      const broken = (patch) => {
        const v = new kernelOf.Writer();
        v.u8(head);
        v.string('ab');
        v.svar(5);
        v.raw(new Uint8Array(2));
        patch(v);
        return Array.from(v.finish());
      };
      rejects(
        T,
        broken((v) => v.string('{')),
        'j',
        'json',
      );
      rejects(
        T,
        broken((v) => {
          v.string('[1]');
          v.string('1e3');
        }),
        'g',
        'type',
      );
      // The presence byte of a nullable value is 0 or 1.
      const M = define({ m: { map: { string: '?integer' } } }, { ...options, validate });
      const [mhead] = toBinary(M, { m: new Map([['k', 1]]) });
      rejects(M, [mhead, 1, 1 << 1, 0x6b, 2], 'm[0]');
      const D = define({ d: { object: { string: '?integer' } } }, { ...options, validate });
      const [dhead] = toBinary(D, { d: { k: 1 } });
      rejects(D, [dhead, 1, 1 << 1, 0x6b, 5], 'd.k');
      // An integer past the safe range is a value the wire cannot carry: rejects under
      // validation, read as the nearest double without it.
      const I = define({ n: 'integer' }, { ...options, validate });
      const big = new kernelOf.Writer();
      big.u8(toBinary(I, { n: 1 })[0]);
      big.svar(2 ** 54);
      if (validate) rejects(I, Array.from(big.finish()), 'n', 'type');
      else assert.strictEqual(fromBinary(I, big.finish()).n, 2 ** 54, label);
      // A date and a flags mask convert through the type table: a mask with a word past 31
      // bits is rejects under validation and read as the text wire reads it without.
      const F = define({ f: { flags: ['a', 'b'] }, d: 'date' }, { ...options, validate });
      const fw = new kernelOf.Writer();
      fw.u8(toBinary(F, { f: { a: true }, d: new Date(0) })[0]);
      fw.uvar(2 ** 40);
      fw.svar(0);
      if (validate) rejects(F, Array.from(fw.finish()), 'f', 'type');
      else assert.deepStrictEqual(fromBinary(F, fw.finish()).f, F.decode([2 ** 40, 0]).f, label);
      const dw = new kernelOf.Writer();
      dw.u8(toBinary(F, { f: { a: true }, d: new Date(0) })[0]);
      dw.uvar(1);
      dw.svar(8.64e15 + 1);
      if (validate) rejects(F, Array.from(dw.finish()), 'd', 'type');
      else assert.strictEqual(fromBinary(F, dw.finish()).d.getTime(), NaN, label);
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

  // A schema from resolve on the binary wire: the writer's bytes read into the
  // reader's shape as its text twin reads the writer's wire, and the reader's
  // objects written as the writer's wire, which the writer reads as it reads
  // what the text twin writes; the text wire is the oracle of both.
  test(`Binary (${backend}): a resolved schema reads the writer's bytes and writes its wire`, () => {
    const WIDE = Array.from({ length: 70 }, (_, i) => `n${i}`);
    const LONG = Array.from({ length: 300 }, (_, i) => `e${i}`);
    const text = (fn) => {
      const out = outcome(fn);
      return out.value === undefined ? out : { value: JSON.stringify(out.value) };
    };
    const twin = (resolved, writer, value) => {
      const label = `${resolved} ${JSON.stringify(normalize(value))}`;
      const got = text(() => fromBinary(resolved, toBinary(writer, value)));
      assert.deepStrictEqual(
        got,
        text(() => resolved.decode(writer.encode(value))),
        label,
      );
      return got.value === undefined ? undefined : fromBinary(resolved, toBinary(writer, value));
    };
    const back = (resolved, writer, decoded) => {
      assert.deepStrictEqual(
        text(() => fromBinary(writer, toBinary(resolved, decoded))),
        text(() => writer.decode(resolved.encode(decoded))),
        `${resolved} back`,
      );
    };
    for (const validate of [true, false]) {
      const reads = (definition, extra) => define(definition, { ...options, validate, ...extra });
      // Every bridge resolve makes, on the writer's form: an integer as a
      // bigint, an enum by value or as a string, a string as an enum, flags
      // by name, widened numbers; the reader's own fields at their defaults.
      const W1 = define(
        {
          n: 'integer',
          e: { enum: ['a', 'b', 'c'] },
          'f?': { enum: ['a', 'b'] },
          s: { enum: ['x', 'y'] },
          c: 'string',
          'k?': 'string',
          p: { flags: ['p', 'q', 'r'] },
          w: { flags: WIDE },
          big: { enum: LONG },
          d: { type: 'number', decimals: 2 },
          i: 'integer',
          'legacy?': 'string',
          on: 'boolean',
        },
        options,
      );
      const R1 = reads({
        email: { type: 'string', default: '' },
        big: { enum: LONG.slice(1) },
        i: 'number',
        d: 'number',
        w: { flags: [...WIDE.slice(5), 'extra'] },
        p: { flags: ['r', 'p', 'z'] },
        'k?': { enum: ['x'] },
        c: { enum: ['k', 'c'] },
        s: 'string',
        'f?': { enum: ['b'] },
        e: { enum: ['c', 'a'] },
        n: 'bigint',
        on: 'boolean',
      });
      const A1 = resolve(W1, R1);
      assert.strictEqual(A1.backend, backend);
      const v1 = {
        n: -5,
        e: 'a',
        f: 'a',
        s: 'y',
        c: 'k',
        k: 'x',
        p: { q: true, r: true },
        w: { n0: true, n6: true, n69: true },
        big: 'e299',
        d: 1.25,
        i: 3,
        legacy: 'old',
        on: true,
      };
      const d1 = twin(A1, W1, v1);
      assert.deepStrictEqual(Object.keys(d1), R1.keys);
      assert.strictEqual(d1.n, -5n);
      assert.strictEqual(d1.f, null);
      back(A1, W1, d1);
      back(A1, W1, { ...d1, k: 'zz', w: { n5: true, extra: true } });
      // A value the reader's enum lacks: null when optional, an error when
      // required; without validation the writer's value passes through.
      twin(A1, W1, { ...v1, k: 'zz' });
      twin(A1, W1, { ...v1, e: 'b' });
      twin(A1, W1, { ...v1, big: 'e0' });
      twin(A1, W1, { ...v1, c: 'zz' });
      // A value the reader has no use for is read in the writer's form and
      // dropped, a boolean of the header and a referenced record included; a
      // boolean only the writer has is a bit of the header too.
      const W2 = define(
        {
          'a?': { x: 'number' },
          'b?': 'boolean',
          'c?': 'string',
          'd?': 'number',
          'r?': Address,
          'l?': { array: 'integer' },
          'm?': { array: 'integer' },
          'u?': 'boolean',
          t: ['?string', 'number'],
          keep: 'integer',
        },
        options,
      );
      const R2 = reads({
        keep: 'integer',
        t: ['null', 'number'],
        m: { array: 'null' },
        l: 'null',
        r: 'null',
        d: 'null',
        c: 'null',
        b: 'null',
        a: 'null',
      });
      const A2 = resolve(W2, R2);
      const v2 = {
        a: { x: 1.5 },
        b: true,
        c: 'c',
        d: 2.5,
        r: { city: 'K' },
        l: [1, 2],
        m: [3],
        u: false,
        t: ['s', 3],
        keep: 1,
      };
      const d2 = twin(A2, W2, v2);
      assert.deepStrictEqual(d2, {
        keep: 1,
        t: [null, 3],
        m: [null],
        l: null,
        r: null,
        d: null,
        c: null,
        b: null,
        a: null,
      });
      back(A2, W2, { ...d2, m: [] });
      // A value in a slot the reader drops travels as nothing, as null does.
      back(A2, W2, { ...d2, m: [], t: ['gone', 3] });
      twin(A2, W2, { t: [null, 3], keep: 2 });
      // A null item of a list the writer requires has no form.
      assert.throws(() => toBinary(A2, d2), { code: 'type', path: 'm[0]' });
      // Collections of another optionality: the wire has the writer's, a null
      // where the reader requires a value is rejects as on the text wire.
      const W3 = define(
        {
          a: { array: '?integer' },
          m: { map: { string: '?string' } },
          o: { object: { string: '?number' } },
          s: { set: 'integer' },
          b: { array: 'integer' },
          q: { set: '?string' },
        },
        options,
      );
      const R3 = reads({
        a: { array: 'integer' },
        m: { map: { string: 'string' } },
        o: { object: { string: 'number' } },
        s: { array: 'integer' },
        b: { array: '?integer' },
        q: { array: '?string' },
      });
      const A3 = resolve(W3, R3);
      const v3 = {
        a: [1, 2],
        m: new Map([['k', 'v']]),
        o: { k: 1 },
        s: new Set([1]),
        b: [1],
        q: new Set(['x', null]),
      };
      const d3 = twin(A3, W3, v3);
      assert.deepStrictEqual(normalize(d3), normalize({ ...v3, s: [1], q: ['x', null] }));
      back(A3, W3, d3);
      twin(A3, W3, { ...v3, a: [1, null] });
      twin(A3, W3, { ...v3, m: new Map([['k', null]]) });
      twin(A3, W3, { ...v3, o: { k: null } });
      assert.throws(() => toBinary(A3, { ...d3, b: [1, null] }), { code: 'type', path: 'b[1]' });
      // A tuple: the writer's trailing elements the reader lacks are read and
      // dropped, the reader's the writer lacks follow at their defaults.
      const W4 = define({ t: ['number', 'string', '?boolean', 'string'] }, options);
      const R4 = reads({ t: ['number', '?string'] });
      const R5 = reads({ t: ['number', 'string', '?boolean', 'string', '?integer', '?string'] });
      for (const t of [
        [1, 's', true, 'z'],
        [1, 's', null, 'z'],
      ]) {
        const d4 = twin(resolve(W4, R4), W4, { t });
        assert.deepStrictEqual(d4, { t: [1, 's'] });
        back(resolve(W4, R4), W4, d4);
        const d5 = twin(resolve(W4, R5), W4, { t });
        assert.deepStrictEqual(d5, { t: [...t, null, null] });
        back(resolve(W4, R5), W4, d5);
      }
      // A union: branches pair up by value, in the reader's shape; a value
      // the reader dropped, or a writer branch it has no values of, is an
      // error either way.
      const branch = (fields) => ({ Struct: {}, ...fields });
      const W6 = define(
        {
          union: [
            branch({ k: { enum: ['d'] }, w: 'string' }),
            branch({ k: { enum: ['a', 'b'] }, x: 'number' }),
            branch({ k: { enum: ['c'] }, y: 'string', on: 'boolean' }),
          ],
          discriminator: 'k',
        },
        options,
      );
      const R6 = reads({
        union: [
          branch({ on: 'boolean', 'z?': 'string', y: 'string', k: { enum: ['c'] } }),
          branch({ x: 'number', k: { enum: ['a'] } }),
        ],
        discriminator: 'k',
      });
      const A6 = resolve(W6, R6);
      const d6 = twin(A6, W6, { k: 'a', x: 1 });
      assert.deepStrictEqual(Object.keys(d6), ['x', 'k']);
      back(A6, W6, d6);
      const d7 = twin(A6, W6, { k: 'c', y: 'y', on: true });
      assert.deepStrictEqual(d7, { on: true, z: null, y: 'y', k: 'c' });
      back(A6, W6, d7);
      twin(A6, W6, { k: 'b', x: 2 });
      twin(A6, W6, { k: 'd', w: 'w' });
      assert.throws(() => toBinary(A6, { k: 'b', x: 2 }), { code: 'union', path: 'k' });
      assert.throws(() => toBinary(A6, { k: 'q' }), { code: 'union', path: 'k' });
      // Root scalars, bridged or dropped.
      const W7 = define('integer', options);
      const A7 = resolve(W7, reads('bigint'));
      assert.strictEqual(twin(A7, W7, 5), 5n);
      back(A7, W7, 5n);
      twin(A7, W7, null);
      const W8 = define('?string', options);
      const A8 = resolve(W8, reads('?null'));
      assert.strictEqual(twin(A8, W8, 'gone'), null);
      back(A8, W8, null);
      // A recursion inside a resolved plan calls the codec compiled for it,
      // once however many places reach it; the list of the records too.
      const entities = (key) => ({
        Outer: { Struct: {}, a: 'A', b: 'A' },
        A: { Struct: {}, [key]: 'string', next: '?A', 'n?': 'number' },
      });
      const W9 = model(entities('v'), options).Outer;
      const R9 = model(entities('w'), { ...options, validate }).Outer;
      const A9 = resolve(W9, R9, { aliases: { 'a.w': 'v' } });
      const tree = { a: { v: 'x', next: { v: 'y', n: 1.5 } }, b: { v: 'z' } };
      const d9 = twin(A9, W9, tree);
      assert.deepStrictEqual(d9, {
        a: { w: 'x', next: { w: 'y', next: null, n: 1.5 }, n: null },
        b: { w: 'z', next: null, n: null },
      });
      back(A9, W9, d9);
      assert.deepStrictEqual(toBinary(A9, d9), toBinary(W9, tree));
      twin(A9.list, W9.list, [tree, tree]);
      if (!validate) continue;
      assert.throws(() => fromBinary(A9, toBinary(W9, tree).subarray(0, 3)), {
        code: 'structure',
        path: 'a.w',
        schema: 'Outer',
      });
    }
  });
}

test('Binary: both backends write the same bytes on random schemas and read what the schema decodes', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, value, random } = generate(seed);
    const schemas = BACKENDS.map(([, options]) => define(definition, options));
    const bytes = schemas.map((schema) => toBinary(schema, value));
    assert.deepStrictEqual(bytes[1], bytes[0], `seed ${seed}`);
    const want = expected(schemas[0], value);
    // Without validation the same bytes read the same, a truncated message is still rejects
    // and corrupted bytes give a value or a DecodeError, the same on both backends.
    const loosened = BACKENDS.map(([, options]) =>
      define(definition, { ...options, validate: false }),
    );
    for (const loose of loosened) {
      assert.deepStrictEqual(toBinary(loose, value), bytes[0], `seed ${seed}`);
      assert.deepStrictEqual(normalize(fromBinary(loose, bytes[0])), want, `seed ${seed}`);
      for (let cut = 0; cut < bytes[0].length; cut++) {
        assert.throws(
          () => fromBinary(loose, bytes[0].subarray(0, cut)),
          { name: 'DecodeError', code: 'structure' },
          `seed ${seed}, truncated at ${cut} without validation`,
        );
      }
    }
    for (let i = 0; i < 12; i++) {
      const bad = corruptBytes(bytes[0], random);
      const outcomes = loosened.map((schema) => outcome(() => fromBinary(schema, bad)));
      assert.deepStrictEqual(outcomes[1], outcomes[0], `seed ${seed}, loose corrupted bytes ${i}`);
      assert.ok(
        outcomes[0].value !== undefined || outcomes[0].name === 'DecodeError',
        `seed ${seed}, loose corrupted bytes ${i}: ${outcomes[0].message}`,
      );
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

// The random schemas against a mutated reader (renamed through aliases,
// dropped, shuffled, extended), as parity.test.js checks the text wire: both
// backends read the writer's bytes into what the text twin decodes, in the
// same key order, write the same bytes for the reader's objects, which the
// writer reads as it reads the text twin's wire, and agree on corrupted
// values and bytes.
test('Binary: both backends agree on resolved schemas, with the text wire as the oracle', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { definition, value, random } = generate(seed);
    const { reader, aliases } = mutate(definition, random);
    for (const validate of [true, false]) {
      const label = `seed ${seed} validate ${validate}`;
      const sides = BACKENDS.map(([, options]) => {
        const writer = define(definition, options);
        const read = define(reader, { ...options, validate });
        return { writer, resolved: resolve(writer, read, { aliases }) };
      });
      const [A, B] = sides.map((side) => side.resolved);
      const W = sides[0].writer;
      const bytes = toBinary(W, value);
      const decoded = fromBinary(A, bytes);
      const twin = JSON.stringify(normalize(A.decode(W.encode(value))));
      assert.strictEqual(JSON.stringify(normalize(decoded)), twin, label);
      assert.strictEqual(JSON.stringify(normalize(fromBinary(B, bytes))), twin, label);
      assert.deepStrictEqual(Object.keys(decoded), A.keys, label);
      const back = toBinary(A, decoded);
      assert.deepStrictEqual(toBinary(B, decoded), back, label);
      assert.deepStrictEqual(
        outcome(() => fromBinary(W, back)),
        outcome(() => W.decode(A.encode(decoded))),
        label,
      );
      for (let i = 0; i < 4; i++) {
        const bad = corrupt(decoded, random);
        assert.deepStrictEqual(
          outcome(() => toBinary(B, bad)),
          outcome(() => toBinary(A, bad)),
          `${label}, corrupted value ${i}`,
        );
      }
      // Only a validated schema bounds what corrupted bytes make it read.
      if (!validate) continue;
      for (let cut = 0; cut < bytes.length; cut++) {
        assert.throws(() => fromBinary(A, bytes.subarray(0, cut)), DecodeError, `${label} ${cut}`);
      }
      for (let i = 0; i < 8; i++) {
        const bad = corruptBytes(bytes, random);
        assert.deepStrictEqual(
          outcome(() => fromBinary(B, bad)),
          outcome(() => fromBinary(A, bad)),
          `${label}, corrupted bytes ${i}`,
        );
      }
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
  // A resolved schema reads the writer's wire: what that has no form for is
  // rejects too, a value the reader drops and a collection in a layout of its
  // own included.
  const Old = named('Old', { s: 'string', items: { array: { a: 'number' } } }, { intern: ['s'] });
  const New = define({ s: 'null', items: { array: { a: 'number' } } });
  assert.throws(() => toBinary(resolve(Old, New), {}), {
    code: 'ERR_NO_BINARY_FORM',
    message: 'The binary wire has no form for an interned string at "s"',
  });
  const Laid = define({ items: { array: { a: 'number' } } }, { layout: { items: 'columns' } });
  assert.throws(() => toBinary(resolve(Laid, New), {}), {
    message: 'The binary wire has no form for the columns layout at "items"',
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
    // The error that made generated code fall back is kept on the entry.
    assert.ok(auto[BINARY].fallback instanceof EvalError);
    const forced = define({ id: 'number' }, { codegen: true });
    assert.throws(() => toBinary(forced, { id: 1 }), EvalError);
    // A schema left without a codec keeps the error, and throws it again rather
    // than calling a codec it does not have.
    const first = outcome(() => toBinary(forced, { id: 1 }));
    assert.strictEqual(first.name, 'EvalError');
    assert.strictEqual(forced[BINARY].error, forced[BINARY].error);
    assert.throws(() => fromBinary(forced, Uint8Array.of(1)), EvalError);
    const { build } = closuresBackend;
    closuresBackend.build = () => {
      throw new Error('boom');
    };
    let broken;
    try {
      broken = define({ id: 'number' });
      assert.throws(() => toBinary(broken, { id: 1 }), { message: 'boom' });
    } finally {
      closuresBackend.build = build;
    }
    assert.throws(() => toBinary(broken, { id: 1 }), { message: 'boom' });
    assert.strictEqual(broken[BINARY].write, null);
    // The codecs of a resolved plan's inner recursions fall back with it.
    const entities = (key) => ({
      Outer: { Struct: {}, a: 'A' },
      A: { Struct: {}, [key]: 'string', next: '?A' },
    });
    const W = model(entities('v')).Outer;
    const resolved = resolve(W, model(entities('w')).Outer, { aliases: { 'a.w': 'v' } });
    assert.strictEqual(resolved.backend, 'codegen');
    const tree = { a: { v: 'x', next: { v: 'y' } } };
    assert.deepStrictEqual(fromBinary(resolved, toBinary(W, tree)), {
      a: { w: 'x', next: { w: 'y', next: null } },
    });
    const asked = resolve(W, model(entities('w'), { codegen: true }).Outer, {
      aliases: { 'a.w': 'v' },
    });
    assert.throws(() => toBinary(asked, tree), EvalError);
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

for (const [backend, options] of BACKENDS) {
  test(`Binary (${backend}): the cases of the wire give the golden bytes and read back`, () => {
    for (const item of CASES) {
      const schema = define(item.definition, { ...item.options, ...options });
      const bytes = toBinary(schema, item.value);
      assert.strictEqual(Buffer.from(bytes).toString('base64'), GOLDEN.cases[item.name], item.name);
      assert.deepStrictEqual(
        normalize(fromBinary(schema, Buffer.from(GOLDEN.cases[item.name], 'base64'))),
        expected(schema, item.value),
        item.name,
      );
    }
    for (const vector of VECTORS) {
      if (refused(vector.options)) continue;
      const schema = define(vector.definition, { ...vector.options, ...options });
      const golden = Buffer.from(GOLDEN.vectors[vector.name], 'base64');
      assert.deepStrictEqual(normalize(fromBinary(schema, golden)), expected(schema, vector.value));
    }
  });

  // A payload nested deeper than the stack is a depth error on both wires, as
  // on the text wire, without `maxDepth`; the message tells no offset, since
  // the engine, not the reader, refused it.
  test(`Binary (${backend}): a payload deeper than the stack is refused, as the text wire refuses it`, () => {
    const { Node } = model({ Node: { Struct: {}, v: 'integer', next: '?Node' } }, options);
    const levels = 200_000;
    const value = { v: 1, next: null };
    let tail = value;
    for (let i = 1; i < levels; i++) {
      tail.next = { v: 1, next: null };
      tail = tail.next;
    }
    assert.deepStrictEqual(
      failure(() => toBinary(Node, value)),
      failure(() => Node.encode(value)),
    );
    assert.strictEqual(failure(() => toBinary(Node, value)).code, 'depth');
    // The message such a value would give: a header of both fields and v at every level.
    const bytes = new Uint8Array(levels * 2);
    for (let i = 0; i < levels; i++) {
      bytes[i * 2] = i === levels - 1 ? 1 : 3;
      bytes[i * 2 + 1] = 2;
    }
    assert.deepStrictEqual(
      offsetOf(() => fromBinary(Node, bytes)),
      ['structure', undefined],
    );
    assert.strictEqual(
      failure(() => fromBinary(Node, bytes)).message,
      'Value is nested too deeply',
    );
  });
}

test('Binary: a schema that reaches one with no binary form keeps the refusal, as does one that reaches it', () => {
  // In automatic mode too, where the refusal is no reason to fall back.
  for (const [backend, options] of [...BACKENDS, ['automatic', {}]]) {
    const { A, C } = model(
      {
        A: { Struct: {}, c: '?C', tags: { array: 'string' } },
        C: { Struct: {}, a: '?A' },
      },
      { ...options, entities: { A: { intern: ['tags[]'] } } },
    );
    const refusal = { name: 'SchemaDefinitionError', code: 'ERR_NO_BINARY_FORM' };
    assert.throws(() => toBinary(A, { tags: [] }), refusal, backend);
    // C reaches A through a slot: its own build fails on A's refusal, which it
    // keeps rather than falling back to a codec it cannot have, and throws
    // again on every call instead of calling through a broken entry.
    assert.throws(() => toBinary(C, { a: null }), refusal, backend);
    assert.throws(() => toBinary(C, { a: null }), refusal, backend);
    assert.throws(() => fromBinary(C, Uint8Array.of(0)), refusal, backend);
    assert.strictEqual(C[BINARY].write, null, backend);
    assert.ok(C[BINARY].error instanceof SchemaDefinitionError, backend);
    assert.strictEqual(A[BINARY], undefined, backend);
  }
});

test('Binary: a message is read whole, and a DecodeError says where it broke', () => {
  for (const [backend, options] of BACKENDS) {
    const definition = { i: 'integer', role: { enum: ['a', 'b'] }, s: 'string' };
    const S = define(definition, options);
    const bytes = toBinary(S, { i: 1, role: 'b', s: 'hi' });
    // Nothing follows a message: a byte past it is an error, in every mode.
    for (const validate of [true, false]) {
      const R = define(definition, { ...options, validate });
      assert.deepStrictEqual(
        outcome(() => fromBinary(R, Uint8Array.of(...bytes, 99))),
        {
          name: 'DecodeError',
          code: 'extra',
          path: '',
          message: 'Value has extra elements',
          schema: '',
        },
        `${backend} validate ${validate}`,
      );
      assert.deepStrictEqual(normalize(fromBinary(R, bytes)), { i: 1, role: 'b', s: 'hi' });
    }
    // `offset` is where the reader stood when it refused the message: the
    // start of the slot that did not fit (the length byte of a cut string),
    // the byte after a wrong value, the end of the message before a byte past it.
    assert.deepStrictEqual(
      offsetOf(() => fromBinary(S, Uint8Array.of(...bytes, 99))),
      ['extra', bytes.length],
    );
    for (let cut = 0; cut < bytes.length; cut++) {
      const [code, offset] = offsetOf(() => fromBinary(S, bytes.subarray(0, cut)));
      assert.strictEqual(code, 'structure', `${backend} cut ${cut}`);
      assert.ok(Number.isInteger(offset) && offset <= cut, `${backend} cut ${cut}: ${offset}`);
    }
    assert.deepStrictEqual(
      offsetOf(() => fromBinary(S, bytes.subarray(0, 4))),
      ['structure', 3],
    );
    assert.deepStrictEqual(
      offsetOf(() => fromBinary(S, bytes.subarray(0, 1))),
      ['structure', 1],
    );
    const wrong = Uint8Array.from(bytes);
    wrong[2] = 7;
    assert.deepStrictEqual(
      offsetOf(() => fromBinary(S, wrong)),
      ['enum', 3],
      backend,
    );
    // Not for what is no message at all.
    assert.deepStrictEqual(
      offsetOf(() => fromBinary(S, 'text')),
      ['structure', undefined],
    );
    // The generated source is reachable through the entry, for debugging; a
    // closures codec has none.
    const { source } = S[BINARY];
    if (backend === 'codegen') assert.match(source, /function write\(w,v\)/);
    else assert.strictEqual(source, undefined);
  }
});

test('Binary: a schema makes its writer and reader on its first call of its own, and lets a message go', () => {
  const { Inner, Outer } = model({
    Inner: { Struct: {}, n: 'number' },
    Outer: { Struct: {}, in: 'Inner' },
  });
  const bytes = toBinary(Outer, { in: { n: 1 } });
  // Inner is reached through a slot: it writes and reads through Outer's.
  assert.strictEqual(Inner[BINARY].writer, null);
  assert.strictEqual(Inner[BINARY].reader, null);
  assert.notStrictEqual(Outer[BINARY].writer, null);
  assert.strictEqual(Outer[BINARY].reader, null);
  assert.deepStrictEqual(fromBinary(Outer, bytes), { in: { n: 1 } });
  assert.strictEqual(Outer[BINARY].reader.bytes, null);
  assert.strictEqual(Outer[BINARY].reader.view, null);
  assert.throws(() => fromBinary(Outer, bytes.subarray(0, 1)), DecodeError);
  assert.strictEqual(Outer[BINARY].reader.bytes, null);
  // A buffer grown past a mebibyte for one message is let go after it; a
  // smaller one is kept for the next.
  const Big = define({ s: 'string' });
  toBinary(Big, { s: 'x'.repeat(2 ** 21) });
  assert.strictEqual(Big[BINARY].writer.bytes.length, 1024);
  toBinary(Big, { s: 'x'.repeat(100_000) });
  const kept = Big[BINARY].writer.bytes.length;
  assert.ok(kept > 200_000 && kept <= 2 ** 20, `${kept}`);
  toBinary(Big, { s: 'y' });
  assert.strictEqual(Big[BINARY].writer.bytes.length, kept);
});

// `maxDepth` counts the levels of a recursion on the binary wire as it does on
// the text wire: the same count, so both refuse a payload at the same depth,
// on either backend, through a list and through a resolved plan's own
// recursions too.
test('Binary: maxDepth refuses a payload at the depth the text wire does', () => {
  const chain = (n) => (n === 0 ? null : { v: n, next: chain(n - 1) });
  const entities = (key) => ({ Node: { Struct: {}, [key]: 'integer', next: '?Node' } });
  for (const [backend, options] of BACKENDS) {
    const { Node } = model(entities('v'), { ...options, maxDepth: 3 });
    const { Node: Free } = model(entities('v'), options);
    const Read = resolve(Free, model(entities('w'), { ...options, maxDepth: 3 }).Node, {
      aliases: { w: 'v' },
    });
    for (let n = 1; n <= 5; n++) {
      const value = chain(n);
      const label = `${backend} depth ${n}`;
      assert.deepStrictEqual(
        failure(() => toBinary(Node, value)),
        failure(() => Node.encode(value)),
        label,
      );
      const bytes = toBinary(Free, value);
      assert.deepStrictEqual(
        failure(() => fromBinary(Node, bytes)),
        failure(() => Node.decode(Free.encode(value))),
        label,
      );
      assert.deepStrictEqual(
        failure(() => fromBinary(Node.list, toBinary(Free.list, [value]))),
        failure(() => Node.list.decode(Free.list.encode([value]))),
        label,
      );
      assert.deepStrictEqual(
        failure(() => fromBinary(Read, bytes)),
        failure(() => Read.decode(Free.encode(value))),
        `${label} resolved`,
      );
      const renamed = JSON.parse(JSON.stringify(value).replaceAll('"v"', '"w"'));
      assert.deepStrictEqual(
        failure(() => toBinary(Read, renamed)),
        failure(() => Read.encode(renamed)),
        `${label} resolved`,
      );
    }
    assert.strictEqual(
      failure(() => toBinary(Node, chain(3))),
      'ok',
      backend,
    );
    assert.strictEqual(failure(() => toBinary(Node, chain(4))).code, 'depth', backend);
  }
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
    // A varint of more than eight bytes ends past the message too: no value of the wire takes
    // more, and the arithmetic past 2^56 would reach Infinity and NaN.
    const nine = Uint8Array.of(...new Array(8).fill(0x80), 0x01);
    const eight = Uint8Array.of(...new Array(7).fill(0x80), 0x01);
    for (const method of ['uvar', 'svar']) {
      const long = new Reader().reset(nine, false);
      assert.strictEqual(long[method](), 0, method);
      assert.ok(long.pos > long.end, method);
      const fits = new Reader().reset(eight, false);
      fits[method]();
      assert.strictEqual(fits.pos, 8, method);
    }
    // An odd length of UTF-16 reads as undefined, in either twin.
    assert.strictEqual(new Reader().reset(Uint8Array.of(7, 65, 0, 66), false).string(), undefined);
    assert.strictEqual(new Reader().reset(Uint8Array.of(5, 65, 0), false).string(), 'A');
    // A UTF-8 sequence the string's end cuts ends it on the replacement character, as the
    // runtime's decoder does, without reading past the end.
    assert.strictEqual(
      new Reader().reset(Uint8Array.of(6, 65, 0xe2, 0x82), false).string(),
      'A\ufffd',
    );
    assert.strictEqual(
      new Reader().reset(Uint8Array.of(8, 0xd1, 0x8b, 0xf0, 0x9f), false).string(),
      'ы\ufffd',
    );
    // A buffer grown past a mebibyte is let go once the message is finished, a
    // smaller one kept; a released reader holds no message.
    const grown = new Writer();
    grown.string('x'.repeat(2 ** 21));
    assert.ok(grown.bytes.length > 2 ** 22);
    assert.strictEqual(grown.finish().length, 2 ** 22 + 4);
    assert.strictEqual(grown.bytes.length, 1024);
    grown.reset();
    grown.string('x'.repeat(50_000));
    grown.finish();
    assert.strictEqual(grown.bytes.length, 131072);
    const released = new Reader().reset(bytes, true);
    released.release();
    assert.strictEqual(released.bytes, null);
    assert.strictEqual(released.view, null);
    // The writer's loops end on any value: a value with no form never hangs the writer (the
    // backends refuse it before it gets here).
    const loose = new Writer();
    for (const v of [Infinity, -Infinity, NaN, 2 ** 70, -(2 ** 70)]) {
      const before = loose.pos;
      loose.uvar(v);
      loose.svar(v);
      assert.ok(loose.pos - before <= 20, `${v}`);
    }
  });
}
