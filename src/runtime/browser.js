// Browser twin of ./node.js, mapped in by the package.json `browser` field:
// the same interface over Uint8Array's own base64 where the platform has it,
// btoa and atob elsewhere. Both are looked up on each call, not at load, so
// the module loads in any realm.

// Characters per String.fromCharCode call, below any engine's argument limit.
const CHUNK = 0x8000;

const toBase64 = (bytes) => {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const decode = (text) => {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(text);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// The bytes of canonical base64, or null, as in ./node.js: both decoders here
// forgive whitespace and missing padding, so the text must encode back to
// itself. A missing atob is the platform's problem, not the data's.
const fromBase64 = (text) => {
  let bytes;
  try {
    bytes = decode(text);
  } catch (error) {
    if (error instanceof ReferenceError) throw error;
    return null;
  }
  return toBase64(bytes) === text ? bytes : null;
};

module.exports = { toBase64, fromBase64 };
