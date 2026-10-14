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
// may depend on a Node builtin, except the Node half of the runtime twin: the
// package.json `browser` field maps it to its browser half.
test('Platform: nothing in src/ but the Node runtime requires a Node builtin', () => {
  const offenders = [];
  for (const file of listFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    if (/require\(\s*['"]node:/.test(source)) offenders.push(path.relative(SRC, file));
  }
  assert.deepStrictEqual(offenders, [path.join('runtime', 'node.js')]);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.browser['./src/runtime/node.js'], './src/runtime/browser.js');
  assert.ok(!fs.readFileSync(path.join(SRC, 'index.js'), 'utf8').includes('runtime'));
});

const RUNTIME = {
  node: require(path.join(SRC, 'runtime/node.js')),
  browser: require(path.join(SRC, 'runtime/browser.js')),
};

// A realm without atob fails on bytes, loudly, instead of reading them as invalid.
test('Platform: the browser runtime does not hide a missing atob', () => {
  const { atob } = globalThis;
  try {
    delete globalThis.atob;
    assert.throws(() => RUNTIME.browser.fromBase64('AQI='), ReferenceError);
  } finally {
    globalThis.atob = atob;
  }
});

// The two halves of the twin must be indistinguishable, the browser one with
// and without the platform's own Uint8Array base64.
test('Platform: the runtime twins agree on base64', () => {
  assert.deepStrictEqual(Object.keys(RUNTIME.browser), Object.keys(RUNTIME.node));
  const lengths = [0, 1, 2, 3, 4, 5, 255, 256, 32767, 32768, 32769, 70000];
  const samples = lengths.map((length) =>
    Uint8Array.from({ length }, (_, i) => (i * 7919 + length) % 256),
  );
  const check = () => {
    for (const bytes of samples) {
      const text = RUNTIME.node.toBase64(bytes);
      assert.strictEqual(text, Buffer.from(bytes).toString('base64'));
      assert.strictEqual(RUNTIME.browser.toBase64(bytes), text);
      for (const twin of [RUNTIME.node, RUNTIME.browser]) {
        const back = twin.fromBase64(text);
        assert.strictEqual(Object.getPrototypeOf(back), Uint8Array.prototype);
        assert.strictEqual(back.byteOffset, 0);
        assert.strictEqual(back.buffer.byteLength, bytes.length);
        assert.deepStrictEqual(back, bytes);
      }
    }
    const view = samples[11].subarray(100, 200);
    assert.strictEqual(RUNTIME.browser.toBase64(view), RUNTIME.node.toBase64(view));
    // Only canonical base64 decodes: what toBase64 would write, padding and all.
    for (const text of [
      'AQI',
      'AQI==',
      'A===',
      'AB==',
      'AQI= ',
      ' AQI=',
      'AQ\nI=',
      '*AQI',
      'AQ=A',
      'é',
    ]) {
      assert.strictEqual(RUNTIME.node.fromBase64(text), null, text);
      assert.strictEqual(RUNTIME.browser.fromBase64(text), null, text);
    }
  };
  check();
  const proto = Uint8Array.prototype;
  const native = { toBase64: proto.toBase64, fromBase64: Uint8Array.fromBase64 };
  try {
    // A stand-in for the platform's own methods, where Node does not have them yet.
    proto.toBase64 = function toBase64() {
      return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64');
    };
    Uint8Array.fromBase64 = (text) => {
      // Like the platform's own: forgiving about whitespace, throwing on the rest.
      const clean = text.replace(/\s/g, '');
      if (/[^A-Za-z0-9+/=]/.test(clean)) throw new SyntaxError('not base64');
      return new Uint8Array(Buffer.from(clean, 'base64'));
    };
    check();
  } finally {
    if (native.toBase64 === undefined) delete proto.toBase64;
    else proto.toBase64 = native.toBase64;
    if (native.fromBase64 === undefined) delete Uint8Array.fromBase64;
    else Uint8Array.fromBase64 = native.fromBase64;
  }
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
