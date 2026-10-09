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

const loadBrowser = async (minify) => {
  const code = await bundle('browser.js', {
    platform: 'browser',
    format: 'iife',
    globalName: 'protoarray',
    minify,
  });
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return context.protoarray;
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
  }
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: browser entry, ${label}`, async () => checkBundle(await loadBrowser(minify)));
  test(`Bundle: node entry, ${label}`, async () => checkBundle(await loadNode(minify)));
}
