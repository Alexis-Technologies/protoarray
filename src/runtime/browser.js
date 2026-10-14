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

const fromBase64 = (text) => {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(text);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

module.exports = { toBase64, fromBase64 };
