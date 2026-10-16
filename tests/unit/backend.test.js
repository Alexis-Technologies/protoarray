const { test } = require('node:test');
const assert = require('node:assert');

// The probe runs once when the module loads, so the stub must be in place
// before the first require; each test file is its own process.
const RealFunction = globalThis.Function;
globalThis.Function = function Blocked() {
  throw new EvalError('Code generation from strings disallowed for this context');
};
let protoarray;
try {
  protoarray = require('../../index.js');
} finally {
  globalThis.Function = RealFunction;
}
const { Schema } = protoarray;
// metaschema is loaded once the stub is gone: only protoarray's probe is under
// test. The helpers reach the protoarray loaded above, from the module cache.
const { define } = require('../support/schema.js');

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
