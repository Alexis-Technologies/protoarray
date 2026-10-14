const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, SchemaDefinitionError, EncodeError, DecodeError } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');

// wrpc's packets: the discriminator `type` lives inside every branch. A
// struct that starts with `type` reads as the long form, in metaschema as
// here, so each branch names its kind first.
const Call = {
  Struct: {},
  type: { enum: ['call'] },
  id: 'string',
  method: 'string',
  args: '?json',
};
const Event = { Struct: {}, type: { enum: ['event'] }, name: 'string', data: '?json' };
const Ping = { Struct: {}, type: { enum: ['ping', 'pong'] } };

const invalid = (definition, code, message, options) => {
  assert.throws(
    () => new Schema('T', definition, options),
    (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.strictEqual(error.code, code);
      if (message !== undefined) assert.strictEqual(error.message, message);
      return true;
    },
  );
};

for (const [backend, options] of BACKENDS) {
  const Packet = new Schema(
    'Packet',
    { union: [Call, Event, Ping], discriminator: 'type' },
    options,
  );

  test(`Union (${backend}): the tag leads, the discriminator does not travel twice`, () => {
    assert.strictEqual(Packet.backend, backend);
    const call = { type: 'call', id: '7', method: 'auth/signIn', args: ['a', 'b'] };
    assert.deepStrictEqual(Packet.encode(call), [0, '7', 'auth/signIn', ['a', 'b']]);
    assert.deepStrictEqual(Packet.decode([0, '7', 'auth/signIn', ['a', 'b']]), call);
    assert.deepStrictEqual(Packet.encode({ type: 'event', name: 'chat/msg' }), [1, 'chat/msg']);
    assert.deepStrictEqual(Packet.decode([1, 'chat/msg']), {
      type: 'event',
      name: 'chat/msg',
      data: null,
    });
    // A branch with several values: the tag is the value's place among all of them.
    assert.deepStrictEqual(Packet.encode({ type: 'ping' }), [2]);
    assert.deepStrictEqual(Packet.encode({ type: 'pong' }), [3]);
    assert.deepStrictEqual(Packet.decode([3]), { type: 'pong' });
    assert.strictEqual(Packet.stringify({ type: 'pong', extra: 1 }), '[3]');
    assert.deepStrictEqual(Packet.parse('[1,"n",{"a":1}]'), {
      type: 'event',
      name: 'n',
      data: { a: 1 },
    });
  });

  test(`Union (${backend}): decoded objects keep the branch's key order`, () => {
    const Shape = Schema.from(
      {
        union: [
          { r: 'number', kind: { enum: ['circle'] } },
          { w: 'number', h: '?number', kind: { enum: ['rect'] } },
        ],
        discriminator: 'kind',
      },
      options,
    );
    const circle = Shape.decode([0, 2]);
    assert.deepStrictEqual(Object.keys(circle), ['r', 'kind']);
    assert.deepStrictEqual(circle, { r: 2, kind: 'circle' });
    assert.deepStrictEqual(Object.keys(Shape.decode([1, 3])), ['w', 'h', 'kind']);
    assert.deepStrictEqual(Shape.encode({ kind: 'rect', w: 3 }), [1, 3]);
    assert.deepStrictEqual(Shape.keys, []);
    assert.strictEqual(Shape.layout, 'dense');
    assert.strictEqual(
      Shape.toString(),
      'union(kind)[{r:number,kind:enum(circle)}|{w:number,h:?number,kind:enum(rect)}]',
    );
  });

  test(`Union (${backend}): a union as a field, an array item and a list`, () => {
    const Envelope = Schema.from(
      { v: 'number', packet: Packet, batch: { array: Packet, required: false } },
      options,
    );
    const value = {
      v: 1,
      packet: { type: 'ping' },
      batch: [
        { type: 'event', name: 'x' },
        { type: 'call', id: '1', method: 'm' },
      ],
    };
    const wire = [
      1,
      [2],
      [
        [1, 'x'],
        [0, '1', 'm'],
      ],
    ];
    assert.deepStrictEqual(Envelope.encode(value), wire);
    assert.deepStrictEqual(Envelope.decode(wire), {
      v: 1,
      packet: { type: 'ping' },
      batch: [
        { type: 'event', name: 'x', data: null },
        { type: 'call', id: '1', method: 'm', args: null },
      ],
    });
    assert.deepStrictEqual(Envelope.encode({ v: 1, packet: { type: 'pong' } }), [1, [3]]);
    // A wrpc batch: an array of packets, each one an array that starts with a number.
    assert.deepStrictEqual(Packet.list.encode(value.batch), wire[2]);
    assert.deepStrictEqual(Packet.list.decode(wire[2]), Envelope.decode(wire).batch);
    assert.strictEqual(Packet.list.toString(), `[${Packet.toString()}]`);
    const Inline = Schema.from(
      { p: { union: [Ping, Event], discriminator: 'type', required: false } },
      options,
    );
    assert.deepStrictEqual(Inline.encode({}), []);
    assert.deepStrictEqual(Inline.decode([]), { p: null });
    assert.deepStrictEqual(Inline.encode({ p: { type: 'event', name: 'n' } }), [[2, 'n']]);
  });

  test(`Union (${backend}): a branch may refer to the union by name`, () => {
    const Node = new Schema(
      'Node',
      {
        union: [
          { Struct: {}, type: { enum: ['leaf'] }, v: 'number' },
          { Struct: {}, type: { enum: ['pair'] }, left: 'Node', right: 'Node' },
        ],
        discriminator: 'type',
      },
      { ...options, validate: 'both' },
    );
    const tree = {
      type: 'pair',
      left: { type: 'leaf', v: 1 },
      right: { type: 'pair', left: { type: 'leaf', v: 2 }, right: { type: 'leaf', v: 3 } },
    };
    const wire = [1, [0, 1], [1, [0, 2], [0, 3]]];
    assert.deepStrictEqual(Node.encode(tree), wire);
    assert.deepStrictEqual(Node.decode(wire), tree);
    assert.throws(() => Node.decode([1, [0, 1], [1, [0, 2], [7]]]), {
      code: 'union',
      path: 'right.right.type',
    });
    assert.throws(() => Node.encode({ ...tree, left: { type: 'leaf', v: 'x' } }), {
      code: 'type',
      path: 'left.v',
    });
  });

  test(`Union (${backend}): branches given as schemas or by name are built anew`, () => {
    const CallSchema = new Schema('Call', Call, { ...options, validate: false });
    const EventSchema = new Schema('Event', Event, options);
    const Mixed = Schema.from(
      { union: [CallSchema, 'Event'], discriminator: 'type' },
      { ...options, schemas: { Event: EventSchema } },
    );
    assert.deepStrictEqual(Mixed.encode({ type: 'event', name: 'n' }), [1, 'n']);
    assert.deepStrictEqual(Mixed.decode([0, 'i', 'm']), {
      type: 'call',
      id: 'i',
      method: 'm',
      args: null,
    });
    // The union's options apply to its branches, not those of the schemas they came from.
    assert.throws(() => Mixed.decode([0, 1, 'm']), { code: 'type', path: 'id' });
    assert.strictEqual(
      Mixed.toString(),
      Schema.from({ union: [Call, Event], discriminator: 'type' }).toString(),
    );
  });

  test(`Union (${backend}): the discriminator and the tag are always checked`, () => {
    const loose = new Schema('Packet', Packet.definition, { ...options, validate: false });
    for (const schema of [Packet, loose]) {
      for (const value of [{}, { type: 'nope' }, { type: null }, { type: 'Call' }]) {
        assert.throws(
          () => schema.encode(value),
          (error) => {
            assert.ok(error instanceof EncodeError);
            assert.strictEqual(error.code, 'union');
            assert.strictEqual(error.path, 'type');
            assert.strictEqual(error.schema, 'Packet');
            assert.strictEqual(
              error.message,
              'Field "type" is not of union: call, event, ping, pong',
            );
            return true;
          },
        );
      }
      for (const wire of [[], [4], [-1], [1.5], ['0'], [null, 'x']]) {
        assert.throws(
          () => schema.decode(wire),
          (error) => {
            assert.ok(error instanceof DecodeError);
            assert.strictEqual(error.code, 'union');
            assert.strictEqual(error.path, 'type');
            return true;
          },
        );
      }
      assert.throws(() => schema.encode(5), { code: 'object', path: '' });
      assert.throws(() => schema.decode('x'), { code: 'structure', path: '' });
    }
    // Without validation the fields themselves are trusted, as in any struct.
    assert.deepStrictEqual(loose.decode([0, 1]), { type: 'call', id: 1, method: null, args: null });
    assert.deepStrictEqual(loose.encode({ type: 'call' }), [0, null, null]);
    assert.deepStrictEqual(Packet.encode({ type: 'call' }), [0, null, null]);
    const strict = new Schema('Packet', Packet.definition, { ...options, validate: 'both' });
    assert.throws(() => strict.encode({ type: 'call' }), { code: 'required', path: 'id' });
    assert.throws(() => Packet.decode([0, 1, 'm']), { code: 'type', path: 'id' });
  });

  test(`Union (${backend}): trailing optionals are trimmed down to the tag`, () => {
    assert.deepStrictEqual(Packet.encode({ type: 'event', name: 'n', data: null }), [1, 'n']);
    const Optional = Schema.from(
      {
        union: [{ Struct: {}, type: { enum: ['a'] }, x: '?number', y: '?number' }],
        discriminator: 'type',
      },
      options,
    );
    assert.deepStrictEqual(Optional.encode({ type: 'a' }), [0]);
    assert.deepStrictEqual(Optional.encode({ type: 'a', x: 1 }), [0, 1]);
    assert.deepStrictEqual(Optional.encode({ type: 'a', y: 1 }), [0, null, 1]);
    assert.deepStrictEqual(Optional.decode([0]), { type: 'a', x: null, y: null });
  });

  test(`Union (${backend}): strict decoding counts the tag`, () => {
    assert.deepStrictEqual(Packet.decode([1, 'n', 1, 'future']), {
      type: 'event',
      name: 'n',
      data: 1,
    });
    assert.deepStrictEqual(Packet.decode([1, 'n', 1], { strict: true }).data, 1);
    assert.throws(() => Packet.decode([1, 'n', 1, 'future'], { strict: true }), {
      code: 'extra',
      path: '',
    });
    assert.throws(() => Packet.decode([2, 'x'], { strict: true }), { code: 'extra' });
  });

  test(`Union (${backend}): errors inside a branch carry their path`, () => {
    // A schema by value keeps its own mode: the packets check their values too.
    const both = { ...options, validate: 'both' };
    const Strict = new Schema('Packet', Packet.definition, both);
    const Envelope = Schema.from({ batch: { array: Strict } }, both);
    assert.throws(
      () =>
        Envelope.decode([
          [
            [0, '1', 'm'],
            [1, 2],
          ],
        ]),
      {
        code: 'type',
        path: 'batch[1].name',
      },
    );
    assert.throws(() => Envelope.decode([[[0, '1', 'm'], [9]]]), {
      code: 'union',
      path: 'batch[1].type',
    });
    assert.throws(() => Envelope.decode([[[0, '1', 'm'], null]]), {
      code: 'type',
      path: 'batch[1]',
      message: 'Field "batch[1]" is not of expected type: object',
    });
    assert.throws(
      () => Envelope.encode({ batch: [{ type: 'call', id: '1', method: 'm' }, null] }),
      {
        code: 'type',
        path: 'batch[1]',
      },
    );
    assert.throws(() => Envelope.encode({ batch: [{ type: 'event' }] }), {
      code: 'required',
      path: 'batch[0].name',
    });
    assert.throws(() => Envelope.encode({ batch: [{ type: 'x' }] }), {
      code: 'union',
      path: 'batch[0].type',
    });
  });
}

