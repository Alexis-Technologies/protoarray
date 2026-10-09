const { test } = require('node:test');
const assert = require('node:assert');
const { encode, decode } = require('../../index.js');

test('Codec: encode is a placeholder until the format is implemented', () => {
  assert.throws(() => encode({}, { name: 'Alex', age: 27 }), {
    message: 'encode is not implemented yet',
  });
});

test('Codec: decode is a placeholder until the format is implemented', () => {
  assert.throws(() => decode({}, ['Alex', 27]), {
    message: 'decode is not implemented yet',
  });
});
