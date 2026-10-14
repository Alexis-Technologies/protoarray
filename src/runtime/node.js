// Base64 for the bytes type through Node's Buffer. The browser twin
// (./browser.js) has the same interface and is mapped in by the package.json
// `browser` field; this is the one file under src/ that may require a builtin.

const { Buffer } = require('node:buffer');

const toBase64 = (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

// The bytes of canonical base64, or null: text that does not encode back to
// itself (bad characters, missing padding, stray bits) is not base64 here.
// The copy has a buffer of its own, never a view of Buffer's shared pool.
const fromBase64 = (text) => {
  const buffer = Buffer.from(text, 'base64');
  return buffer.toString('base64') === text ? new Uint8Array(buffer) : null;
};

module.exports = { toBase64, fromBase64 };
