const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { Schema, SchemaDefinitionError } = require('../../index.js');
const standalone = require('../../standalone.js');
const errors = require('../../src/errors.js');
const types = require('../../src/types.js');
const layouts = require('../../src/layouts.js');
const codegen = require('../../src/codegen.js');
const { codecOptions, SETTINGS } = require('../../src/schema.js');
const { VECTORS } = require('../support/vectors.js');
const { generate } = require('../support/generate.js');

const ROOT = path.join(__dirname, '../..');
const PLAN = Symbol.for('alexify.protoarray.plan');
const CODEC = Symbol.for('alexify.protoarray.codec');

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
    return { name: error.name, code: error.code, path: error.path, message: error.message };
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
          "module.exports = { core: require('./index.js'), standalone: require('./standalone.js') };",
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

// The same schema, compiled in process for the inline kernel.
const inlineOf = (schema) => {
  const { define } = standalone.inline(errors, types, layouts);
  const plan = schema[PLAN];
  const settings = schema[SETTINGS];
  const own = codecOptions(plan, settings, false);
  const checking = codecOptions(plan, settings, true);
  const spec = {
    name: schema.name,
    id: schema.id,
    canonical: schema.toString(),
    kind: plan.kind,
    keys: schema.keys,
    layout: schema.layout,
    interned: own.interned,
    validate: own.options.validate,
    codec: codegen.build(own.target, own.options),
    checker: codegen.build(checking.target, checking.options),
  };
  if (schema.layout === 'flat' || schema.layout === 'columns') spec.record = plan.item;
  return define(spec);
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
      outcome(() => copy.check(bad)),
      outcome(() => reference.check(bad)),
      label,
    );
  }
  assert.deepStrictEqual(
    outcome(() => copy.check(value)),
    outcome(() => reference.check(value)),
    label,
  );
};