test('Union: definition errors', () => {
  invalid({ union: [Call, Event] }, 'ERR_UNKNOWN_TYPE', 'A union needs a discriminator');
  invalid({ union: [Call], discriminator: '' }, 'ERR_UNKNOWN_TYPE');
  invalid(
    { union: [], discriminator: 'type' },
    'ERR_INVALID_UNION',
    'A union needs at least one branch',
  );
  const branch = 'A branch must be a struct with the required enum "type" without a default';
  invalid({ union: ['string'], discriminator: 'type' }, 'ERR_INVALID_UNION', `${branch} at "[0]"`);
  invalid({ union: [{ id: 'string' }], discriminator: 'type' }, 'ERR_INVALID_UNION');
  invalid(
    { union: [{ id: 'string', type: 'string' }], discriminator: 'type' },
    'ERR_INVALID_UNION',
  );
  invalid(
    { union: [{ id: 'string', type: { enum: ['a'], default: 'a' } }], discriminator: 'type' },
    'ERR_INVALID_UNION',
  );
  // The tag always travels: an optional discriminator would never be missing.
  invalid(
    { union: [{ Struct: {}, 'type?': { enum: ['a'] }, id: 'string' }], discriminator: 'type' },
    'ERR_INVALID_UNION',
  );
  invalid(
    { union: [{ id: 'string', type: { enum: ['a'], required: false } }], discriminator: 'type' },
    'ERR_INVALID_UNION',
  );
  invalid({ union: [Call, 'T'], discriminator: 'type' }, 'ERR_INVALID_UNION', `${branch} at "[1]"`);
  invalid({ union: [Call, 'Missing'], discriminator: 'type' }, 'ERR_UNKNOWN_REFERENCE');
  const Sparse = Schema.from(Call, { sparse: true });
  invalid({ union: [Sparse], discriminator: 'type' }, 'ERR_INVALID_UNION');
  const List = Schema.from({ array: Call });
  invalid({ union: [List], discriminator: 'type' }, 'ERR_INVALID_UNION');
  invalid({ union: [Call, Call], discriminator: 'type' }, 'ERR_INVALID_UNION');
  invalid(
    {
      union: [
        { Struct: {}, type: { enum: [1] } },
        { Struct: {}, type: { enum: ['1'] } },
      ],
      discriminator: 'type',
    },
    'ERR_INVALID_UNION',
    'Expected unique strings or numbers',
  );
  invalid({ union: [Call], discriminator: 'type' }, 'ERR_INVALID_OPTIONS', undefined, {
    sparse: true,
  });
  invalid({ array: { union: [Call], discriminator: 'type' } }, 'ERR_INVALID_OPTIONS', undefined, {
    layout: 'flat',
  });
  // A struct that merely starts with a key named `union` is one metaschema would
  // read as a union too, so it is refused rather than read differently.
  invalid({ union: 'string', id: 'number' }, 'ERR_UNKNOWN_TYPE');
  invalid({ union: ['string', 'number'] }, 'ERR_UNKNOWN_TYPE', 'A union needs a discriminator');
  assert.deepStrictEqual(Schema.from({ id: 'number', union: 'string' }).keys, ['id', 'union']);
});

