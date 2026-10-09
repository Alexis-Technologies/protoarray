const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

const listFiles = (dir) => {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
};

// protoarray runs unchanged in Node.js and browsers, so nothing under src/
// may depend on a Node builtin. A platform-specific module would go in a
// runtime twin mapped through the package.json `browser` field.
test('Platform: nothing in src/ requires a Node builtin', () => {
  const offenders = [];
  for (const file of listFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    if (/require\(\s*['"]node:/.test(source)) offenders.push(path.relative(SRC, file));
  }
  assert.deepStrictEqual(offenders, []);
});

// Source text is compiled in exactly one place, behind a probe with a
// closures fallback; nothing else may reach for `Function` or `eval`.
test('Platform: code generation lives in src/codegen.js only', () => {
  const offenders = [];
  for (const file of listFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const compiles = /\bFunction\s*\(|\beval\s*\(/.test(source);
    if (compiles && path.basename(file) !== 'codegen.js') offenders.push(path.relative(SRC, file));
  }
  assert.deepStrictEqual(offenders, []);
  const codegen = fs.readFileSync(path.join(SRC, 'codegen.js'), 'utf8');
  assert.strictEqual(codegen.match(/new Function\(/g).length, 2);
});

test('Platform: browser.js exports the same names as index.js', () => {
  const node = require(path.join(ROOT, 'index.js'));
  const browser = require(path.join(ROOT, 'browser.js'));
  assert.deepStrictEqual(Object.keys(browser), Object.keys(node));
});
