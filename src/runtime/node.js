// Base64 for the bytes type, and the strings of the binary wire (UTF-16 both
// ways, UTF-8 read), through Node's Buffer. The browser twin (./browser.js) has the same
// interface and is mapped in by the package.json `browser` field; this is the
// one file under src/ that may require a builtin.

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

// Buffer's string methods take any Uint8Array as `this`, so the wire's
// buffers stay plain and nothing is wrapped per call. A write has room for two
// bytes a character and gives the bytes written; a read gives the string of
// the bytes between two positions.
const { utf8Slice, ucs2Write, ucs2Slice } = Buffer.prototype;

const readUtf8 = (bytes, start, end) => utf8Slice.call(bytes, start, end);
const writeUtf16 = (bytes, text, start) => ucs2Write.call(bytes, text, start);
const readUtf16 = (bytes, start, end) => ucs2Slice.call(bytes, start, end);

module.exports = { toBase64, fromBase64, readUtf8, writeUtf16, readUtf16 };
