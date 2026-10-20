const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { Schema, SchemaDefinitionError } = require('../../index.js');
const standalone = require('../../standalone.js');
const binary = require('../../binary.js');
const errors = require('../../src/errors.js');
const types = require('../../src/types.js');
const layouts = require('../../src/layouts.js');
const codegen = require('../../src/codegen.js');
const binaryCodegen = require('../../src/binary/generate.js');
const binaryWire = require('../../src/binary/wire.js');
const { readsNumbers } = require('../../src/binary/inspect.js');
const { codecOptions, SETTINGS, SHAPE, RECURSIVE } = require('../../src/schema.js');
const { resolve } = require('../../resolve.js');
const { VECTORS } = require('../support/vectors.js');
const { generate } = require('../support/generate.js');
const { ms, define, named, model } = require('../support/schema.js');

const ROOT = path.join(__dirname, '../..');
const PLAN = Symbol.for('alexify.protoarray.plan');
const CODEC = Symbol.for('alexify.protoarray.codec');
const BINARY = Symbol.for('alexify.protoarray.binary');

// A value compared across realms: classes by their tag, not their prototype.
const plain = (value) => {
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Date]') return { $date: value.getTime() };
  if (tag === '[object Uint8Array]') return { $bytes: Array.from(value) };
  if (tag === '[object Set]') return { $set: Array.from(value, plain) };
  if (tag === '[object Map]') {
    const entries = Array.from(value, (entry) => [entry[0], plain(entry[1])]);
    return { $map: entries };
  }
  if (typeof value === 'bigint') return { $bigint: String(value) };
  if (Array.isArray(value)) return Array.from(value, plain);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(out, key, { value: plain(value[key]), enumerable: true });
    }
    return out;
  }
  return value;
};

const outcome = (fn) => {
  try {
    return { value: plain(fn()) };
  } catch (error) {
    const { name, code, path: at, message, schema } = error;
    return { name, code, path: at, message, schema };
  }
};

// The package, bundled into a realm where source text never compiles: a
// generated module has to do without new Function there.
let bundled = null;
const restricted = async () => {
  if (bundled === null) {
    const result = await esbuild.build({
      stdin: {
        contents:
          "module.exports = { core: require('./index.js'), standalone: require('./standalone.js'), " +
          "binary: require('./binary.js') };",
        resolveDir: ROOT,
      },
      bundle: true,
      write: false,
      logLevel: 'silent',
      platform: 'browser',
      format: 'iife',
      globalName: 'protoarray',
    });
    bundled = result.outputFiles[0].text;
  }
  const context = vm.createContext(
    { btoa, atob, TextDecoder },
    { codeGeneration: { strings: false, wasm: false } },
  );
  vm.runInContext(bundled, context);
  return context;
};

// A generated CommonJS module, run in that realm.
const run = (source, context) => {
  const module = { exports: {} };
  const load = vm.runInContext(`(function (module, exports, require) {${source}\n})`, context);
  const { core, standalone: subpath } = context.protoarray;
  load(module, module.exports, (id) => {
    if (id === '@alexify/protoarray') return core;
    if (id === '@alexify/protoarray/standalone') return subpath;
    throw new Error(`Unexpected require of ${id}`);
  });
  return module.exports;
};

// The kernel of an inline module, run in process: a collection nested in a
// layout of its own is this process's, the wire kernel the node runtime's.
const kernel = () =>
  standalone.inline(errors, types, layouts, () => standalone.runtime.nested, binaryWire);

// The same schema, compiled in process for the inline kernel, its binary
// codec too when asked: a schema it reaches is an inline copy as well, made
// when first called, so a recursion finds its own copy.
const inlined = new WeakMap();
const inlineOf = (schema, withBinary = false) => {
  if (withBinary && inlined.has(schema)) return inlined.get(schema);
  const plan = schema[PLAN];
  const { target, interned, options } = codecOptions(plan, schema[SETTINGS]);
  const spec = {
    name: schema.name,
    id: schema.id,
    canonical: schema.toString(),
    kind: schema[SHAPE].kind,
    keys: schema.keys,
    layout: schema.layout,
    interned,
    validate: options.validate,
    codec: codegen.build(target, options),
  };
  if (schema.layout === 'flat' || schema.layout === 'columns') spec.record = plan.item;
  const { maxDepth } = schema[SETTINGS];
  if (schema[RECURSIVE] && maxDepth !== Infinity) spec.maxDepth = maxDepth;
  if (withBinary) {
    const context = {
      validate: schema[SETTINGS].validate,
      slot: (slot) => kernel().slot(() => inlineOf(slot.schema, true)),
    };
    spec.binary = binaryCodegen.build(plan, context);
    spec.numbers = readsNumbers(schema);
  }
  const copy = kernel().define(spec);
  if (withBinary) inlined.set(schema, copy);
  return copy;
};

// The binary wire of a module's schema, through the subpath for an import
// module's and the methods for an inline module's.
const bytesOf = (copy, api) => ({
  toBinary: (value) => (api === undefined ? copy.toBinary(value) : api.toBinary(copy, value)),
  fromBinary: (bytes) => (api === undefined ? copy.fromBinary(bytes) : api.fromBinary(copy, bytes)),
});

// A copy of the message with one byte changed, at a position of the seed's.
const flipped = (bytes, at) => {
  const copy = Uint8Array.from(bytes);
  copy[at % copy.length] ^= 0x55;
  return copy;
};

