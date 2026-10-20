// The byte writer and reader of the binary wire (../binary.js): a growable
// Uint8Array behind a DataView, little-endian; LEB128 varints exact over the
// safe integers (zigzag for the signed ones, the sign in the low bit, so no
// double past 2^53 is ever formed); a string behind its doubled length, whose
// low bit says its form, UTF-8 or UTF-16LE: a short one is written and read
// by a loop, a long one as UTF-16 through the runtime twin, the engine's own
// form copied rather than transcoded. One writer and one reader per schema,
// reset on each message; a schema reached through a slot writes and reads
// through the root's.
//
// The reader checks nothing on its own: the backends check the bounds before
// a fixed-size read and after a varint, and a string or a byte array whose
// length runs past the message reads as undefined.
//
// The module is a closed function of the runtime twin, run once: nothing in
// it reaches outside, so a standalone module can embed its source.

const kernel = (runtime) => {
  const { readUtf8, writeUtf16, readUtf16 } = runtime;

  // A string of up to this many characters is written by a loop as UTF-8 (at
  // three bytes a character its doubled length still fits one varint byte);
  // a longer one as UTF-16 through the runtime. Measured on Node 24: the loop
  // wins up to about 24 characters, the runtime's call past them.
  const SHORT = 21;
  // UTF-8 of up to this many bytes is read by a loop a character at a time;
  // up to MEDIUM bytes that begin with a non-ASCII byte by a loop into the
  // character codes; anything else through the runtime, whose call costs
  // about as much as the loop over 8 ASCII bytes or 64 bytes of two-byte
  // characters.
  const SMALL = 8;
  const MEDIUM = 64;

  // The string of the UTF-8 between two positions, its character codes joined
  // at once: for short text, cheaper than a call into the runtime. The bytes
  // are taken as well-formed UTF-8, which the writer always produces.
  const decodeUtf8 = (bytes, start, end) => {
    const codes = [];
    let i = start;
    while (i < end) {
      const b = bytes[i++];
      if (b < 0x80) codes.push(b);
      else if (b < 0xe0) codes.push(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
      else if (b < 0xf0) {
        codes.push(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      } else {
        const c =
          ((b & 0x07) << 18) |
          ((bytes[i++] & 0x3f) << 12) |
          ((bytes[i++] & 0x3f) << 6) |
          (bytes[i++] & 0x3f);
        codes.push(0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff));
      }
    }
    return String.fromCharCode.apply(null, codes);
  };

  class Writer {
    constructor() {
      this.bytes = new Uint8Array(1024);
      this.view = new DataView(this.bytes.buffer);
      this.pos = 0;
    }

    reset() {
      this.pos = 0;
    }

    // Room for n more bytes; the buffer and its view are replaced when it
    // grows, so a caller reads them again after any write.
    ensure(n) {
      if (this.pos + n <= this.bytes.length) return;
      let size = this.bytes.length * 2;
      while (size < this.pos + n) size *= 2;
      const bytes = new Uint8Array(size);
      bytes.set(this.bytes);
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer);
    }

    u8(v) {
      this.ensure(1);
      this.bytes[this.pos++] = v;
    }

    f64(v) {
      this.ensure(8);
      this.view.setFloat64(this.pos, v, true);
      this.pos += 8;
    }

    // Unsigned LEB128 of an integer up to 2^53: bit operations while it fits
    // 31 bits, arithmetic above.
    uvar(u) {
      this.ensure(8);
      const bytes = this.bytes;
      let pos = this.pos;
      while (u >= 0x80) {
        if (u < 0x80000000) {
          bytes[pos++] = (u & 0x7f) | 0x80;
          u >>>= 7;
        } else {
          bytes[pos++] = (u % 0x80) | 0x80;
          u = Math.floor(u / 0x80);
        }
      }
      bytes[pos++] = u;
      this.pos = pos;
    }

    // Zigzag LEB128 (the sign in the low bit, the magnitude above it), written
    // from the sign and the magnitude without forming 2n, which a double past
    // 2^52 would round: exact over the safe integers. The low six bits of the
    // magnitude are exact for any integer (ToInt32 keeps them); the rest is
    // shifted by arithmetic once it leaves 31 bits.
    svar(n) {
      this.ensure(9);
      const bytes = this.bytes;
      let pos = this.pos;
      let s = 0;
      let m = n;
      if (n < 0) {
        s = 1;
        m = -n - 1;
      }
      if (m < 0x40) {
        bytes[pos++] = (m << 1) | s;
        this.pos = pos;
        return;
      }
      bytes[pos++] = ((m & 0x3f) << 1) | s | 0x80;
      m = m < 0x80000000 ? m >>> 6 : Math.floor(m / 0x40);
      while (m >= 0x80) {
        if (m < 0x80000000) {
          bytes[pos++] = (m & 0x7f) | 0x80;
          m >>>= 7;
        } else {
          bytes[pos++] = (m % 0x80) | 0x80;
          m = Math.floor(m / 0x80);
        }
      }
      bytes[pos++] = m;
      this.pos = pos;
    }

    // The words of a flags mask past 31 names: `count` varints, a lone number
    // being the first word with the rest clear.
    words(mask, count) {
      if (typeof mask === 'number') {
        this.uvar(mask);
        for (let i = 1; i < count; i++) this.uvar(0);
        return;
      }
      for (let i = 0; i < count; i++) this.uvar(i < mask.length ? mask[i] : 0);
    }

    // A short string is written a character at a time as UTF-8, the path
    // every binary codec in JavaScript has, unless it holds a lone surrogate,
    // which UTF-8 has no form for: then as UTF-16 like a long one, so every
    // string comes back as it was. A long one goes through the runtime as
    // UTF-16, behind its doubled byte length with the form bit set.
    string(s) {
      const length = s.length;
      if (length <= SHORT) {
        this.ensure(1 + length * 3);
        const bytes = this.bytes;
        const start = this.pos + 1;
        let pos = start;
        for (let i = 0; i < length; i++) {
          let c = s.charCodeAt(i);
          if (c < 0x80) {
            bytes[pos++] = c;
            continue;
          }
          if (c < 0x800) {
            bytes[pos++] = 0xc0 | (c >> 6);
            bytes[pos++] = 0x80 | (c & 0x3f);
            continue;
          }
          if (c >= 0xd800 && c < 0xe000) {
            const d = i + 1 < length ? s.charCodeAt(i + 1) : 0;
            if (c >= 0xdc00 || (d & 0xfc00) !== 0xdc00) {
              this.utf16(s, start);
              return;
            }
            i++;
            c = 0x10000 + ((c & 0x3ff) << 10) + (d & 0x3ff);
            bytes[pos++] = 0xf0 | (c >> 18);
            bytes[pos++] = 0x80 | ((c >> 12) & 0x3f);
            bytes[pos++] = 0x80 | ((c >> 6) & 0x3f);
            bytes[pos++] = 0x80 | (c & 0x3f);
            continue;
          }
          bytes[pos++] = 0xe0 | (c >> 12);
          bytes[pos++] = 0x80 | ((c >> 6) & 0x3f);
          bytes[pos++] = 0x80 | (c & 0x3f);
        }
        bytes[this.pos] = (pos - start) << 1;
        this.pos = pos;
        return;
      }
      const size = length * 2;
      this.uvar(size * 2 + 1);
      this.ensure(size);
      writeUtf16(this.bytes, s, this.pos);
      this.pos += size;
    }

    // A short string as UTF-16, at `start`, its length byte before it.
    utf16(s, start) {
      const size = s.length * 2;
      writeUtf16(this.bytes, s, start);
      this.bytes[start - 1] = (size << 1) | 1;
      this.pos = start + size;
    }

    raw(bytes) {
      this.uvar(bytes.length);
      this.ensure(bytes.length);
      this.bytes.set(bytes, this.pos);
      this.pos += bytes.length;
    }

    // A presence bitmap of n bits, cleared; returns where it starts, for mark.
    bitmap(n) {
      const size = (n + 7) >> 3;
      this.ensure(size);
      const start = this.pos;
      this.bytes.fill(0, start, start + size);
      this.pos += size;
      return start;
    }

    mark(start, i) {
      this.bytes[start + (i >> 3)] |= 1 << (i & 7);
    }

    // A copy: the buffer is reused.
    finish() {
      return this.bytes.slice(0, this.pos);
    }
  }

  // Reset on each message; the view is made only for a codec that reads
  // numbers, so a message without them never pays for one.
  class Reader {
    constructor() {
      this.bytes = null;
      this.pos = 0;
      this.end = 0;
      this.view = null;
    }

    reset(bytes, numbers) {
      this.bytes = bytes;
      this.pos = 0;
      this.end = bytes.length;
      this.view = numbers ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
      return this;
    }

    u8() {
      return this.bytes[this.pos++];
    }

    f64() {
      const v = this.view.getFloat64(this.pos, true);
      this.pos += 8;
      return v;
    }

    // A varint truncated by the message ends on an undefined byte: the loop
    // stops and the position runs past the end, which the caller checks.
    uvar() {
      const bytes = this.bytes;
      let pos = this.pos;
      let b = bytes[pos++];
      let u = b & 0x7f;
      let shift = 7;
      while (b >= 0x80) {
        b = bytes[pos++];
        u = shift < 28 ? u | ((b & 0x7f) << shift) : u + (b & 0x7f) * 2 ** shift;
        shift += 7;
      }
      this.pos = pos;
      return u;
    }

    // The inverse of Writer.svar: the sign from the first byte, the magnitude
    // assembled without the zigzag value itself.
    svar() {
      const bytes = this.bytes;
      let pos = this.pos;
      let b = bytes[pos++];
      const s = b & 1;
      let m = (b >> 1) & 0x3f;
      let shift = 6;
      while (b >= 0x80) {
        b = bytes[pos++];
        m = shift < 25 ? m | ((b & 0x7f) << shift) : m + (b & 0x7f) * 2 ** shift;
        shift += 7;
      }
      this.pos = pos;
      return s === 1 ? -m - 1 : m;
    }

    words(count) {
      const out = new Array(count);
      for (let i = 0; i < count; i++) out[i] = this.uvar();
      return out;
    }

    // Undefined when the length runs past the message. A byte past the end
    // reads as 0, so a truncated length still ends past the message.
    string() {
      const bytes = this.bytes;
      let pos = this.pos;
      let v = bytes[pos] | 0;
      if (v < 0x80) pos++;
      else {
        v = this.uvar();
        pos = this.pos;
      }
      const form = v & 1;
      const n = (v - form) / 2;
      const end = pos + n;
      if (end > this.end) return undefined;
      this.pos = end;
      if (form === 1) return readUtf16(bytes, pos, end);
      if (n <= SMALL) {
        let s = '';
        for (let i = pos; i < end; i++) {
          const c = bytes[i];
          if (c >= 0x80) return decodeUtf8(bytes, pos, end);
          s += String.fromCharCode(c);
        }
        return s;
      }
      if (n <= MEDIUM && bytes[pos] >= 0x80) return decodeUtf8(bytes, pos, end);
      return readUtf8(bytes, pos, end);
    }

    // A copy: a view would keep the whole message alive. Undefined when the
    // length runs past the message.
    raw() {
      const n = this.uvar();
      const end = this.pos + n;
      if (end > this.end) return undefined;
      const out = new Uint8Array(this.bytes.subarray(this.pos, end));
      this.pos = end;
      return out;
    }
  }

  return { Writer, Reader };
};

const wire = kernel(require('../runtime/node.js'));

module.exports = { Writer: wire.Writer, Reader: wire.Reader, kernel };