test('Standalone: modules of both runtimes agree with the schemas on the vectors', async () => {
  const context = await restricted();
  assert.strictEqual(context.protoarray.core.Schema.from({ a: 'number' }).backend, 'closures');
  for (const vector of VECTORS) {
    const reference = Schema.from(vector.definition, vector.options);
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
    const { definition, value } = generate(seed);
    for (const options of [{}, { validate: 'both', sparse: true }, { intern: true }]) {
      const reference = Schema.from(definition, options);
      const label = `seed ${seed} ${JSON.stringify(options)}`;
      for (const runtime of ['import', 'inline']) {
        agree(run(standalone.toSource(reference, { runtime }), context), reference, value, label);
      }
      agree(inlineOf(reference), reference, value, label);
    }
    for (const layout of ['flat', 'columns']) {
      const reference = Schema.from({ array: definition }, { layout });
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
  const Address = new Schema('Address', { city: 'string', zip: '?string' });
  const Tag = Schema.from({ union: [{ k: { enum: ['a'] }, n: 'integer' }], discriminator: 'k' });
  const User = new Schema(
    'User',
    {
      id: 'integer',
      name: 'string',
      home: Address,
      'work?': 'Address',
      'boss?': 'User',
      tags: { array: Tag },
      calc: (user) => user.id,
      at: { type: 'integer', default: 0 },
    },
    { schemas: { Address }, validate: 'both', stringify: 'builder' },
  );
  const value = {
    id: 1,
    name: 'A',
    home: { city: 'K' },
    work: { city: 'L', zip: '1' },
    boss: { id: 2, name: 'B', home: { city: 'M' }, tags: [] },
    tags: [{ k: 'a', n: 3 }],
  };
  for (const runtime of ['import', 'inline']) {
    const source = standalone.toSource({ User, Address }, { runtime });
    const { User: copy, Address: address } = run(source, context);
    agree(copy, User, value, runtime);
    agree(address, Address, { city: 'K' }, runtime);
    assert.deepStrictEqual(plain(copy.keys), plain(User.keys));
  }
  // A module checks the definition it was generated from.
  const { User: copy } = run(standalone.toSource({ User }), context);
  assert.strictEqual(copy.list.backend, 'closures');
  assert.deepStrictEqual(
    plain(copy.list.decode([User.encode(value)])),
    plain(User.list.decode([User.encode(value)])),
  );
});

test('Standalone: an import module runs in this process too', () => {
  const Address = new Schema('Address', { city: 'string' });
  const User = new Schema('User', { home: Address, 'boss?': 'User', n: 'integer' });
  const module = { exports: {} };
  const load = vm.runInThisContext(
    `(function (module, require) {${standalone.toSource({ User })}\n})`,
  );
  load(module, (id) =>
    require(id === '@alexify/protoarray' ? '../../index.js' : '../../standalone.js'),
  );
  const copy = module.exports.User;
  const value = { home: { city: 'K' }, boss: { home: { city: 'L' }, n: 2 }, n: 1 };
  assert.ok(copy instanceof Schema);
  assert.deepStrictEqual(copy.decode(copy.encode(value)), User.decode(User.encode(value)));
  assert.strictEqual(
    copy.check({ ...value, boss: { home: { city: 1 }, n: 2 } }).path,
    'boss.home.city',
  );
});

test('Standalone: the inline kernel', () => {
  const { define, slot } = standalone.inline(errors, types, layouts);
  const target = { codec: 'codec', checker: 'checker' };
  const reference = slot(() => target);
  assert.strictEqual(reference.codec, 'codec');
  assert.strictEqual(reference.checker, 'checker');
  // An error that is not the data's passes through check.
  const Plain = Schema.from({ a: 'json' });
  const copy = inlineOf(Plain);
  const broken = {
    get a() {
      throw new RangeError('not a depth problem');
    },
  };
  assert.throws(() => copy.check(broken), RangeError);
  assert.strictEqual(typeof define, 'function');
});

test('Standalone: the compiled option', () => {
  const A = Schema.from({ a: 'integer' });
  const codec = A[CODEC];
  const compiled = { canonical: A.toString(), id: 'custom', codec };
  const B = Schema.from({ a: 'integer' }, { compiled });
  assert.strictEqual(B.backend, 'standalone');
  assert.strictEqual(B.id, 'custom');
  assert.deepStrictEqual(B.encode({ a: 1 }), [1]);
  assert.strictEqual(B.check({ a: 'x' }).path, 'a');
  assert.strictEqual(Schema.from({ a: 'integer' }, { compiled: { ...compiled, id: 1 } }).id, A.id);
  assert.throws(
    () => Schema.from({ a: 'string' }, { compiled }),
    (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.strictEqual(error.code, 'ERR_COMPILED_MISMATCH');
      assert.strictEqual(
        error.message,
        'The compiled codec is of another definition: generate it again',
      );
      return true;
    },
  );
  assert.throws(() => Schema.from({ a: 'integer' }, { compiled, codegen: true }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'A compiled codec replaces code generation',
  });
  for (const bad of [
    {},
    { canonical: 1, codec },
    { canonical: 'x', codec: {} },
    { canonical: 'x' },
  ]) {
    assert.throws(() => Schema.from({ a: 'integer' }, { compiled: bad }), {
      code: 'ERR_INVALID_OPTIONS',
    });
  }
});

test('Standalone: what toSource refuses', () => {
  const W = Schema.from({ a: 'integer' });
  const R = Schema.resolve(W, Schema.from({ a: 'number' }));
  assert.throws(() => standalone.toSource(R), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'A resolved schema is built at runtime: write its writer and reader instead',
  });
  const foreign = { [Symbol.for('alexify.metaschema.brand')]: 'Schema' };
  require('../../src/plan.js').HOOKS.foreign = () => W;
  try {
    assert.throws(() => standalone.toSource(Schema.from(foreign)), {
      message: 'A schema of a metaschema Schema: write the one fromMetaschema builds instead',
    });
  } finally {
    require('../../src/plan.js').HOOKS.foreign = null;
  }
  for (const options of [1, { other: 1 }, { runtime: 'remote' }, { format: 'umd' }]) {
    assert.throws(() => standalone.toSource(W, options), { code: 'ERR_INVALID_OPTIONS' });
  }
  assert.throws(() => standalone.toSource({ 'not-a-name': W }), {
    code: 'ERR_INVALID_OPTIONS',
    message: '"not-a-name" is not a name a module can export',
  });
  assert.throws(() => standalone.toSource({ A: 1 }), { code: 'ERR_SCHEMA_EXPECTED' });
  assert.throws(() => standalone.toSource(null), { code: 'ERR_SCHEMA_EXPECTED' });
  assert.strictEqual(standalone.toSource(W, null), standalone.toSource(W));
  // An undefined in a definition is written as one.
  const Loose = Schema.from({ a: { type: 'number', default: undefined, required: false } });
  assert.match(standalone.toSource(Loose), /"default":undefined/);
});

test('Standalone: ES modules import and export by name', () => {
  const dir = path.join(ROOT, 'tests', '.generated');
  fs.mkdirSync(dir, { recursive: true });
  const User = new Schema('User', { id: 'integer', name: 'string' });
  const Note = Schema.from({ text: 'string' });
  for (const runtime of ['import', 'inline']) {
    const file = path.join(dir, `module-${runtime}.mjs`);
    fs.writeFileSync(file, standalone.toSource({ User, Note }, { runtime, format: 'esm' }));
    const single = path.join(dir, `single-${runtime}.mjs`);
    fs.writeFileSync(single, standalone.toSource(Note, { runtime, format: 'esm' }));
    const script = [
      `import { User, Note } from ${JSON.stringify(`./${path.basename(file)}`)};`,
      `import Single from ${JSON.stringify(`./${path.basename(single)}`)};`,
      'process.stdout.write(JSON.stringify([User.encode({ id: 1, name: "a" }), Note.stringify({ text: "x" }), Single.decode(["y"])]));',
    ].join('\n');
    const entry = path.join(dir, `entry-${runtime}.mjs`);
    fs.writeFileSync(entry, script);
    const output = execFileSync(process.execPath, [entry], { cwd: ROOT, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(output), [[1, 'a'], '["x"]', { text: 'y' }], runtime);
  }
});

test('Standalone: register() adds schema.toSource()', () => {
  const S = Schema.from({ a: 'integer' });
  assert.strictEqual(S.toSource, undefined);
  standalone.register();
  standalone.register();
  assert.strictEqual(
    S.toSource({ runtime: 'inline' }),
    standalone.toSource(S, { runtime: 'inline' }),
  );
  assert.deepStrictEqual(Object.keys(Schema.prototype), []);
});