// What a module's schema and the reference agree on over the binary wire: the
// bytes, the value read back and every error, on good and broken input.
const agreeBinary = (copy, reference, value, label, api) => {
  const own = bytesOf(copy, api);
  const bytes = binary.toBinary(reference, value);
  assert.deepStrictEqual(
    outcome(() => own.toBinary(value)),
    outcome(() => bytes),
    label,
  );
  assert.deepStrictEqual(
    outcome(() => own.fromBinary(bytes)),
    outcome(() => binary.fromBinary(reference, bytes)),
    label,
  );
  for (const bad of [null, 1, [], {}, ['x', 'y'], { k: 'nope' }]) {
    assert.deepStrictEqual(
      outcome(() => own.toBinary(bad)),
      outcome(() => binary.toBinary(reference, bad)),
      label,
    );
  }
  const cuts = [0, 1, bytes.length >> 1, bytes.length - 1];
  const broken = cuts.map((cut) => bytes.subarray(0, cut));
  for (let i = 0; i < 4 && bytes.length > 0; i++) broken.push(flipped(bytes, i * 7 + 1));
  for (const garbage of [...broken, 'text', [1], Uint8Array.of(0xff, 0xff, 0xff, 0xff)]) {
    assert.deepStrictEqual(
      outcome(() => own.fromBinary(garbage)),
      outcome(() => binary.fromBinary(reference, garbage)),
      label,
    );
  }
};

// The options of the text wire a binary wire has no form for.
const noBinaryForm = (options = {}) =>
  options.intern !== undefined || options.delta !== undefined || options.layout !== undefined;

// The options by path of a record, for a collection of such records.
const within = (options) => {
  const out = {};
  for (const key of Object.keys(options)) out[key] = options[key].map((place) => `[].${place}`);
  return out;
};

// What a module's schema and the reference agree on: the wire, the text, the
// value decoded and every error, on good and broken input.
const agree = (copy, reference, value, label) => {
  const wire = reference.encode(value);
  assert.deepStrictEqual(
    outcome(() => copy.encode(value)),
    outcome(() => wire),
    label,
  );
  assert.strictEqual(copy.stringify(value), reference.stringify(value), label);
  assert.deepStrictEqual(
    outcome(() => copy.decode(wire)),
    outcome(() => reference.decode(wire)),
    label,
  );
  const text = JSON.stringify(wire);
  assert.deepStrictEqual(
    outcome(() => copy.parse(text)),
    outcome(() => reference.parse(text)),
    label,
  );
  assert.deepStrictEqual(
    outcome(() => copy.parse('[')),
    outcome(() => reference.parse('[')),
    label,
  );
  assert.strictEqual(copy.id, reference.id, label);
  assert.strictEqual(String(copy), String(reference), label);
  for (const bad of [null, 1, [], {}, [1, 2, 3, 4, 5], ['x', 'y']]) {
    assert.deepStrictEqual(
      outcome(() => copy.encode(bad)),
      outcome(() => reference.encode(bad)),
      label,
    );
    assert.deepStrictEqual(
      outcome(() => copy.decode(bad)),
      outcome(() => reference.decode(bad)),
      label,
    );
    assert.deepStrictEqual(
      outcome(() => copy.decode(bad, { strict: true })),
      outcome(() => reference.decode(bad, { strict: true })),
      label,
    );
    assert.deepStrictEqual(
      outcome(() => copy.stringify(bad)),
      outcome(() => reference.stringify(bad)),
      label,
    );
  }
};

test('Standalone: modules of both runtimes agree with the schemas on the vectors', async () => {
  const context = await restricted();
  const { snapshot } = define({ a: 'number' });
  assert.strictEqual(context.protoarray.core.Schema.from(snapshot).backend, 'closures');
  for (const vector of VECTORS) {
    const reference = define(vector.definition, vector.options);
    for (const runtime of ['import', 'inline']) {
      const label = `${vector.name} (${runtime})`;
      const copy = run(standalone.toSource(reference, { runtime }), context);
      if (runtime === 'import') {
        assert.strictEqual(copy.backend, 'standalone', label);
        assert.ok(copy instanceof context.protoarray.core.Schema, label);
      }
      agree(copy, reference, vector.value, label);
    }
    agree(inlineOf(reference), reference, vector.value, `${vector.name} (in process)`);
  }
});

test('Standalone: modules agree with the schemas on generated definitions', async () => {
  const context = await restricted();
  for (let seed = 1; seed <= 40; seed++) {
    const { definition, options: wire, value } = generate(seed);
    for (const options of [{}, { validate: false, sparse: true }, { intern: true }]) {
      const reference = define(definition, { ...wire, ...options });
      const label = `seed ${seed} ${JSON.stringify(options)}`;
      for (const runtime of ['import', 'inline']) {
        agree(run(standalone.toSource(reference, { runtime }), context), reference, value, label);
      }
      agree(inlineOf(reference), reference, value, label);
    }
    for (const layout of ['flat', 'columns']) {
      const reference = define({ array: definition }, { ...within(wire), layout });
      const label = `seed ${seed} ${layout}`;
      for (const runtime of ['import', 'inline']) {
        agree(
          run(standalone.toSource(reference, { runtime }), context),
          reference,
          [value, value],
          label,
        );
      }
      agree(inlineOf(reference), reference, [value, value], label);
    }
  }
});

