const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, DecodeError, EncodeError, encodeEach, decodeEach } = require('../../index.js');
const stream = require('../../stream.js');
const { BACKENDS, normalize } = require('../support/backends.js');
const { generate } = require('../support/generate.js');

const collect = async (iterable) => {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
};

const rejects = async (iterable, expected) => {
  await assert.rejects(() => collect(iterable), expected);
};

async function* from(list) {
  for (const value of list) yield value;
}

// ReadableStream.from is newer than Node.js 18.
const streamOf = (list) =>
  new ReadableStream({
    start(controller) {
      for (const value of list) controller.enqueue(value);
      controller.close();
    },
  });

// The bytes of a text, cut into chunks of `size` bytes: multi-byte characters
// and escapes end up split between chunks.
const bytes = (text, size) => {
  const all = new TextEncoder().encode(text);
  const out = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
};

for (const [backend, options] of BACKENDS) {
  const both = { ...options, validate: 'both' };
  const User = new Schema('User', { id: 'number', name: '?string' }, both);

  test(`Stream (${backend}): encodeEach and decodeEach`, async () => {
    assert.deepStrictEqual(
      [...User.encodeEach([{ id: 1 }, { id: 2, name: 'x' }])],
      [[1], [2, 'x']],
    );
    assert.deepStrictEqual([...encodeEach(User, new Set([{ id: 3 }]))], [[3]]);
    assert.deepStrictEqual(await collect(User.encodeEach(from([{ id: 4 }]))), [[4]]);
    assert.deepStrictEqual(
      [...User.decodeEach([[1], [2, 'x']])],
      [
        { id: 1, name: null },
        { id: 2, name: 'x' },
      ],
    );
    assert.deepStrictEqual(await collect(decodeEach(User, from([[5]]))), [{ id: 5, name: null }]);
    assert.throws(() => [...User.decodeEach([[1, 'x', 3]], { strict: true })], {
      code: 'extra',
      path: '[0]',
    });
    // An error names the index of its value, and the schema.
    assert.throws(
      () => [...User.encodeEach([{ id: 1 }, { id: 'x' }])],
      (error) => {
        assert.ok(error instanceof EncodeError);
        assert.strictEqual(error.path, '[1].id');
        assert.strictEqual(error.schema, 'User');
        return true;
      },
    );
    await rejects(User.decodeEach(from([[1], ['x']])), {
      code: 'type',
      path: '[1].id',
      schema: 'User',
    });
    assert.throws(() => [...User.encodeEach([null])], { code: 'object', path: '[0]' });
    // Lazy: nothing is converted before it is asked for.
    const lazy = User.encodeEach([{ id: 1 }, { id: 'x' }]);
    assert.deepStrictEqual(lazy.next().value, [1]);
    for (const bad of ['ab', 1, null, {}]) {
      assert.throws(() => User.encodeEach(bad), {
        code: 'iterable',
        message: 'Value is not iterable',
        schema: 'User',
      });
      assert.throws(
        () => User.decodeEach(bad),
        (error) => {
          assert.ok(error instanceof DecodeError);
          assert.strictEqual(error.code, 'structure');
          assert.strictEqual(error.message, 'Value is not iterable');
          return true;
        },
      );
    }
  });

  test(`Stream (${backend}): NDJSON lines`, async () => {
    const values = [{ id: 1 }, { id: 2, name: 'é"\n' }];
    const text = [...stream.stringifyLines(User, values)].join('');
    assert.strictEqual(text, '[1]\n[2,"é\\"\\n"]\n');
    assert.deepStrictEqual(await collect(stream.stringifyLines(User, from(values))), [
      '[1]\n',
      '[2,"é\\"\\n"]\n',
    ]);
    assert.throws(() => [...stream.stringifyLines(User, [{ id: 1 }, {}])], {
      code: 'required',
      path: '[1].id',
    });
    const decoded = [
      { id: 1, name: null },
      { id: 2, name: 'é"\n' },
    ];
    assert.deepStrictEqual(await collect(stream.parseLines(User, text)), decoded);
    for (const size of [1, 2, 3, 7]) {
      assert.deepStrictEqual(await collect(stream.parseLines(User, bytes(text, size))), decoded);
      assert.deepStrictEqual(
        await collect(stream.parseLines(User, from(bytes(text, size)))),
        decoded,
      );
    }
    // CRLF, blank lines and a last line without its newline.
    const crlf = '\r\n[1]\r\n  \n\n[2,"x"]';
    assert.deepStrictEqual(await collect(stream.parseLines(User, [crlf])), [
      { id: 1, name: null },
      { id: 2, name: 'x' },
    ]);
    // A ReadableStream is read through its reader, async-iterable or not.
    const readable = streamOf(bytes(text, 3));
    const reader = { getReader: () => readable.getReader() };
    assert.deepStrictEqual(await collect(stream.parseLines(User, reader)), decoded);
    // Errors name the value's index.
    await rejects(stream.parseLines(User, '[1]\n[2,'), (error) => {
      assert.strictEqual(error.code, 'json');
      assert.strictEqual(error.path, '[1]');
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    });
    await rejects(stream.parseLines(User, '[1]\n["x"]\n'), { code: 'type', path: '[1].id' });
    await rejects(stream.parseLines(User, '[1,null,2]\n', { strict: true }), {
      code: 'extra',
      path: '[0]',
    });
    await rejects(stream.parseLines(User, [new Uint8Array([0x5b, 0xff, 0x5d])]), (error) => {
      assert.strictEqual(error.code, 'json');
      assert.ok(error.cause instanceof TypeError);
      return true;
    });
    // A multi-byte character cut off at the end.
    await rejects(stream.parseLines(User, [new Uint8Array([0x5b, 0x31, 0x5d, 0x0a, 0xc3])]), {
      code: 'json',
    });
    assert.throws(() => stream.parseLines(User, 1), {
      code: 'structure',
      message: 'Value is not iterable',
    });
    assert.throws(() => stream.parseLines({}, ''), { code: 'ERR_SCHEMA_EXPECTED' });
    assert.throws(() => stream.stringifyLines({}, []), { code: 'ERR_SCHEMA_EXPECTED' });
  });

  test(`Stream (${backend}): TransformStreams`, async () => {
    const lines = await collect(
      streamOf([{ id: 1 }, { id: 2 }]).pipeThrough(stream.stringifyStream(User)),
    );
    assert.deepStrictEqual(lines, ['[1]\n', '[2]\n']);
    const values = await collect(
      streamOf(bytes('[1]\n[2,"é"]\n[3]', 2)).pipeThrough(stream.parseStream(User)),
    );
    assert.deepStrictEqual(values, [
      { id: 1, name: null },
      { id: 2, name: 'é' },
      { id: 3, name: null },
    ]);
    await rejects(streamOf([{ id: 1 }, { id: 'x' }]).pipeThrough(stream.stringifyStream(User)), {
      code: 'type',
      path: '[1].id',
    });
    await rejects(streamOf(['[1]\n["x"]']).pipeThrough(stream.parseStream(User)), {
      code: 'type',
      path: '[1].id',
    });
    await rejects(
      streamOf(['[1,null,9]\n']).pipeThrough(stream.parseStream(User, { strict: true })),
      { code: 'extra', path: '[0]' },
    );
    assert.throws(() => stream.stringifyStream({}), { code: 'ERR_SCHEMA_EXPECTED' });
    assert.throws(() => stream.parseStream({}), { code: 'ERR_SCHEMA_EXPECTED' });
  });

  test(`Stream (${backend}): the items of a large array`, async () => {
    const Users = User.list;
    const values = [{ id: 1, name: 'a,]"\\' }, { id: 2 }, { id: 3, name: '[{' }];
    const text = [...stream.stringifyItems(Users, values)].join('');
    assert.strictEqual(text, Users.stringify(values));
    assert.deepStrictEqual(await collect(stream.stringifyItems(Users, from(values))), [
      '[',
      '[1,"a,]\\"\\\\"]',
      ',[2]',
      ',[3,"[{"]',
      ']',
    ]);
    const decoded = Users.parse(text);
    for (const size of [1, 2, 5, 64]) {
      assert.deepStrictEqual(await collect(stream.parseItems(Users, bytes(text, size))), decoded);
    }
    const spaced = ' \n[ [1 , "x"] ,\t[2] , [3,{"a":[1,{"b":"]"}]}] ]\r\n ';
    const Loose = Schema.from({ array: { id: 'number', name: '?json' } }, options);
    assert.deepStrictEqual(await collect(stream.parseItems(Loose, spaced)), Loose.parse(spaced));
    assert.deepStrictEqual(await collect(stream.parseItems(Users, '[]')), []);
    assert.deepStrictEqual(await collect(stream.parseItems(Users, ['[', ' ', ']'])), []);
    // Items as the collection has them: required records, optional ones.
    await rejects(stream.parseItems(Users, '[[1],null]'), {
      code: 'type',
      path: '[1]',
      message: 'Field "[1]" is not of expected type: object',
    });
    const Optional = Schema.from({ array: { type: 'json', required: false } }, both);
    assert.deepStrictEqual(await collect(stream.parseItems(Optional, '[null,1]')), [null, 1]);
    assert.deepStrictEqual(
      [...stream.stringifyItems(Optional, [null, { a: 1 }])].join(''),
      '[null,{"a":1}]',
    );
    const Nullable = Schema.from({ array: { id: 'number' }, required: false }, both);
    assert.deepStrictEqual([...stream.stringifyItems(User.list, [{ id: 1 }])].join(''), '[[1]]');
    assert.throws(() => [...stream.stringifyItems(Users, [{ id: 1 }, null])], {
      code: 'type',
      path: '[1]',
    });
    assert.deepStrictEqual(Nullable.decode([[1]]), [{ id: 1 }]);
    const Trusting = Schema.from({ array: { id: 'number' } }, { ...options, validate: false });
    assert.deepStrictEqual([...stream.stringifyItems(Trusting, [null])].join(''), '[null]');
    assert.deepStrictEqual(await collect(stream.parseItems(Trusting, '[null]')), [null]);
    await rejects(stream.parseItems(Users, '[[1],["x"]]'), { code: 'type', path: '[1].id' });
    await rejects(stream.parseItems(Users, '[[1,null,2]]', { strict: true }), {
      code: 'extra',
      path: '[0]',
    });
    for (const [bad, path] of [
      ['[[1],]', '[1]'],
      ['[,[1]]', '[0]'],
      ['[[1],,[2]]', '[1]'],
      ['[[1] [2]]', '[0]'],
      ['[[1],[2}]', '[1]'],
    ]) {
      await rejects(stream.parseItems(Users, bad), (error) => {
        assert.strictEqual(error.code, 'json', bad);
        assert.strictEqual(error.path, path, bad);
        return true;
      });
    }
    for (const bad of ['[[1]', 'x[[1]]', '[[1]] x', '', '{}']) {
      await rejects(stream.parseItems(Users, bad), { code: 'json', path: '' });
    }
    assert.throws(() => stream.parseItems(Users, null), { code: 'structure' });
    assert.throws(() => stream.stringifyItems(Users, 'x'), { code: 'iterable' });
  });

  test(`Stream (${backend}): flat collections and what cannot stream`, async () => {
    const Flat = Schema.from({ array: { a: 'number', b: '?string' } }, { ...both, layout: 'flat' });
    const values = [{ a: 1 }, { a: 2, b: 'x' }];
    const text = [...stream.stringifyItems(Flat, values)].join('');
    assert.strictEqual(text, '[1,null,2,"x"]');
    assert.strictEqual(text, Flat.stringify(values));
    assert.deepStrictEqual(
      await collect(stream.parseItems(Flat, bytes(text, 3))),
      Flat.parse(text),
    );
    await rejects(stream.parseItems(Flat, '[1,null,2]'), {
      code: 'structure',
      message: 'Value has a wrong length',
    });
    await rejects(stream.parseItems(Flat, '[1,null,"x",null]'), { code: 'type', path: '[1].a' });
    await rejects(stream.parseItems(Flat, '[1,null,2,"x}]'), { code: 'json', path: '' });
    await rejects(stream.parseItems(Flat, '[1,null,2,x]'), { code: 'json', path: '[1]' });
    assert.throws(() => [...stream.stringifyItems(Flat, [null])], { code: 'type', path: '[0]' });
    for (const schema of [
      Schema.from({ array: { a: 'number' } }, { ...options, layout: 'columns' }),
      Schema.from({ array: { a: 'string' } }, { ...options, intern: true }),
      User,
    ]) {
      assert.throws(() => stream.parseItems(schema, '[]'), {
        code: 'ERR_INVALID_OPTIONS',
        message:
          'Only a collection in rows or flat, without interned strings, streams item by item',
      });
    }
    assert.throws(() => stream.parseItems({}, '[]'), { code: 'ERR_SCHEMA_EXPECTED' });
  });

  test(`Stream (${backend}): parseItems agrees with parse on generated collections`, async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { definition, value } = generate(seed);
      const List = Schema.from(definition, options).list;
      // An interned collection has one table for the whole payload: no items on their own.
      if (List.toString().includes('string*')) continue;
      const text = List.stringify([value, value]);
      assert.strictEqual([...stream.stringifyItems(List, [value, value])].join(''), text);
      const items = await collect(stream.parseItems(List, bytes(text, 1 + (seed % 7))));
      assert.deepStrictEqual(normalize(items), normalize(List.parse(text)), `seed ${seed}`);
    }
  });
}

