const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '../..');

// Loads both entry points the way a consumer's bundler would, minified and
// not, and calls the API through the result: the shipped files must work
// after bundling, not only when required from source.
const bundle = async (entry, options) => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    logLevel: 'silent',
    ...options,
  });
  return result.outputFiles[0].text;
};

// A browser realm has btoa and atob; a bare vm context has neither. The
// context comes back with the bundle, so a test can build values in its realm.
const loadBrowser = async (minify, globals = { btoa, atob }, prelude = '') => {
  const code = await bundle('browser.js', {
    platform: 'browser',
    format: 'iife',
    globalName: 'protoarray',
    minify,
  });
  const context = vm.createContext(globals);
  vm.runInContext(prelude + code, context);
  return context;
};

const loadNode = async (minify) => {
  const code = await bundle('index.js', { platform: 'node', format: 'cjs', minify });
  const module = { exports: {} };
  const load = vm.compileFunction(code, ['module', 'exports', 'require']);
  load(module, module.exports, require);
  return module.exports;
};

// A schema round trip through both backends, compared as JSON because the
// browser bundle runs in another realm with its own Array and Object.
const checkBundle = ({ Schema, encode, decode, stringify, parse }) => {
  for (const fn of [encode, decode, stringify, parse]) assert.strictEqual(typeof fn, 'function');
  for (const codegen of [true, false]) {
    const schema = Schema.from(
      { name: 'string', age: '?number', 'tags?': { array: 'string' }, 'home?': { city: 'string' } },
      { codegen },
    );
    assert.strictEqual(schema.backend, codegen ? 'codegen' : 'closures');
    const wire = schema.encode({ name: 'Alex', age: 27, tags: ['a'], home: { city: 'Kyiv' } });
    assert.strictEqual(JSON.stringify(wire), '["Alex",27,["a"],["Kyiv"]]');
    const decoded = schema.decode(wire);
    assert.strictEqual(
      JSON.stringify(decoded),
      '{"name":"Alex","age":27,"tags":["a"],"home":{"city":"Kyiv"}}',
    );
    assert.strictEqual(stringify(schema, decoded), '["Alex",27,["a"],["Kyiv"]]');
    assert.strictEqual(
      JSON.stringify(parse(schema, '["Bob"]')),
      '{"name":"Bob","age":null,"tags":null,"home":null}',
    );
    assert.throws(() => decode(schema, [1]), { code: 'type', path: 'name' });
    const Blob = Schema.from({ data: 'bytes' }, { codegen });
    const blob = Blob.encode({ data: new Uint8Array([137, 80, 78, 71, 0, 255]) });
    assert.strictEqual(JSON.stringify(blob), '["iVBORwD/"]');
    assert.deepStrictEqual(Array.from(Blob.decode(blob).data), [137, 80, 78, 71, 0, 255]);
    const Packet = Schema.from(
      { union: [{ k: { enum: ['a'] }, v: 'number' }, { k: { enum: ['b'] } }], discriminator: 'k' },
      { codegen },
    );
    assert.strictEqual(JSON.stringify(Packet.encode({ k: 'b' })), '[1]');
    assert.strictEqual(JSON.stringify(Packet.decode([0, 5])), '{"k":"a","v":5}');
    assert.strictEqual(Packet.check({ k: 'a', v: 'x' }).code, 'type');
    assert.strictEqual(Packet.check({ k: 'a', v: 1 }), null);
    const wide = {};
    for (let i = 0; i < 40; i++) wide[`f${i}`] = '?number';
    const Wide = Schema.from(wide, { codegen, sparse: true });
    assert.strictEqual(JSON.stringify(Wide.encode({ f35: 1 })), '[0,16,1]');
    assert.strictEqual(Wide.decode([0, 16, 1]).f35, 1);
    const Strict = Schema.from({ n: 'number' }, { codegen, validate: 'both' });
    assert.throws(() => Strict.encode({ n: 'x' }), { code: 'type', path: 'n' });
  }
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: browser entry, ${label}`, async () => {
    checkBundle((await loadBrowser(minify)).protoarray);
  });
  test(`Bundle: node entry, ${label}`, async () => checkBundle(await loadNode(minify)));
}

// The browser runtime looks base64 up when it is used, not when it loads.
test('Bundle: the browser entry loads in a realm without btoa', async () => {
  // Without the platform's own base64 either, so the btoa branch is the one that runs.
  const prelude = 'delete Uint8Array.prototype.toBase64; delete Uint8Array.fromBase64;';
  const context = await loadBrowser(true, {}, prelude);
  const { Schema } = context.protoarray;
  assert.strictEqual(JSON.stringify(Schema.from({ a: 'number' }).encode({ a: 1 })), '[1]');
  const Blob = Schema.from({ data: 'bytes' });
  const bytes = vm.runInContext('new Uint8Array(1)', context);
  assert.throws(() => Blob.encode({ data: bytes }), { name: 'ReferenceError' });
  assert.throws(() => Blob.encode({ data: new Uint8Array(1) }), { name: 'ReferenceError' });
});
