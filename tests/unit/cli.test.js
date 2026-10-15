const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { Schema } = require('../../index.js');

const ROOT = path.join(__dirname, '../..');
const CLI = path.join(ROOT, 'bin', 'protoarray.js');

const cli = (...args) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });

// An inline module runs on its own: no require, no new Function.
const runInline = (source) => {
  const context = vm.createContext({ btoa, atob }, { codeGeneration: { strings: false } });
  const module = { exports: {} };
  vm.runInContext(`(function (module) {${source}\n})`, context)(module);
  return module.exports;
};

test('CLI: compile writes the module of the schemas a module exports', () => {
  const all = cli('compile', 'tests/fixtures/schemas.js', '--runtime', 'inline');
  assert.strictEqual(all.status, 0, all.stderr);
  const { Address, User } = runInline(all.stdout);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(Address.encode({ city: 'Kyiv' }))), ['Kyiv']);
  assert.strictEqual(
    User.stringify({ id: 1, name: 'A', home: { city: 'K' }, role: 'user' }),
    '[1,"A",["K"],null,1]',
  );
  assert.strictEqual(User.id, require('../fixtures/schemas.js').User.id);
  const only = cli('compile', 'tests/fixtures/schemas.js', '--only', 'Address', '--format', 'esm');
  assert.strictEqual(only.status, 0, only.stderr);
  assert.match(only.stdout, /^export \{ S0 as Address \};$/m);
  assert.match(only.stdout, /^import \{ Schema \} from '@alexify\/protoarray';$/m);
  assert.doesNotMatch(only.stdout, /User/);
});

test('CLI: --out, an ES module and a single schema', () => {
  const dir = path.join(ROOT, 'tests', '.generated');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'cli.js');
  const written = cli('compile', 'tests/fixtures/schemas.mjs', '--out', out, '--runtime', 'inline');
  assert.strictEqual(written.status, 0, written.stderr);
  assert.strictEqual(written.stdout, '');
  const single = runInline(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(single.stringify({ id: 1, at: new Date(2) }), '[1,2]');
  assert.strictEqual(single.toString(), Schema.from({ id: 'integer', at: 'date' }).toString());
});

test('CLI: what it refuses', () => {
  const usage = /^Usage: protoarray compile <module>/m;
  for (const args of [[], ['build', 'x.js'], ['compile'], ['compile', 'a.js', 'b.js']]) {
    const result = cli(...args);
    assert.strictEqual(result.status, 1, args.join(' '));
    assert.match(result.stderr, usage);
  }
  const unknown = cli('compile', 'tests/fixtures/schemas.js', '--fast');
  assert.strictEqual(unknown.status, 1);
  assert.match(unknown.stderr, /^Unknown or incomplete option --fast/);
  const incomplete = cli('compile', 'tests/fixtures/schemas.js', '--out');
  assert.match(incomplete.stderr, /^Unknown or incomplete option --out/);
  const missing = cli('compile', 'tests/fixtures/schemas.js', '--only', 'Nope');
  assert.strictEqual(missing.status, 1);
  assert.strictEqual(missing.stderr, 'The module exports no schema "Nope"\n');
  const empty = cli('compile', 'tests/fixtures/empty.js');
  assert.strictEqual(empty.stderr, 'The module exports no schema\n');
  const bad = cli('compile', 'tests/fixtures/schemas.js', '--runtime', 'remote');
  assert.strictEqual(bad.stderr, 'Invalid option "runtime"\n');
  const absent = cli('compile', 'tests/fixtures/absent.js');
  assert.strictEqual(absent.status, 1);
  assert.match(absent.stderr, /Cannot find module/);
});