test('Stream: register() installs the functions as methods of Schema', async () => {
  const User = Schema.from({ id: 'number' });
  assert.strictEqual(User.parseLines, undefined);
  stream.register();
  stream.register();
  assert.strictEqual(Object.keys(Schema.prototype).length, 0);
  assert.deepStrictEqual([...User.stringifyLines([{ id: 1 }])], ['[1]\n']);
  assert.deepStrictEqual(await collect(User.parseLines('[1]')), [{ id: 1 }]);
  assert.deepStrictEqual([...User.list.stringifyItems([{ id: 2 }])], ['[', '[2]', ']']);
  assert.deepStrictEqual(await collect(User.list.parseItems('[[2]]')), [{ id: 2 }]);
  assert.ok(User.stringifyStream() instanceof TransformStream);
  assert.ok(User.parseStream() instanceof TransformStream);
});

// The scanner finds where items end through escapes, quotes and brackets in
// strings, whatever byte or character a chunk is cut at.
test('Stream: parseItems at every split point of strings full of escapes', async () => {
  const List = Schema.from({ array: { a: 'string', b: '?json' } });
  const pool = ['', 'x', '\\', '"', '\\"', 'a\\\\b', '[', ']', '{', '}', ',', 'é', '\u{1F600}'];
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = () => pool[Math.floor(random() * pool.length)];
  for (let n = 0; n < 40; n++) {
    const count = 1 + Math.floor(random() * 3);
    const list = Array.from({ length: count }, () => ({
      a: pick() + pick(),
      b: random() < 0.5 ? null : { k: [pick()] },
    }));
    const text = List.stringify(list);
    const expected = List.parse(text);
    const all = new TextEncoder().encode(text);
    for (let cut = 0; cut <= all.length; cut++) {
      const parts = [all.slice(0, cut), all.slice(cut)];
      assert.deepStrictEqual(
        await collect(stream.parseItems(List, parts)),
        expected,
        `${text} ${cut}`,
      );
    }
    for (let cut = 0; cut <= text.length; cut++) {
      const parts = [text.slice(0, cut), text.slice(cut)];
      assert.deepStrictEqual(
        await collect(stream.parseItems(List, parts)),
        expected,
        `${text} ${cut}`,
      );
    }
  }
});
