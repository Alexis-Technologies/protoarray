const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

// index.d.ts is written by hand: every runtime export must be declared in it,
// and every declared value export must exist at runtime. `export type` and
// `export interface` have no runtime counterpart and are not compared.
const declaredValueExports = (dtsFile) => {
  const source = fs.readFileSync(path.join(ROOT, dtsFile), 'utf8');
  const pattern = /^export (?:declare )?(?:abstract )?(?:class|function|const|let|var) ([\w$]+)/gm;
  const names = new Set();
  for (const match of source.matchAll(pattern)) names.add(match[1]);
  return names;
};

const entryPoints = [
  ['index.js', 'index.d.ts'],
  ['browser.js', 'index.d.ts'],
];

for (const [runtimeFile, dtsFile] of entryPoints) {
  test(`Exports: ${runtimeFile} matches ${dtsFile}`, () => {
    const runtime = new Set(Object.keys(require(path.join(ROOT, runtimeFile))));
    const declared = declaredValueExports(dtsFile);
    const undeclared = [...runtime].filter((name) => !declared.has(name)).sort();
    const phantom = [...declared].filter((name) => !runtime.has(name)).sort();
    assert.deepStrictEqual(undeclared, [], `missing from ${dtsFile}`);
    assert.deepStrictEqual(phantom, [], `absent from ${runtimeFile} at runtime`);
  });
}

test('Exports: named imports work from ESM', () => {
  const names = [...declaredValueExports('index.d.ts')].sort();
  const source = [
    `import { ${names.join(', ')} } from '@alexify/protoarray';`,
    `const values = { ${names.join(', ')} };`,
    'const missing = Object.keys(values).filter((name) => values[name] === undefined);',
    'process.stdout.write(JSON.stringify(missing));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), []);
});