test('Standalone: a module of several schemas, embedded and recursive ones included', async () => {
  const context = await restricted();
  const Embedded = ms.Schema.from({ city: 'string', zip: '?string' });
  const { User, Address, Tag } = model(
    {
      Address: { Struct: {}, city: 'string', zip: '?string' },
      Tag: { union: [{ k: { enum: ['a'] }, n: 'integer' }], discriminator: 'k' },
      User: {
        Struct: {},
        id: 'integer',
        name: 'string',
        home: Embedded,
        'work?': 'Address',
        'boss?': 'User',
        tags: { array: 'Tag' },
        calc: (user) => user.id,
        at: { type: 'integer', default: 0 },
      },
    },
    { stringify: 'builder' },
  );
  // One entity built again with options of its own is built on its own.
  const Sparse = Schema.from(Address, { sparse: true });
  const value = {
    id: 1,
    name: 'A',
    home: { city: 'K' },
    work: { city: 'L', zip: '1' },
    boss: { id: 2, name: 'B', home: { city: 'M' }, tags: [] },
    tags: [{ k: 'a', n: 3 }],
  };
  for (const runtime of ['import', 'inline']) {
    const source = standalone.toSource({ User, Address, Tag, Sparse }, { runtime });
    const copies = run(source, context);
    agree(copies.User, User, value, runtime);
    agree(copies.Address, Address, { city: 'K' }, runtime);
    agree(copies.Tag, Tag, { k: 'a', n: 1 }, runtime);
    agree(copies.Sparse, Sparse, { zip: '1' }, runtime);
    assert.deepStrictEqual(plain(copies.User.keys), plain(User.keys));
  }
  // The entities of one snapshot are built together, from the snapshot.
  const source = standalone.toSource({ User, Sparse });
  assert.strictEqual(source.match(/Schema\.fromModel\(/g).length, 1);
  assert.strictEqual(source.match(/new Schema\(/g).length, 1);
  assert.match(
    source,
    /= new Schema\("Address",M0\$,\{[\s\S]*,entity:"Address",entities:\{\}\}\);\n/,
  );
  const { User: copy } = run(standalone.toSource({ User }), context);
  assert.strictEqual(copy.list.backend, 'closures');
  assert.deepStrictEqual(
    plain(copy.list.decode([User.encode(value)])),
    plain(User.list.decode([User.encode(value)])),
  );
});

test('Standalone: a collection inside a record in a layout of its own', async () => {
  const context = await restricted();
  const Outer = define(
    {
      items: { array: { a: 'number', b: '?number' } },
      cols: { array: { s: 'string', at: 'date' } },
      tag: 'string',
    },
    {
      layout: { items: 'flat', cols: 'columns' },
      intern: ['cols[].s', 'tag'],
      delta: ['cols[].at'],
    },
  );
  const value = {
    items: [{ a: 1 }, { a: 2, b: 3 }],
    cols: [
      { s: 'x', at: new Date(5) },
      { s: 'x', at: new Date(7) },
    ],
    tag: 'x',
  };
  for (const runtime of ['import', 'inline']) {
    const source = standalone.toSource(Outer, { runtime });
    // Written in place: a nested layout has no snapshot of its own.
    assert.strictEqual(source.match(/R\.nested\(/g).length, 2, runtime);
    agree(run(source, context), Outer, value, runtime);
  }
  agree(inlineOf(Outer), Outer, value, 'in process');
  // Interned strings in the nested collection alone: the record is interned
  // too, and the message has one table.
  const Inner = define(
    { cols: { array: { s: 'string' } }, n: 'number' },
    { layout: { cols: 'columns' }, intern: ['cols[].s'] },
  );
  const inner = { cols: [{ s: 'x' }, { s: 'x' }], n: 1 };
  assert.deepStrictEqual(Inner.encode(inner), [['x'], [[[0, 0]], 1]]);
  for (const runtime of ['import', 'inline']) {
    const source = standalone.toSource(Inner, { runtime });
    assert.match(source, /R\.nested\(\{[^]*interned:true/, runtime);
    agree(run(source, context), Inner, inner, runtime);
  }
  agree(inlineOf(Inner), Inner, inner, 'in process');
});

// An import module of these schemas, run in this process.
const local = (schemas, options) => {
  const module = { exports: {} };
  const load = vm.runInThisContext(
    `(function (module, require) {${standalone.toSource(schemas, options)}\n})`,
  );
  load(module, (id) =>
    require(id === '@alexify/protoarray' ? '../../index.js' : '../../standalone.js'),
  );
  return module.exports;
};

test('Standalone: an import module runs in this process too', () => {
  const { User } = model({
    Address: { Struct: {}, city: 'string' },
    User: { Struct: {}, home: 'Address', 'boss?': 'User', n: 'integer' },
  });
  const copy = local({ User }).User;
  const value = { home: { city: 'K' }, boss: { home: { city: 'L' }, n: 2 }, n: 1 };
  assert.ok(copy instanceof Schema);
  assert.strictEqual(copy.backend, 'standalone');
  assert.strictEqual(copy.id, User.id);
  assert.deepStrictEqual(copy.decode(copy.encode(value)), User.decode(User.encode(value)));
  assert.throws(() => copy.decode([['K'], [[1], null, 2], 1]), {
    code: 'type',
    path: 'boss.home.city',
    schema: 'User',
  });
  // Built from the snapshot it embeds, without metaschema.
  assert.deepStrictEqual(copy.snapshot, User.snapshot);
  assert.strictEqual(copy.source, null);
  // A collection in a layout of its own, through the runtime's `nested`.
  const Outer = define(
    { items: { array: { s: 'string', n: '?number' } }, tag: 'string' },
    { layout: { items: 'columns' }, intern: ['items[].s', 'tag'] },
  );
  const outer = local({ Outer }).Outer;
  agree(outer, Outer, { items: [{ s: 'a' }, { s: 'a', n: 2 }], tag: 'a' }, 'nested');
});

test('Standalone: the inline kernel', () => {
  const { define: build, slot, nested, types: kernelTypes } = kernel();
  const target = { codec: 'codec', binary: { write: 'write', read: 'read' } };
  const reference = slot(() => target);
  assert.strictEqual(reference.codec, 'codec');
  assert.strictEqual(reference.write, 'write');
  assert.strictEqual(reference.read, 'read');
  assert.strictEqual(nested, standalone.runtime.nested);
  assert.strictEqual(kernelTypes, types);
  assert.strictEqual(typeof build, 'function');
  // An error that is not the data's passes through encode.
  const copy = inlineOf(define({ a: 'json' }));
  const broken = {
    get a() {
      throw new RangeError('not a depth problem');
    },
  };
  assert.throws(() => copy.encode(broken), RangeError);
  assert.throws(() => copy.stringify(broken), RangeError);
});

test('Standalone: the runtime of import modules', () => {
  const { runtime } = standalone;
  assert.deepStrictEqual(Object.keys(runtime), [
    'types',
    'fail',
    'nest',
    'refuse',
    'slot',
    'nested',
    'compiled',
    'check',
  ]);
  const A = define({ a: 'integer' });
  const slot = runtime.slot(() => A);
  assert.strictEqual(slot.codec, A[CODEC]);
  // The binary codec of a slot is the one the schema carries.
  const carried = { write: () => {}, read: () => {} };
  const compiled = { canonical: A.toString(), codec: A[CODEC], binary: carried };
  const B = define({ a: 'integer' }, { compiled });
  const both = runtime.slot(() => B);
  assert.strictEqual(both.codec, B[CODEC]);
  assert.strictEqual(both.write, carried.write);
  assert.strictEqual(both.read, carried.read);
  // A module of another version refuses to load.
  assert.match(standalone.toSource(A), /\nR\.check\(2\);\n/);
  assert.strictEqual(runtime.check(2), undefined);
  assert.throws(() => runtime.check(3), { code: 'ERR_COMPILED_MISMATCH' });
  assert.throws(
    () => runtime.check(1),
    (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.strictEqual(error.code, 'ERR_COMPILED_MISMATCH');
      assert.strictEqual(
        error.message,
        'The module was generated by another version of protoarray: generate it again',
      );
      return true;
    },
  );
});

// What an import module compiles while it loads in this process: nothing,
// however its schemas reach one another.
const compiledWhileLoading = (schemas, options) => {
  const original = globalThis.Function;
  let calls = 0;
  globalThis.Function = new Proxy(original, {
    construct(target, args) {
      calls += 1;
      return Reflect.construct(target, args);
    },
  });
  try {
    return { exports: local(schemas, options), calls };
  } finally {
    globalThis.Function = original;
  }
};

test('Standalone: an import module compiles nothing while it loads', () => {
  // An entity no exported schema reaches is not built again: not even one
  // whose custom type has no wire type here.
  const custom = { email: { kind: 'string', metadata: {} } };
  const snapshot = {
    format: 1,
    root: 'C',
    types: custom,
    entities: {
      A: { fields: { x: { type: 'integer' }, b: { type: 'B', one: 'B', required: false } } },
      B: { fields: { n: { type: 'number' } } },
      C: { fields: { e: { type: 'email' } } },
    },
  };
  const { A, C } = Schema.fromModel(snapshot, { types: { email: 'string' } });
  assert.strictEqual(C.toString(), '{e:string}');
  const one = compiledWhileLoading({ A });
  assert.strictEqual(one.calls, 0);
  assert.strictEqual(one.exports.A.encode({ x: 1, b: { n: 2 } }).length, 2);
  assert.deepStrictEqual(Object.keys(one.exports.A.snapshot.entities), ['A', 'B']);
  // The root it names is not in the module.
  assert.strictEqual(one.exports.A.snapshot.root, undefined);
  const rooted = local({ C }).C;
  assert.strictEqual(rooted.snapshot.root, 'C');
  // A collection in a layout of its own is written in place.
  const Outer = define(
    { items: { array: { a: 'number', b: '?number' } }, tag: 'string' },
    { layout: { items: 'flat' } },
  );
  const nested = compiledWhileLoading({ Outer });
  assert.strictEqual(nested.calls, 0);
  agree(nested.exports.Outer, Outer, { items: [{ a: 1 }], tag: 'x' }, 'nested');
  // Its own codec is built if something calls it.
  const reader = define(
    { items: { array: { a: 'number' } }, tag: 'string' },
    { layout: { items: 'flat' } },
  );
  assert.deepStrictEqual(resolve(nested.exports.Outer, reader).decode([[1, null], 'x']), {
    items: [{ a: 1 }],
    tag: 'x',
  });
  // An entity built again with options of its own reads the entities it
  // reaches from the module.
  const { User } = model({
    Address: { Struct: {}, city: 'string' },
    User: { Struct: {}, home: 'Address', 'boss?': 'User' },
  });
  const Sparse = Schema.from(User, { sparse: true });
  const both = compiledWhileLoading({ User, Sparse });
  assert.strictEqual(both.calls, 0);
  agree(both.exports.Sparse, Sparse, { home: { city: 'K' }, boss: null }, 'alone');
});

test('Standalone: the records of a rows collection stream from the module', async () => {
  const { parseItems, stringifyItems } = require('../../stream.js');
  const context = await restricted();
  const User = ms.Schema.from({ id: 'integer', name: 'string' });
  const rows = Schema.from({ array: User }, { metaschema: ms });
  const flat = Schema.from({ array: User }, { metaschema: ms, layout: 'flat' });
  const values = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
  ];
  const collect = async (items) => {
    const out = [];
    for await (const item of items) out.push(plain(item));
    return out;
  };
  for (const schema of [rows, flat]) {
    const text = Array.from(stringifyItems(schema, values)).join('');
    const source = standalone.toSource({ schema });
    for (const copy of [local({ schema }).schema, run(source, context).schema]) {
      assert.strictEqual(Array.from(stringifyItems(copy, values)).join(''), text);
      assert.deepStrictEqual(await collect(parseItems(copy, text)), plain(values));
    }
  }
  assert.match(standalone.toSource(rows), /items:\(function/);
  // A flat collection's codec is its record's; a record that is a schema of
  // its own is called through its slot; an interned one streams no records.
  const { Points } = model({ Point: { Struct: {}, x: 'number' }, Points: { array: 'Point' } });
  const interned = define({ array: { s: 'string' } }, { intern: true });
  for (const schema of [flat, Points, interned]) {
    assert.doesNotMatch(standalone.toSource(schema), /items:\(function/);
  }
  const copy = local({ Points }).Points;
  assert.strictEqual(Array.from(stringifyItems(copy, [{ x: 1 }])).join(''), '[[1]]');
});

test('Standalone: a snapshot key the reader keeps is the same key in the module', async () => {
  const context = await restricted();
  const text =
    '{"format":1,"root":"U","entities":{"U":{"fields":{"a":{"type":"string","__proto__":{"default":"x"}}}}}}';
  const U = new Schema(JSON.parse(text));
  for (const runtime of ['import', 'inline']) {
    agree(run(standalone.toSource(U, { runtime }), context), U, { a: 'y' }, runtime);
  }
  assert.deepStrictEqual(local({ U }).U.snapshot, U.snapshot);
});

test('Standalone: the compiled option', () => {
  const A = define({ a: 'integer' });
  const codec = A[CODEC];
  const compiled = { canonical: A.toString(), id: 'custom', codec };
  const B = define({ a: 'integer' }, { compiled });
  assert.strictEqual(B.backend, 'standalone');
  assert.strictEqual(B.id, 'custom');
  assert.deepStrictEqual(B.encode({ a: 1 }), [1]);
  assert.throws(() => B.decode(['x']), { code: 'type', path: 'a' });
  assert.strictEqual(define({ a: 'integer' }, { compiled: { ...compiled, id: 1 } }).id, A.id);
  assert.throws(
    () => define({ a: 'string' }, { compiled }),
    (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.strictEqual(error.code, 'ERR_COMPILED_MISMATCH');
      assert.strictEqual(
        error.message,
        'The compiled codec is of another schema: generate it again',
      );
      return true;
    },
  );
  assert.throws(() => define({ a: 'integer' }, { compiled, codegen: true }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'A compiled codec replaces code generation',
  });
  for (const bad of [
    {},
    { canonical: 1, codec },
    { canonical: 'x', codec: {} },
    { canonical: 'x', codec: null },
    { canonical: 'x', codec: { encode: () => 1 } },
    { canonical: 'x' },
    { canonical: 'x', codec, binary: null },
    { canonical: 'x', codec, binary: {} },
    { canonical: 'x', codec, binary: { write: () => {} } },
    { canonical: 'x', codec, binary: { write: 1, read: () => {} } },
    null,
  ]) {
    assert.throws(() => define({ a: 'integer' }, { compiled: bad }), {
      code: 'ERR_INVALID_OPTIONS',
    });
  }
  // A binary codec in it is the one the binary wire runs, built or inspected no further.
  binary.toBinary(A, { a: 1 });
  const { write, read } = A[BINARY];
  const C = define({ a: 'integer' }, { compiled: { ...compiled, binary: { write, read } } });
  assert.deepStrictEqual(binary.toBinary(C, { a: 1 }), binary.toBinary(A, { a: 1 }));
  assert.strictEqual(C[BINARY].write, write);
  assert.strictEqual(C[BINARY].read, read);
  assert.deepStrictEqual(binary.fromBinary(C, binary.toBinary(A, { a: 2 })), { a: 2 });
  assert.throws(() => binary.fromBinary(C, Uint8Array.of(1)), { code: 'structure', path: 'a' });
});

test('Standalone: what toSource refuses', () => {
  const W = define({ a: 'integer' });
  const R = resolve(W, define({ a: 'number' }));
  assert.throws(() => standalone.toSource(R), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'A resolved schema is built at runtime: write its writer and reader instead',
  });
  assert.throws(() => standalone.toSource({ List: W.list }), {
    code: 'ERR_INVALID_OPTIONS',
    message: '"List": The list of a schema is built at runtime: write the schema instead',
  });
  assert.throws(() => standalone.toSource(W.list), {
    message: 'The list of a schema is built at runtime: write the schema instead',
  });
  assert.throws(() => standalone.toSource(W, { format: 'ESM' }), {
    message: 'Invalid option "format": cjs or esm',
  });
  assert.throws(() => standalone.toSource(W, { runtime: 'remote' }), {
    message: 'Invalid option "runtime": import or inline',
  });
  assert.throws(() => standalone.toSource(W, { binary: 'yes' }), {
    message: 'Invalid option "binary": true or false',
  });
  for (const options of [1, { other: 1 }, { runtime: 'remote' }, { format: 'umd' }]) {
    assert.throws(() => standalone.toSource(W, options), { code: 'ERR_INVALID_OPTIONS' });
  }
  // With binary, a schema with no binary form is refused, a reached one by its name.
  const Interned = named('Tags', { tags: { array: 'string' } }, { intern: ['tags[]'] });
  for (const runtime of ['import', 'inline']) {
    assert.throws(
      () => standalone.toSource(Interned, { runtime, binary: true }),
      {
        code: 'ERR_NO_BINARY_FORM',
        message: 'The binary wire has no form for an interned string at "tags[]"',
        schema: 'Tags',
        field: 'tags[]',
      },
      runtime,
    );
  }
  const { Outer } = model(
    { Tags: { Struct: {}, t: { array: 'string' } }, Outer: { Struct: {}, tags: 'Tags' } },
    { entities: { Tags: { intern: ['t[]'] } } },
  );
  assert.throws(() => standalone.toSource({ Outer }, { binary: true }), {
    code: 'ERR_NO_BINARY_FORM',
    schema: 'Tags',
    field: 't[]',
  });
  assert.doesNotThrow(() => standalone.toSource({ Outer }));
  assert.throws(
    () =>
      standalone.toSource(define({ array: { a: 'number' } }, { layout: 'flat' }), {
        binary: true,
      }),
    { code: 'ERR_NO_BINARY_FORM' },
  );
  assert.throws(() => standalone.toSource(W, 1), {
    message: 'Invalid options: expected an object',
  });
  assert.throws(() => standalone.toSource({ 'not-a-name': W }), {
    code: 'ERR_INVALID_OPTIONS',
    message: '"not-a-name" is not a name a module can export',
  });
  assert.throws(() => standalone.toSource({ A: 1 }), {
    code: 'ERR_SCHEMA_EXPECTED',
    message: '"A" is not a schema',
  });
  // A metaschema Schema is built into a protoarray one first.
  assert.throws(() => standalone.toSource({ A: W.source }), { code: 'ERR_SCHEMA_EXPECTED' });
  assert.throws(() => standalone.toSource(null), {
    code: 'ERR_SCHEMA_EXPECTED',
    message: 'A schema or a record of schemas expected',
  });
  assert.strictEqual(standalone.toSource(W, null), standalone.toSource(W));
});

test('Standalone: ES modules import and export by name', () => {
  const dir = path.join(ROOT, 'tests', '.generated');
  fs.mkdirSync(dir, { recursive: true });
  const User = named('User', { id: 'integer', name: 'string' });
  const Note = define({ text: 'string' });
  const bytes = Array.from(binary.toBinary(User, { id: 1, name: 'a' }));
  for (const runtime of ['import', 'inline']) {
    const file = path.join(dir, `module-${runtime}.mjs`);
    const options = { runtime, format: 'esm', binary: true };
    fs.writeFileSync(file, standalone.toSource({ User, Note }, options));
    const single = path.join(dir, `single-${runtime}.mjs`);
    fs.writeFileSync(single, standalone.toSource(Note, { runtime, format: 'esm' }));
    // An import module's binary wire is the subpath's, an inline module's its own.
    const toBytes =
      runtime === 'import'
        ? "import { toBinary } from '@alexify/protoarray/binary'; const bytes = toBinary(User, { id: 1, name: 'a' });"
        : "const bytes = User.toBinary({ id: 1, name: 'a' });";
    const script = [
      `import { User, Note } from ${JSON.stringify(`./${path.basename(file)}`)};`,
      `import Single from ${JSON.stringify(`./${path.basename(single)}`)};`,
      toBytes,
      'process.stdout.write(JSON.stringify([User.encode({ id: 1, name: "a" }), Note.stringify({ text: "x" }), Single.decode(["y"]), Array.from(bytes)]));',
    ].join('\n');
    const entry = path.join(dir, `entry-${runtime}.mjs`);
    fs.writeFileSync(entry, script);
    const output = execFileSync(process.execPath, [entry], { cwd: ROOT, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(output), [[1, 'a'], '["x"]', { text: 'y' }, bytes], runtime);
  }
});

test('Standalone: register() adds schema.toSource()', () => {
  const S = define({ a: 'integer' });
  assert.strictEqual(S.toSource, undefined);
  standalone.register();
  standalone.register();
  assert.strictEqual(
    S.toSource({ runtime: 'inline' }),
    standalone.toSource(S, { runtime: 'inline' }),
  );
  assert.deepStrictEqual(Object.keys(Schema.prototype), []);
});

test('Standalone: maxDepth counts the levels of a recursion in a module too, an alias is its target', async () => {
  const context = await restricted();
  const entities = {
    Node: { Struct: {}, v: 'number', kids: { array: 'Node' } },
    Alias: 'Node',
    Id: 'string',
  };
  const { Node, Alias, Id } = model(entities, { maxDepth: 512 });
  const nested = (depth) => {
    let value = { v: 1, kids: [] };
    for (let i = 1; i < depth; i++) value = { v: 1, kids: [value] };
    return value;
  };
  for (const runtime of ['import', 'inline']) {
    const copies = run(standalone.toSource({ Node, Alias, Id }, { runtime }), context);
    // Deep values compare as their text: an engine's deepEqual may run out of stack on them.
    agree(copies.Node, Node, nested(3), runtime);
    const deepest = nested(512);
    const text = JSON.stringify(Node.encode(deepest));
    assert.strictEqual(JSON.stringify(copies.Node.encode(deepest)), text, runtime);
    assert.strictEqual(JSON.stringify(Node.encode(copies.Node.parse(text))), text, runtime);
    const deeper = nested(513);
    const encoded = outcome(() => copies.Node.encode(deeper));
    assert.strictEqual(encoded.code, 'depth', runtime);
    assert.deepStrictEqual(
      encoded,
      outcome(() => Node.encode(deeper)),
    );
    const wire = [1, [Node.encode(nested(512))]];
    const decoded = outcome(() => copies.Node.decode(wire));
    assert.strictEqual(decoded.code, 'structure', runtime);
    assert.deepStrictEqual(
      decoded,
      outcome(() => Node.decode(wire)),
    );
    agree(copies.Alias, Alias, nested(3), runtime);
    agree(copies.Id, Id, 'u1', runtime);
    // Without the option a module counts nothing either.
    const free = model(entities).Node;
    const unlimited = run(standalone.toSource({ Node: free }, { runtime }), context).Node;
    const long = JSON.stringify(free.encode(nested(600)));
    assert.strictEqual(JSON.stringify(unlimited.encode(nested(600))), long, runtime);
    assert.strictEqual(JSON.stringify(free.encode(unlimited.parse(long))), long, runtime);
  }
  // In this process too: the inline kernel, and an import module's alias.
  const inline = inlineOf(Node);
  agree(inline, Node, nested(3), 'in process');
  assert.strictEqual(
    JSON.stringify(inline.encode(nested(512))),
    JSON.stringify(Node.encode(nested(512))),
  );
  const deeper = nested(513);
  assert.deepStrictEqual(
    outcome(() => inline.encode(deeper)),
    outcome(() => Node.encode(deeper)),
  );
  agree(local({ Alias }).Alias, Alias, nested(3), 'in process');
});

// A module written with `binary` carries the codec of the binary wire next to
// the text one: in the realm without code generation, an import module's
// schemas run it through the subpath, an inline module's through their own
// methods, both writing the bytes the schema writes in this process.
test('Standalone: modules written with binary agree with the schemas on the vectors', async () => {
  const context = await restricted();
  const api = context.protoarray.binary;
  for (const vector of VECTORS) {
    const reference = define(vector.definition, vector.options);
    if (noBinaryForm(vector.options)) {
      assert.throws(
        () => standalone.toSource(reference, { binary: true }),
        { code: 'ERR_NO_BINARY_FORM' },
        vector.name,
      );
      continue;
    }
    for (const runtime of ['import', 'inline']) {
      const label = `${vector.name} (${runtime})`;
      const source = standalone.toSource(reference, { runtime, binary: true });
      const copy = run(source, context);
      // The text wire is unchanged next to it.
      agree(copy, reference, vector.value, label);
      agreeBinary(copy, reference, vector.value, label, runtime === 'import' ? api : undefined);
      if (runtime === 'import') {
        assert.strictEqual(copy[BINARY].write, copy[SETTINGS].compiled.binary.write, label);
      } else {
        assert.strictEqual(typeof copy.toBinary, 'function', label);
      }
    }
    agreeBinary(inlineOf(reference, true), reference, vector.value, `${vector.name} (in process)`);
  }
});

test('Standalone: modules written with binary agree with the schemas on generated definitions', async () => {
  const context = await restricted();
  const api = context.protoarray.binary;
  for (let seed = 1; seed <= 40; seed++) {
    // The wire options of the shape (delta, intern) have no binary form: the definition alone.
    const { definition, value } = generate(seed);
    for (const options of [{}, { validate: false, sparse: true }]) {
      const reference = define(definition, options);
      const label = `seed ${seed} ${JSON.stringify(options)}`;
      for (const runtime of ['import', 'inline']) {
        const copy = run(standalone.toSource(reference, { runtime, binary: true }), context);
        agreeBinary(copy, reference, value, label, runtime === 'import' ? api : undefined);
      }
      agreeBinary(inlineOf(reference, true), reference, value, label);
    }
  }
});

test('Standalone: the binary wire of a module of several schemas', async () => {
  const context = await restricted();
  const api = context.protoarray.binary;
  const Embedded = ms.Schema.from({ city: 'string', zip: '?string' });
  const { User, Address, Tag, Node, Alias } = model({
    Address: { Struct: {}, city: 'string', zip: '?string' },
    Tag: { union: [{ k: { enum: ['a'] }, n: 'integer' }], discriminator: 'k' },
    User: {
      Struct: {},
      id: 'integer',
      name: 'string',
      home: Embedded,
      'work?': 'Address',
      'boss?': 'User',
      tags: { array: 'Tag' },
      on: 'boolean',
      score: 'number',
    },
    Node: { Struct: {}, v: 'number', kids: { array: 'Node' } },
    Alias: 'Node',
  });
  const Sparse = Schema.from(User, { sparse: true });
  const value = {
    id: 1,
    name: 'A',
    home: { city: 'K' },
    work: { city: 'L', zip: '1' },
    boss: { id: 2, name: 'B', home: { city: 'M' }, tags: [], on: false, score: 0.5 },
    tags: [{ k: 'a', n: 3 }],
    on: true,
    score: 1.5,
  };
  const tree = {
    v: 1,
    kids: [
      { v: 2, kids: [] },
      { v: 3, kids: [{ v: 4, kids: [] }] },
    ],
  };
  const schemas = { User, Address, Tag, Node, Alias, Sparse };
  for (const runtime of ['import', 'inline']) {
    const source = standalone.toSource(schemas, { runtime, binary: true });
    const copies = run(source, context);
    const own = runtime === 'import' ? api : undefined;
    agreeBinary(copies.User, User, value, runtime, own);
    agreeBinary(copies.Address, Address, { city: 'K' }, runtime, own);
    agreeBinary(copies.Tag, Tag, { k: 'a', n: 1 }, runtime, own);
    agreeBinary(copies.Node, Node, tree, runtime, own);
    agreeBinary(copies.Alias, Alias, tree, runtime, own);
    agreeBinary(copies.Sparse, Sparse, value, runtime, own);
    // An error deep in a reached schema carries the path and the root's name.
    const bytes = bytesOf(copies.User, own).toBinary(value);
    const cut = bytesOf(copies.User, own);
    assert.deepStrictEqual(
      outcome(() => cut.fromBinary(bytes.subarray(0, 6))),
      outcome(() => binary.fromBinary(User, bytes.subarray(0, 6))),
      runtime,
    );
    assert.strictEqual(outcome(() => cut.fromBinary(bytes.subarray(0, 6))).schema, 'User');
  }
  // In process too, the inline kernel's slots reaching the inline copies.
  agreeBinary(inlineOf(User, true), User, value, 'in process');
  agreeBinary(inlineOf(Node, true), Node, tree, 'in process');
  agreeBinary(inlineOf(Alias, true), Alias, tree, 'in process');
  // An entity built again with options of its own carries the binary codec in
  // its compiled option, and the members it reads from the module carry theirs.
  const source = standalone.toSource({ User, Sparse }, { binary: true });
  assert.strictEqual(source.match(/binary:\(function/g).length, 6);
  assert.match(source, /compiled:R\.compiled\(S\d+\)/);
  const { Sparse: alone } = local({ User, Sparse }, { binary: true });
  assert.deepStrictEqual(binary.toBinary(alone, value), binary.toBinary(Sparse, value));
  assert.deepStrictEqual(
    plain(binary.fromBinary(alone, binary.toBinary(Sparse, value))),
    plain(binary.fromBinary(Sparse, binary.toBinary(Sparse, value))),
  );
});

test('Standalone: a module written with binary builds no binary codec at runtime', () => {
  const { User } = model({
    Address: { Struct: {}, city: 'string', n: 'number' },
    User: { Struct: {}, home: 'Address', 'boss?': 'User', tags: { array: 'string' } },
  });
  const value = {
    home: { city: 'K', n: 1.5 },
    boss: { home: { city: 'L', n: 2 }, tags: [] },
    tags: ['a'],
  };
  const loaded = compiledWhileLoading({ User }, { binary: true });
  assert.strictEqual(loaded.calls, 0);
  const copy = loaded.exports.User;
  const original = globalThis.Function;
  let calls = 0;
  globalThis.Function = new Proxy(original, {
    construct(target, args) {
      calls += 1;
      return Reflect.construct(target, args);
    },
  });
  let bytes;
  let back;
  try {
    bytes = binary.toBinary(copy, value);
    back = binary.fromBinary(copy, bytes);
  } finally {
    globalThis.Function = original;
  }
  assert.strictEqual(calls, 0);
  assert.deepStrictEqual(bytes, binary.toBinary(User, value));
  assert.deepStrictEqual(back, binary.fromBinary(User, bytes));
  assert.strictEqual(copy[BINARY].write, copy[SETTINGS].compiled.binary.write);
  assert.strictEqual(copy[BINARY].numbers, true);
  // The list of a schema is built at runtime over the schema's carried codec.
  const list = binary.toBinary(copy.list, [value]);
  assert.deepStrictEqual(list, binary.toBinary(User.list, [value]));
  assert.deepStrictEqual(binary.fromBinary(copy.list, list), binary.fromBinary(User.list, list));
  // Without the option a module carries no bytes, and the subpath builds the codec as usual.
  const bare = local({ User }).User;
  assert.strictEqual(bare[SETTINGS].compiled.binary, undefined);
  assert.deepStrictEqual(binary.toBinary(bare, value), bytes);
  assert.strictEqual(bare.backend, 'standalone');
});

test('Standalone: the inline kernel around a binary codec', () => {
  const S = define({ j: 'json', n: 'number', b: 'bytes' });
  const copy = inlineOf(S, true);
  const other = { j: 'other', n: 2, b: new Uint8Array([1]) };
  const expectedOther = binary.toBinary(S, other);
  // A call made while the schema is encoding takes a writer and a reader of its own.
  let inner;
  const value = {
    j: {
      toJSON() {
        inner = [copy.toBinary(other), copy.fromBinary(expectedOther)];
        return 'outer';
      },
    },
    n: 1,
    b: new Uint8Array(0),
  };
  const bytes = copy.toBinary(value);
  assert.deepStrictEqual(bytes, binary.toBinary(S, { ...value, j: 'outer' }));
  assert.deepStrictEqual(plain(copy.fromBinary(bytes)), plain(binary.fromBinary(S, bytes)));
  assert.deepStrictEqual(inner[0], expectedOther);
  assert.deepStrictEqual(plain(inner[1]), plain(other));
  // The errors are the binary wire's, with the schema's name.
  assert.throws(() => copy.fromBinary('text'), {
    name: 'DecodeError',
    code: 'structure',
    message: 'Value is not a Uint8Array',
  });
  assert.throws(() => copy.toBinary({ ...other, b: 'AQ==' }), {
    name: 'EncodeError',
    code: 'type',
    path: 'b',
  });
  assert.throws(() => copy.fromBinary(bytes.subarray(0, 3)), { name: 'DecodeError' });
  // An error that is not the data's passes through.
  const broken = {
    get n() {
      throw new RangeError('not a depth problem');
    },
  };
  assert.throws(() => copy.toBinary(broken), RangeError);
  // A module without binary has no such methods.
  const plainCopy = inlineOf(S);
  assert.strictEqual(plainCopy.toBinary, undefined);
  assert.strictEqual(plainCopy.fromBinary, undefined);
  assert.strictEqual(plainCopy.binary, undefined);
});
