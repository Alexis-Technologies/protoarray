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

const checkBundle = ({ encode, decode }) => {
  assert.strictEqual(typeof encode, 'function');
  assert.strictEqual(typeof decode, 'function');
  assert.throws(() => encode({}, { name: 'Alex', age: 27 }), {
    message: 'encode is not implemented yet',
  });
  assert.throws(() => decode({}, ['Alex', 27]), { message: 'decode is not implemented yet' });
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: browser entry, ${label}`, async () => checkBundle(await loadBrowser(minify)));
  test(`Bundle: node entry, ${label}`, async () => checkBundle(await loadNode(minify)));
}
