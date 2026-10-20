// Browser twin of ./node.js, mapped in by the package.json `browser` field:
// the same interface over Uint8Array's own base64 where the platform has it,
// btoa and atob elsewhere, and over TextDecoder for the strings of the binary
// wire. Everything is looked up on each call, not at load, so the module loads
// in any realm.

const kernel = () => {
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

  // The strings of the binary wire. `start` has room for two bytes a
  // character; a write gives the bytes written. The decoder is made on first
  // use, not at load, and keeps a byte order mark, as Buffer's decoder does:
  // the two twins read the same bytes as the same string. The platform has
  // no UTF-16 encoder, and its decoder replaces a lone surrogate, which the
  // wire keeps: loops do both, the read in chunks below any engine's
  // argument limit.
  let decoder = null;
  const readUtf8 = (bytes, start, end) => {
    if (decoder === null) decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    return decoder.decode(bytes.subarray(start, end));
  };
  const writeUtf16 = (bytes, text, start) => {
    let pos = start;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      bytes[pos++] = c & 0xff;
      bytes[pos++] = c >> 8;
    }
    return pos - start;
  };
  const readUtf16 = (bytes, start, end) => {
    const units = new Array((end - start) >> 1);
    for (let i = 0, pos = start; pos < end; i++, pos += 2) {
      units[i] = bytes[pos] | (bytes[pos + 1] << 8);
    }
    let text = '';
    for (let i = 0; i < units.length; i += CHUNK) {
      text += String.fromCharCode.apply(null, units.slice(i, i + CHUNK));
    }
    return text;
  };

  return { toBase64, fromBase64, readUtf8, writeUtf16, readUtf16 };
};

const runtime = kernel();

module.exports = {
  toBase64: runtime.toBase64,
  fromBase64: runtime.fromBase64,
  readUtf8: runtime.readUtf8,
  writeUtf16: runtime.writeUtf16,
  readUtf16: runtime.readUtf16,
};
// The closed function itself, for standalone.js to embed; not enumerable, so
// the twins still show the same keys.
Object.defineProperty(module.exports, 'kernel', { value: kernel });
