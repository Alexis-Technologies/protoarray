// The scalar type table: how each type travels (identity types go through as
// they are), how it is checked on the wire and how it is converted. Both
// backends read it, so they can never disagree on a type.

const { toBase64, fromBase64 } = require('./runtime/node.js');

const DIGITS = /^-?\d+$/;
// Standard base64 with padding (RFC 4648 §4).
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// Tags rather than instanceof: a value may come from another realm.
const TAG = Object.prototype.toString;

// A Date or a timestamp becomes epoch milliseconds; an invalid date has no
// JSON form and travels as null.
const ms = (value) => {
  const time = +value;
  return Number.isNaN(time) ? null : time;
};

// An object parsed from a literal has the hidden class a literal would have.
const literal = (keys, value) =>
  JSON.parse(`{${keys.map((key) => `${JSON.stringify(key)}:${value}`).join(',')}}`);

const isBytes = (v) => TAG.call(v) === '[object Uint8Array]';

const scalar = (type, rest) => ({ kind: 'scalar', type, expected: type, code: 'type', ...rest });

// `check` validates the wire form and `accept` the value given to encode;
// `pack`/`unpack` convert, and are null for identity types, which travel as
// they are. Without validation the wire is trusted, so `unpack` must be total:
// what has no wire form of the type stays as it is instead of throwing or
// reading a prototype.
const identity = (type) => {
  // oxlint-disable-next-line valid-typeof
  const check = type === 'json' ? null : (v) => typeof v === type;
  // NaN and the infinities have no JSON form: they would travel as null.
  const accept = type === 'number' ? Number.isFinite : check;
  return scalar(type, { check, accept, pack: null, unpack: null });
};

const SCALARS = Object.assign(Object.create(null), {
  string: () => identity('string'),
  number: () => identity('number'),
  boolean: () => identity('boolean'),
  json: () => identity('json'),
  date: () =>
    scalar('date', {
      check: (v) => typeof v === 'number',
      accept: (v) =>
        (typeof v === 'number' || TAG.call(v) === '[object Date]') && Number.isFinite(+v),
      pack: ms,
      unpack: (v) => (typeof v === 'number' ? new Date(v) : v),
    }),
  bytes: () =>
    scalar('bytes', {
      check: (v) => typeof v === 'string' && BASE64.test(v),
      accept: isBytes,
      pack: (v) => (isBytes(v) ? toBase64(v) : v),
      // The pattern guards the conversion too: Buffer reads invalid base64
      // leniently where atob throws, so neither of them ever sees it.
      unpack: (v) => (typeof v === 'string' && BASE64.test(v) ? fromBase64(v) : v),
    }),
  bigint: () =>
    scalar('bigint', {
      check: (v) => typeof v === 'string' && DIGITS.test(v),
      accept: (v) =>
        typeof v === 'bigint' ||
        Number.isSafeInteger(v) ||
        (typeof v === 'string' && DIGITS.test(v)),
      pack: (v) => String(v),
      unpack: (v) => {
        try {
          return BigInt(v);
        } catch {
          return v;
        }
      },
    }),
});

const enumeration = (values) => {
  const size = values.length;
  const dict = Object.create(null);
  for (let i = 0; i < size; i++) dict[values[i]] = i;
  const node = scalar('enum', {
    values,
    check: (v) => typeof v === 'number' && (v | 0) === v && v >= 0 && v < size,
    // The lookup coerces its key ('20' finds 20); validation wants the value itself.
    accept: (v) => dict[v] !== undefined && values[dict[v]] === v,
    pack: (v) => (dict[v] === undefined ? null : dict[v]),
    unpack: (v) => (typeof v === 'number' ? (values[v] ?? v) : v),
  });
  node.expected = values.join(', ');
  node.code = 'enum';
  return node;
};

// A number with `n` decimals travels as an integer, scaled by 10ⁿ: 19.99 is
// 1999 with two. Math.round rounds half up (1.005 * 100 is 100.49999…), and
// dividing the integer by 10ⁿ gives back the double nearest to the decimal.
const decimal = (n) => {
  const scale = 10 ** n;
  const node = scalar('number', {
    decimals: n,
    check: Number.isSafeInteger,
    accept: (v) => Number.isFinite(v) && Math.abs(v * scale) <= Number.MAX_SAFE_INTEGER,
    // + 0 turns -0 into 0, which is what JSON would write anyway.
    pack: (v) => (typeof v === 'number' ? Math.round(v * scale) + 0 : v),
    unpack: (v) => (typeof v === 'number' ? v / scale : v),
  });
  node.expected = `number(${n})`;
  return node;
};

// A word of a bitmask: 31 bits, since bit 31 would make it negative.
const WORD = 31;

const isWord = (v) => typeof v === 'number' && (v | 0) === v && v >= 0;

// Up to 31 names travel as one integer. More take an array of 31-bit words,
// written as one integer while only the first word has bits set, so a
// decoder reads either form and ignores the bits it has no name for.
const flags = (names) => {
  const size = names.length;
  const template = literal(names, 'false');
  return scalar('flags', {
    names,
    check: (v) => isWord(v) || (Array.isArray(v) && v.length > 0 && v.every(isWord)),
    accept: (v) => typeof v === 'object',
    pack: (v) => {
      let mask = 0;
      for (let i = 0; i < size && i < WORD; i++) if (v[names[i]]) mask |= 1 << i;
      if (size <= WORD) return mask;
      const words = [mask];
      for (let i = WORD; i < size; i++) {
        if (!v[names[i]]) continue;
        const at = (i / WORD) | 0;
        while (words.length <= at) words.push(0);
        words[at] |= 1 << (i % WORD);
      }
      return words.length === 1 ? mask : words;
    },
    unpack: (v) => {
      const single = typeof v === 'number';
      if (!single && !Array.isArray(v)) return v;
      const object = { ...template };
      for (let i = 0; i < size; i++) {
        const word = single ? (i < WORD ? v : 0) : v[(i / WORD) | 0];
        object[names[i]] = typeof word === 'number' && (word & (1 << (i % WORD))) !== 0;
      }
      return object;
    },
  });
};

module.exports = { SCALARS, WORD, enumeration, flags, decimal, literal };
