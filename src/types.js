// The scalar type table: how each type travels (identity types go through as
// they are), how it is checked on the wire and how it is converted. Both
// backends read it, so they can never disagree on a type.

// The table is a closed function of the base64 twin, run once: nothing in it
// reaches outside, so standalone.js can embed its source.
const kernel = (base64) => {
  const { toBase64, fromBase64 } = base64;

  const DIGITS = /^-?\d+$/;
  // A value may come from another realm, where instanceof fails: the tag is the
  // fallback, instanceof the fast path.
  const TAG = Object.prototype.toString;

  // getTime is several times cheaper than `+value`, which goes through
  // Symbol.toPrimitive. A BigInt or a Symbol converts to no number: no date
  // wire form. An object converts as its own valueOf says, a throw included:
  // the caller's own error.
  const time = (value) => {
    if (value instanceof Date) return value.getTime();
    const type = typeof value;
    return type === 'bigint' || type === 'symbol' ? NaN : +value;
  };

  // A Date or a timestamp becomes epoch milliseconds; an invalid date has no
  // JSON form and travels as null.
  const ms = (value) => {
    const at = typeof value === 'number' ? value : time(value);
    return Number.isNaN(at) ? null : at;
  };

  // A tag is only a claim: the brand is checked where instanceof fails, for a
  // value of another realm.
  const branded = (method, v) => {
    try {
      method.call(v);
      return true;
    } catch {
      return false;
    }
  };
  const isDate = (v) =>
    v instanceof Date || (TAG.call(v) === '[object Date]' && branded(Date.prototype.getTime, v));

  // The epoch milliseconds of a valid date or a finite timestamp, or undefined.
  const timestamp = (v) => {
    const at = typeof v === 'number' ? v : isDate(v) ? time(v) : NaN;
    return Number.isFinite(at) ? at : undefined;
  };

  // An object parsed from a literal has the hidden class a literal would have.
  const literal = (keys, value) =>
    JSON.parse(`{${keys.map((key) => `${JSON.stringify(key)}:${value}`).join(',')}}`);

  // A view from another realm fails instanceof; its tag tells it apart from the
  // other views, and isView from an object that merely claims the tag.
  const isBytes = (v) =>
    v instanceof Uint8Array || (ArrayBuffer.isView(v) && TAG.call(v) === '[object Uint8Array]');

  const scalar = (type, rest) => ({ kind: 'scalar', type, expected: type, code: 'type', ...rest });

  // An identity type travels as it is: `pack` and `unpack` are null, `check`
  // validates the wire form. A converted type checks and converts the wire in
  // one call, `checkedUnpack`, which gives the converted value or undefined for
  // one of the wrong type. Without validation the wire is trusted, so `unpack`
  // must be total: what has no wire form of the type stays as it is instead of
  // throwing or reading a prototype. The values given to encode are trusted
  // too, but where a value must be looked up or measured (an enum for a
  // union's tag, the items of a list of differences) `checkedPack` converts it
  // or gives undefined. An enum keeps a `check` too: a union reads its tag
  // through it.
  const identity = (type) => {
    // oxlint-disable-next-line valid-typeof
    const check = type === 'json' ? null : (v) => typeof v === type;
    // A json slot holds null as a value, so it is never required.
    return scalar(type, { check, pack: null, unpack: null, nullable: type === 'json' });
  };

  // Whether a value is a Set or a Map, from this realm or another one.
  const isSet = (v) =>
    v instanceof Set || (TAG.call(v) === '[object Set]' && branded(Set.prototype.has, v));
  const isMap = (v) =>
    v instanceof Map || (TAG.call(v) === '[object Map]' && branded(Map.prototype.has, v));

  // The elements of a Set as an array, or undefined for anything else.
  const listOf = (v) => (isSet(v) ? Array.from(v) : undefined);

  // A key assigned to a fresh object: `__proto__` would set its prototype, so it
  // becomes an own property like any other key, as JSON.parse makes it.
  const put = (object, key, value) => {
    if (key === '__proto__') {
      Object.defineProperty(object, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else object[key] = value;
  };

  // The path of a dictionary's value under `path`, on an error: its key comes
  // from the payload, so it is written as itself only when it is a plain name,
  // and otherwise as a quoted JSON string cut to 64 characters, never with a
  // line break or an escape sequence of its own. Both backends write it so.
  const NAME = /^[A-Za-z_$][\w$]{0,63}$/;
  const member = (path, key) => {
    const cut = key.length > 64 ? `${key.slice(0, 64)}…` : key;
    const segment = NAME.test(key) ? key : `[${JSON.stringify(cut)}]`;
    return path === '' ? segment : segment[0] === '[' ? path + segment : `${path}.${segment}`;
  };

  // Every node knows the expression that makes it again, `T` being this table:
  // standalone.js writes the helpers of generated code with it.
  const made = (node, recipe) => {
    node.recipe = recipe;
    return node;
  };

  const SCALARS = Object.assign(Object.create(null), {
    string: () => identity('string'),
    number: () => identity('number'),
    boolean: () => identity('boolean'),
    json: () => identity('json'),
    // metaschema's names for a value of any kind: the same slot as json.
    any: () => identity('json'),
    unknown: () => identity('json'),
    integer: () => scalar('integer', { check: Number.isInteger, pack: null, unpack: null }),
    // A slot that is always null: whatever is given travels as null, and only
    // null decodes.
    null: () =>
      scalar('null', {
        nullable: true,
        check: null,
        pack: () => null,
        unpack: (v) => v,
        checkedUnpack: () => undefined,
      }),
    date: () =>
      scalar('date', {
        checkedPack: timestamp,
        pack: ms,
        unpack: (v) => (typeof v === 'number' ? new Date(v) : v),
        // A valid date only: whole milliseconds within ±8.64e15, the range of Date.
        checkedUnpack: (v) =>
          Number.isInteger(v) && Math.abs(v) <= 8.64e15 ? new Date(v) : undefined,
      }),
    bytes: () =>
      scalar('bytes', {
        // Canonical base64 with padding (RFC 4648 §4): what toBase64 writes.
        // Decoding is the check, so a validated slot decodes once.
        pack: (v) => (isBytes(v) ? toBase64(v) : v),
        unpack: (v) => {
          const bytes = typeof v === 'string' ? fromBase64(v) : null;
          return bytes === null ? v : bytes;
        },
        checkedUnpack: (v) => {
          const bytes = typeof v === 'string' ? fromBase64(v) : null;
          return bytes === null ? undefined : bytes;
        },
      }),
    bigint: () =>
      scalar('bigint', {
        // A safe integer reads as the same BigInt; a value of another type
        // travels as it is.
        pack: (v) => (typeof v === 'bigint' || Number.isSafeInteger(v) ? String(v) : v),
        unpack: (v) => {
          try {
            return BigInt(v);
          } catch {
            return v;
          }
        },
        checkedUnpack: (v) => (typeof v === 'string' && DIGITS.test(v) ? BigInt(v) : undefined),
      }),
  });
  for (const name of Object.keys(SCALARS)) {
    const make = SCALARS[name];
    SCALARS[name] = () => made(make(), `T.SCALARS[${JSON.stringify(name)}]()`);
  }

  const enumeration = (values) => {
    const size = values.length;
    const dict = Object.create(null);
    for (let i = 0; i < size; i++) dict[values[i]] = i;
    const node = scalar('enum', {
      values,
      check: (v) => typeof v === 'number' && (v | 0) === v && v >= 0 && v < size,
      // Only a string or a number can be a value: anything else is not looked
      // up, since turning an object into a key may throw on its own. The lookup
      // coerces its key ('20' finds 20); a union's tag wants the value itself.
      checkedPack: (v) => {
        const t = typeof v;
        if (t !== 'string' && t !== 'number') return undefined;
        const index = dict[v];
        return index !== undefined && values[index] === v ? index : undefined;
      },
      pack: (v) => {
        const t = typeof v;
        if (t !== 'string' && t !== 'number') return null;
        const index = dict[v];
        return index === undefined ? null : index;
      },
      unpack: (v) => (typeof v === 'number' ? (values[v] ?? v) : v),
      checkedUnpack: (v) =>
        typeof v === 'number' && (v | 0) === v && v >= 0 && v < size ? values[v] : undefined,
    });
    // What an error says it expected: the first values of a long enum.
    node.expected = size <= 16 ? values.join(', ') : `${values.slice(0, 16).join(', ')}, …`;
    node.code = 'enum';
    return made(node, `T.enumeration(${JSON.stringify(values)})`);
  };

  // A number with `n` decimals travels as an integer, scaled by 10ⁿ: 19.99 is
  // 1999 with two. Math.round rounds half up (1.005 * 100 is 100.49999…), and
  // dividing the integer by 10ⁿ gives back the double nearest to the decimal.
  const decimal = (n) => {
    const scale = 10 ** n;
    // + 0 turns -0 into 0, which is what JSON would write anyway. A number
    // that scales past the safe integers (NaN and the infinities too) has no
    // wire its decoder reads, so encode refuses it whatever `validate` says
    // (`always`); a value of another type travels as it is, as encode trusts.
    // A list of differences takes only the safe integers of it.
    const checkedPack = (v) => {
      if (typeof v !== 'number') return v;
      const scaled = Math.round(v * scale) + 0;
      return Number.isSafeInteger(scaled) ? scaled : undefined;
    };
    const node = scalar('number', {
      decimals: n,
      always: true,
      checkedPack,
      pack: checkedPack,
      unpack: (v) => (typeof v === 'number' ? v / scale : v),
      checkedUnpack: (v) => (Number.isSafeInteger(v) ? v / scale : undefined),
    });
    node.expected = `number(${n})`;
    return made(node, `T.decimal(${n})`);
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
    const unpack = (v) => {
      const single = typeof v === 'number';
      if (!single && !Array.isArray(v)) return v;
      const object = { ...template };
      for (let i = 0; i < size; i++) {
        const word = single ? (i < WORD ? v : 0) : v[(i / WORD) | 0];
        object[names[i]] = typeof word === 'number' && (word & (1 << (i % WORD))) !== 0;
      }
      return object;
    };
    const node = scalar('flags', {
      names,
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
      unpack,
      checkedUnpack: (v) =>
        isWord(v) || (Array.isArray(v) && v.length > 0 && v.every(isWord)) ? unpack(v) : undefined,
    });
    return made(node, `T.flags(${JSON.stringify(names)})`);
  };

  // The string table of the message being encoded or decoded: set by the root
  // codec of an interned schema for the length of one call (see withTable in layouts.js),
  // null otherwise. Interned slots read it, so the codecs between the root and
  // them need no parameter for it.
  const INTERN = { table: null, map: null };

  // A string that travels as its index in the message's table.
  const interned = () => {
    const pack = (v) => {
      let index = INTERN.map.get(v);
      if (index === undefined) {
        index = INTERN.table.length;
        INTERN.table.push(v);
        INTERN.map.set(v, index);
      }
      return index;
    };
    const node = scalar('string', {
      intern: true,
      pack,
      unpack: (v) => {
        const value = typeof v === 'number' ? INTERN.table[v] : undefined;
        return value === undefined ? v : value;
      },
      checkedUnpack: (v) => {
        const { table } = INTERN;
        return Number.isInteger(v) && v >= 0 && v < table.length ? table[v] : undefined;
      },
    });
    return made(node, 'T.interned()');
  };

  // A list of integers that travels as the first one and the differences
  // between neighbours: `[100, 101, 103]` is `[100, 1, 2]`. Nulls keep their
  // places and leave the running value as it is. Only integers have exact
  // differences, so the values are checked on encode whatever `validate` says
  // (`always`).
  const deltas = (item, required) => {
    const toWire = (v) => {
      const wire = item.checkedPack === undefined ? v : item.checkedPack(v);
      return Number.isSafeInteger(wire) ? wire : undefined;
    };
    const fromWire = item.unpack === null ? (v) => v : item.unpack;
    const checkedItem = item.checkedUnpack === undefined ? (v) => v : item.checkedUnpack;
    const checkedPack = (v) => {
      if (!Array.isArray(v)) return undefined;
      const out = new Array(v.length);
      let base = 0;
      for (let i = 0; i < v.length; i++) {
        out[i] = null;
        if (v[i] == null) {
          if (required) return undefined;
          continue;
        }
        const wire = toWire(v[i]);
        const difference = wire === undefined ? NaN : wire - base;
        if (!Number.isSafeInteger(difference)) return undefined;
        out[i] = difference;
        base = wire;
      }
      return out;
    };
    const node = scalar('deltas', {
      item,
      itemRequired: required,
      always: true,
      pack: checkedPack,
      checkedPack,
      unpack: (v) => {
        if (!Array.isArray(v)) return v;
        const out = new Array(v.length);
        let base = 0;
        for (let i = 0; i < v.length; i++) {
          const d = v[i];
          if (typeof d !== 'number') out[i] = d;
          else out[i] = fromWire((base += d));
        }
        return out;
      },
      checkedUnpack: (v) => {
        if (!Array.isArray(v)) return undefined;
        const out = new Array(v.length);
        let base = 0;
        for (let i = 0; i < v.length; i++) {
          const d = v[i];
          out[i] = null;
          if (d == null) {
            if (required) return undefined;
            continue;
          }
          // Checked before it is added: a BigInt or an object would throw.
          if (!Number.isSafeInteger(d)) return undefined;
          base += d;
          if (!Number.isSafeInteger(base)) return undefined;
          // The item's own check: a date within its range.
          const value = checkedItem(base);
          if (value === undefined) return undefined;
          out[i] = value;
        }
        return out;
      },
    });
    node.expected = `[${required ? '' : '?'}${item.expected}]`;
    return made(node, `T.deltas(${item.recipe},${required})`);
  };

  // A short string with nothing to escape is its text in quotes; the others
  // take JSON.stringify. Surrogates take the long way too, so a lone one is
  // escaped as JSON.stringify escapes it. For the builder in codegen.js.
  const quoted = (s) => {
    if (s.length > 64) return JSON.stringify(s);
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code < 32 || code === 34 || code === 92 || (code >= 0xd800 && code <= 0xdfff)) {
        return JSON.stringify(s);
      }
    }
    return `"${s}"`;
  };

  // The JSON text of a value at `key` of an array, as JSON.stringify of the
  // array writes it, since JSON.stringify writes it: toJSON called once with
  // the key (a BigInt's too), not again on what it gives; undefined, a
  // function and a symbol written as null. A value without toJSON (most
  // often an array of scalars, written here whole) needs no key: it is
  // written as it is, without an object around it.
  const text = (value, key) => {
    const keyed =
      ((typeof value === 'object' && value !== null) || typeof value === 'bigint') &&
      typeof value.toJSON === 'function';
    if (!keyed) {
      const out = JSON.stringify(value);
      return out === undefined ? 'null' : out;
    }
    const name = `${key}`;
    const out = JSON.stringify({ [name]: value });
    return out.length === 2 ? 'null' : out.slice(JSON.stringify(name).length + 2, -1);
  };

  // The functions generated code calls, by the names standalone.js finds them.
  made(isMap, 'T.isMap');
  made(listOf, 'T.listOf');
  made(put, 'T.put');
  made(member, 'T.member');
  made(quoted, 'T.quoted');
  made(text, 'T.text');

  // Conversions between a writer's type and a reader's, for Schema.resolve: the
  // wire is the writer's, the value the reader's. `fallback` is what a writer
  // value the reader does not know becomes (undefined: an error under
  // validation; without it the writer's value passes through).
  const bridge = {
    // A writer's integer read as a BigInt.
    bigint: () => {
      const node = scalar('bigint', {
        pack: (v) => (typeof v === 'bigint' ? Number(v) : v),
        unpack: (v) => (Number.isInteger(v) ? BigInt(v) : v),
        checkedUnpack: (v) => (Number.isInteger(v) ? BigInt(v) : undefined),
      });
      node.expected = 'integer';
      return node;
    },
    // A writer's enum read as the reader's enum, by value, or as a string.
    enumeration: (writer, reader, fallback) => {
      const { values, check } = writer;
      const set = new Set(reader.values);
      const known = reader.type === 'string' ? () => true : (v) => set.has(v);
      const mapped = values.map((value) => (known(value) ? value : fallback));
      const node = scalar(reader.type, {
        pack: writer.pack,
        unpack: (v) => {
          if (!check(v)) return v;
          return mapped[v] === undefined ? values[v] : mapped[v];
        },
        checkedUnpack: (v) => (check(v) ? mapped[v] : undefined),
      });
      node.code = 'enum';
      node.expected = reader.type === 'string' ? writer.expected : reader.expected;
      return node;
    },
    // A writer's string read as one of the reader's enum values.
    choice: (reader, fallback) => {
      const set = new Set(reader.values);
      const node = scalar('enum', {
        pack: (v) => v,
        unpack: (v) => v,
        checkedUnpack: (v) => {
          if (typeof v !== 'string') return undefined;
          return set.has(v) ? v : fallback;
        },
      });
      node.code = 'enum';
      node.expected = reader.expected;
      return node;
    },
    // A writer's flags read by name: the reader's names the writer lacks are
    // false, the writer's names the reader lacks are dropped.
    flags: (writer, reader) => {
      const { names } = reader;
      const template = literal(names, 'false');
      const own = new Set(writer.names);
      const shared = names.filter((name) => own.has(name));
      const project = (object) => {
        const out = { ...template };
        for (let i = 0; i < shared.length; i++) out[shared[i]] = object[shared[i]];
        return out;
      };
      const isMask = (v) => typeof v === 'number' || Array.isArray(v);
      return scalar('flags', {
        names,
        pack: writer.pack,
        unpack: (v) => (isMask(v) ? project(writer.unpack(v)) : v),
        checkedUnpack: (v) => {
          const object = writer.checkedUnpack(v);
          return object === undefined ? undefined : project(object);
        },
      });
    },
    // A value the reader has no use for: whatever the writer sent is dropped,
    // and the reader's null slot holds nothing else, as a null type's does.
    ignore: () =>
      scalar('null', {
        nullable: true,
        check: null,
        pack: () => null,
        unpack: () => null,
        checkedUnpack: () => null,
      }),
  };

  return {
    SCALARS,
    WORD,
    enumeration,
    flags,
    decimal,
    literal,
    isMap,
    listOf,
    put,
    member,
    bridge,
    INTERN,
    interned,
    deltas,
    quoted,
    text,
  };
};

const types = kernel(require('./runtime/node.js'));

module.exports = {
  SCALARS: types.SCALARS,
  WORD: types.WORD,
  enumeration: types.enumeration,
  flags: types.flags,
  decimal: types.decimal,
  literal: types.literal,
  isMap: types.isMap,
  listOf: types.listOf,
  put: types.put,
  member: types.member,
  bridge: types.bridge,
  INTERN: types.INTERN,
  interned: types.interned,
  deltas: types.deltas,
  quoted: types.quoted,
  text: types.text,
  kernel,
};
