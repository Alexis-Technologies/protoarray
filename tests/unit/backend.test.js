const { test } = require('node:test');
const assert = require('node:assert');

// The probe runs once, when the first schema that may use generated code is
// built; each test file is its own process. The stub counts what tries to
// compile source text, and refuses it, as a strict CSP does.
const RealFunction = globalThis.Function;
let attempts = 0;
globalThis.Function = function Blocked() {
  attempts += 1;
  throw new EvalError('Code generation from strings disallowed for this context');
};
let protoarray;
const snapshot = {
  format: 1,
  root: 'T',
  entities: { T: { fields: { name: { type: 'string', required: true } } } },
};
const CODEC = Symbol.for('alexify.protoarray.codec');
const built = {};
try {
  protoarray = require('../../index.js');
  built.loaded = attempts;
  const Closures = new protoarray.Schema(snapshot, { codegen: false });
  built.closures = attempts;
  const compiled = { canonical: Closures.toString(), codec: Closures[CODEC] };
  built.standalone = new protoarray.Schema(snapshot, { compiled }).backend;
  built.compiled = attempts;
  built.automatic = new protoarray.Schema(snapshot).backend;
  built.probed = attempts;
  built.again = new protoarray.Schema(snapshot).backend;
  built.cached = attempts;
} finally {
  globalThis.Function = RealFunction;
}
const { Schema } = protoarray;
// metaschema is loaded once the stub is gone: only protoarray's probe is under
// test. The helpers reach the protoarray loaded above, from the module cache.
const { define } = require('../support/schema.js');

test('Backend: nothing tries to compile source text until a schema may', () => {
  assert.strictEqual(built.loaded, 0);
  assert.strictEqual(built.closures, 0);
  assert.strictEqual(built.standalone, 'standalone');
  assert.strictEqual(built.compiled, 0);
  // The first automatic schema probes, once for the process.
  assert.strictEqual(built.automatic, 'closures');
  assert.strictEqual(built.probed, 1);
  assert.strictEqual(built.again, 'closures');
  assert.strictEqual(built.cached, 1);
});

test('Backend: without new Function the closures backend is picked', () => {
  const schema = define({ name: 'string', age: '?number' });
  assert.ok(schema instanceof Schema);
  assert.strictEqual(schema.backend, 'closures');
  assert.deepStrictEqual(schema.encode({ name: 'Alex' }), ['Alex']);
  assert.deepStrictEqual(schema.decode(['Alex']), { name: 'Alex', age: null });
  assert.strictEqual(schema.list.backend, 'closures');
});

test('Backend: asking for codegen where it is unavailable throws', () => {
  assert.throws(() => define({ a: 'string' }, { codegen: true }), {
    code: 'ERR_CODEGEN_UNAVAILABLE',
    message: 'Code generation is not available in this runtime: pass { codegen: false }',
  });
  assert.strictEqual(define({ a: 'string' }, { codegen: false }).backend, 'closures');
});
