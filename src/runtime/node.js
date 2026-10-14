// Base64 for the bytes type through Node's Buffer. The browser twin
// (./browser.js) has the same interface and is mapped in by the package.json
// `browser` field; this is the one file under src/ that may require a builtin.

const { Buffer } = require('node:buffer');

const toBase64 = (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

// A fresh Uint8Array of its own, never a view of Buffer's shared pool.
const fromBase64 = (text) => {
  const bytes = new Uint8Array(Buffer.byteLength(text, 'base64'));
  Buffer.from(bytes.buffer).write(text, 'base64');
  return bytes;
};

module.exports = { toBase64, fromBase64 };