test('Union: the id follows the branches and their order', () => {
  const a = Schema.from({ union: [Call, Event], discriminator: 'type' });
  const b = Schema.from({ union: [Event, Call], discriminator: 'type' });
  const c = Schema.from({ union: [Call, Event], discriminator: 'type' }, { codegen: false });
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(a.id, c.id);
  assert.match(a.toString(), /^union\(type\)\[\{type:enum\(call\),id:string/);
});

// Numeric discriminator values, unions inside layouts and sparse records, and
// hostile discriminator keys: the tag is an index, whatever the values are.
for (const [backend, options] of BACKENDS) {
  test(`Union (${backend}): numeric discriminator values are matched exactly`, () => {
    const Code = Schema.from(
      {
        union: [
          { Struct: {}, code: { enum: [1] }, a: 'string' },
          { Struct: {}, code: { enum: [2, 3] } },
        ],
        discriminator: 'code',
      },
      options,
    );
    assert.deepStrictEqual(Code.encode({ code: 1, a: 'x' }), [0, 'x']);
    assert.deepStrictEqual(Code.encode({ code: 3 }), [2]);
    assert.deepStrictEqual(Code.decode([2]), { code: 3 });
    for (const value of ['1', '3', 1.5, true, [1], { valueOf: () => 1 }]) {
      assert.throws(() => Code.encode({ code: value }), { code: 'union', path: 'code' });
      assert.strictEqual(Code.check({ code: value }).code, 'union');
    }
    assert.throws(() => Code.decode([3]), { code: 'union', path: 'code' });
  });

  test(`Union (${backend}): unions inside layouts and sparse records`, () => {
    const both = { ...options, validate: 'both' };
    const Packet = new Schema(
      'Packet',
      { union: [Call, Event, Ping], discriminator: 'type' },
      both,
    );
    const value = [{ p: { type: 'call', id: '1', method: 'm' } }, { p: { type: 'ping' } }];
    for (const layout of ['rows', 'flat', 'columns']) {
      const Grid = Schema.from({ array: { p: Packet, n: '?number' } }, { ...both, layout });
      const wire = Grid.encode(value);
      assert.deepStrictEqual(Grid.decode(wire), [
        { p: { type: 'call', id: '1', method: 'm', args: null }, n: null },
        { p: { type: 'ping' }, n: null },
      ]);
      assert.deepStrictEqual(Grid.decode(wire, { strict: true }), Grid.decode(wire));
      assert.throws(() => Grid.encode([{ p: { type: 'nope' } }]), {
        code: 'union',
        path: '[0].p.type',
      });
    }
    const Flat = Schema.from({ array: { p: Packet } }, { ...both, layout: 'flat' });
    assert.throws(() => Flat.decode([[2, 'extra']], { strict: true }), {
      code: 'extra',
      path: '[0].p',
    });
    const Sparse = Schema.from(
      { a: '?number', p: { union: [Call, Ping], discriminator: 'type', required: false } },
      { ...both, sparse: true },
    );
    assert.deepStrictEqual(Sparse.encode({ p: { type: 'pong' } }), [2, [2]]);
    assert.deepStrictEqual(Sparse.decode([2, [2]]), { a: null, p: { type: 'pong' } });
    assert.throws(() => Sparse.decode([2, [2, 'x']], { strict: true }), {
      code: 'extra',
      path: 'p',
    });
    assert.throws(() => Sparse.decode([2, [7]]), { code: 'union', path: 'p.type' });
  });

  test(`Union (${backend}): hostile discriminator keys and values`, () => {
    const LS = String.fromCharCode(0x2028);
    const key = `t"\\${LS}`;
    const values = ['a"b', `c\\${LS}`, 'd*/e'];
    const Hostile = Schema.from(
      {
        union: [
          { [key]: { enum: values.slice(0, 2) }, v: 'string' },
          { [key]: { enum: values.slice(2) } },
        ],
        discriminator: key,
      },
      options,
    );
    assert.deepStrictEqual(Hostile.encode({ [key]: values[1], v: 'x' }), [1, 'x']);
    assert.deepStrictEqual(Hostile.decode([2]), { [key]: 'd*/e' });
    assert.deepStrictEqual(Hostile.decode([0, 'y']), { [key]: 'a"b', v: 'y' });
    assert.throws(() => Hostile.encode({ [key]: 'nope' }), {
      code: 'union',
      path: key,
      message: `Field "${key}" is not of union: ${values.join(', ')}`,
    });
  });
}
