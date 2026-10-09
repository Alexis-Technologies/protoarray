// The scalar type table: how each type travels (identity types go through as
// they are), how it is checked on the wire and how it is converted. Both
// backends read it, so they can never disagree on a type.

const DIGITS = /^-?\d+$/;

// A Date or a timestamp becomes epoch milliseconds; an invalid date has no
// JSON form and travels as null.
const ms = (value) => {
  const time = +value;
  return Number.isNaN(time) ? null : time;
};

// An object parsed from a literal has the hidden class a literal would have.
const literal = (keys, value) =>
  JSON.parse(`{${keys.map((key) => `${JSON.stringify(key)}:${value}`).join(',')}}`);

const scalar = (type, rest) => ({ kind: 'scalar', type, expected: type, code: 'type', ...rest });

// `check` validates the wire form; `pack`/`unpack` convert, and are null for
// identity types, which travel as they are.
const identity = (type) => {
  // oxlint-disable-next-line valid-typeof
  const check = type === 'json' ? null : (v) => typeof v === type;
  return scalar(type, { check, pack: null, unpack: null });
};

const SCALARS = Object.assign(Object.create(null), {
  string: () => identity('string'),
  number: () => identity('number'),
  boolean: () => identity('boolean'),
  json: () => identity('json'),
  date: () =>
    scalar('date', { check: (v) => typeof v === 'number', pack: ms, unpack: (v) => new Date(v) }),
  bigint: () =>
    scalar('bigint', {
      check: (v) => typeof v === 'string' && DIGITS.test(v),
      pack: (v) => String(v),
      unpack: (v) => BigInt(v),
    }),
});

const enumeration = (values) => {
  const size = values.length;
  const dict = Object.create(null);
  for (let i = 0; i < size; i++) dict[values[i]] = i;
  const node = scalar('enum', {
    values,
    check: (v) => (v | 0) === v && v >= 0 && v < size,
    pack: (v) => (dict[v] === undefined ? null : dict[v]),
    unpack: (v) => values[v],
  });
  node.expected = values.join(', ');
  node.code = 'enum';
  return node;
};

const flags = (names) => {
  const size = names.length;
  const template = literal(names, 'false');
  return scalar('flags', {
    names,
    check: (v) => (v | 0) === v && v >= 0,
    pack: (v) => {
      let mask = 0;
      for (let i = 0; i < size; i++) if (v[names[i]]) mask |= 1 << i;
      return mask;
    },
    unpack: (v) => {
      const object = { ...template };
      for (let i = 0; i < size; i++) object[names[i]] = (v & (1 << i)) !== 0;
      return object;
    },
  });
};

module.exports = { SCALARS, enumeration, flags, literal };
