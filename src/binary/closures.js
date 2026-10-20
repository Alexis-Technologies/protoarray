// The no-eval backend of the binary wire: the plan compiles into composed
// closures that write and read the bytes ./generate.js describes, with the
// same errors on the same paths. It runs where `new Function` is unavailable
// and is the reference the generated backend is checked against in the test
// suite. Paths are formatted only on error: a scalar throws with a path of
// its own level, and each level that knows its key or index nests it.

const { expectedOf, fail, nest, refuse, step } = require('../errors.js');
const { WORD, literal, isBytes, isMap, listOf, put, member } = require('../types.js');

const BYTE = 256;

const inHeader = (node) => node.kind === 'scalar' && node.type === 'boolean';
const wordsOf = (node) => Math.ceil(node.names.length / WORD);

// A call of `fn` whose error gets `path` prepended.
const nested = (fn, path) => (a, b) => {
  try {
    return fn(a, b);
  } catch (error) {
    throw nest(error, path);
  }
};

const build = (plan, context) => {
  const { validate } = context;

  // The wire form of a non-null value, null when nothing travels (what
  // ready() gives in generate.js): a converted scalar is packed first, a
  // decimal past the safe integers refused.
  const packer = (node) => {
    if (node.kind !== 'scalar' || node.pack === null) return null;
    if (node.type === 'null') return () => null;
    if (node.type === 'bigint' || node.type === 'bytes') return null;
    const { pack } = node;
    if (node.always !== true) return pack;
    return (v) => {
      const wire = pack(v);
      if (wire === undefined) refuse(node.code, '', expectedOf(node));
      return wire;
    };
  };

  const valueOf = (node) => {
    const pack = packer(node);
    return pack === null ? (v) => v : (v) => (v == null ? null : pack(v));
  };

  // A string slot holds a string and a bytes slot a Uint8Array: the binary
  // wire has no form for anything else, where the text wire carries it as is.
  const writeString = (w, v) => {
    if (typeof v !== 'string') refuse('type', '', 'string');
    w.string(v);
  };

  const scalarWriter = (node) => {
    if (node.decimals !== undefined) return (w, v) => w.svar(v);
    switch (node.type) {
      case 'number':
        return (w, v) => w.f64(v);
      case 'integer':
      case 'date':
        return (w, v) => w.svar(v);
      case 'boolean':
        return (w, v) => w.u8(v ? 1 : 0);
      case 'string':
        return writeString;
      case 'enum':
        return node.values.length <= BYTE ? (w, v) => w.u8(v) : (w, v) => w.uvar(v);
      case 'flags': {
        const words = wordsOf(node);
        return words === 1 ? (w, v) => w.uvar(v) : (w, v) => w.words(v, words);
      }
      case 'bytes':
        return (w, v) => {
          if (!isBytes(v)) refuse('type', '', 'bytes');
          w.raw(v);
        };
      case 'bigint':
        return (w, v) => w.string(String(v));
      case 'json':
        // A value JSON has no text for (a function) travels as null, as on
        // the text wire.
        return (w, v) => {
          const text = JSON.stringify(v);
          w.string(text === undefined ? 'null' : text);
        };
      default:
        return () => {};
    }
  };

  // The checks of the generated backend, behind `validate`; a scalar's path is
  // its own level's.
  const length = () => fail('structure', '', 'length');
  const truncated = (r) => {
    if (r.pos > r.end) length();
  };

  const scalarReader = (node) => {
    if (node.decimals !== undefined) {
      const scale = 10 ** node.decimals;
      if (!validate) return (r) => r.svar() / scale;
      return (r) => {
        const v = r.svar() / scale;
        truncated(r);
        return v;
      };
    }
    switch (node.type) {
      case 'number':
        if (!validate) return (r) => r.f64();
        return (r) => {
          if (r.pos + 8 > r.end) length();
          return r.f64();
        };
      case 'integer':
        if (!validate) return (r) => r.svar();
        return (r) => {
          const v = r.svar();
          truncated(r);
          return v;
        };
      case 'date':
        if (!validate) return (r) => new Date(r.svar());
        return (r) => {
          const t = r.svar();
          truncated(r);
          if (t > 8.64e15 || t < -8.64e15) fail('type', '', 'date');
          return new Date(t);
        };
      case 'boolean':
        if (!validate) return (r) => r.u8() === 1;
        return (r) => {
          const t = r.u8();
          if (!(t < 2)) fail('type', '', 'boolean');
          return t === 1;
        };
      case 'string':
        if (!validate) return (r) => r.string();
        return (r) => {
          const s = r.string();
          if (s === undefined) length();
          return s;
        };
      case 'enum': {
        const { values } = node;
        const size = values.length;
        const wide = size > BYTE;
        if (!validate) return wide ? (r) => values[r.uvar()] : (r) => values[r.u8()];
        return (r) => {
          const t = wide ? r.uvar() : r.u8();
          if (wide) truncated(r);
          if (!(t < size)) fail('enum', '', node.expected);
          return values[t];
        };
      }
      case 'flags': {
        const words = wordsOf(node);
        const { unpack } = node;
        const read = words === 1 ? (r) => unpack(r.uvar()) : (r) => unpack(r.words(words));
        if (!validate) return read;
        return (r) => {
          const v = read(r);
          truncated(r);
          return v;
        };
      }
      case 'bytes':
        if (!validate) return (r) => r.raw();
        return (r) => {
          const v = r.raw();
          if (v === undefined) length();
          return v;
        };
      case 'bigint':
        if (!validate) return (r) => BigInt(r.string());
        return (r) => {
          const s = r.string();
          if (s === undefined || !/^-?\d+$/.test(s)) fail('type', '', 'bigint');
          return BigInt(s);
        };
      case 'json':
        if (!validate) return (r) => JSON.parse(r.string());
        return (r) => {
          const s = r.string();
          if (s === undefined) length();
          return JSON.parse(s);
        };
      default:
        return () => null;
    }
  };

  const writerOf = (node) => {
    if (node.kind === 'scalar') return scalarWriter(node);
    if (node.slot !== undefined) {
      const entry = context.slot(node.slot);
      return (w, v) => entry.write(w, v);
    }
    if (node.kind === 'struct') return structWriter(node);
    if (node.kind === 'union') return unionWriter(node);
    if (node.kind === 'array') return arrayWriter(node);
    if (node.kind === 'map') return mapWriter(node);
    if (node.kind === 'dict') return dictWriter(node);
    return tupleWriter(node);
  };

  const readerOf = (node) => {
    if (node.kind === 'scalar') return scalarReader(node);
    if (node.slot !== undefined) {
      const entry = context.slot(node.slot);
      return (r) => entry.read(r);
    }
    if (node.kind === 'struct') return structReader(node);
    if (node.kind === 'union') return unionReader(node);
    if (node.kind === 'array') return arrayReader(node);
    if (node.kind === 'map') return mapReader(node);
    if (node.kind === 'dict') return dictReader(node);
    return tupleReader(node);
  };

  // A field's or an element's write: the value readied, then written if it
  // travels, with its key or index on the error; gives whether it travelled.
  const slotWriter = (node, path) => {
    const value = valueOf(node);
    const write = writerOf(node);
    return nested((w, v) => {
      const x = value(v);
      if (x == null) return false;
      write(w, x);
      return true;
    }, path);
  };

  // The header (a presence bit per field, then a bit per boolean field), then
  // the present fields. A union's branch is a struct without its
  // discriminator; its tag is written by the union.
  const structWriter = (node) => {
    const keys = node.fields.map((field) => field.key);
    const size = keys.length;
    const header = node.fields.filter((field) => inHeader(field.node));
    const bytes = (size + header.length + 7) >> 3;
    const flagBit = node.fields.map((field) =>
      inHeader(field.node) ? size + header.indexOf(field) : -1,
    );
    // A boolean field has no writer: its value goes into the header.
    const writers = node.fields.map((field) =>
      inHeader(field.node) ? null : slotWriter(field.node, step(field.key)),
    );
    const branch = node.tag !== undefined;
    return (w, object) => {
      if (!branch && (typeof object !== 'object' || Array.isArray(object))) refuse('object', '');
      const start = w.bitmap(bytes * 8);
      for (let i = 0; i < size; i++) {
        const write = writers[i];
        if (write === null) {
          const v = object[keys[i]];
          if (v == null) continue;
          w.mark(start, i);
          if (v) w.mark(start, flagBit[i]);
        } else if (write(w, object[keys[i]])) w.mark(start, i);
      }
    };
  };

  const bit = (r, start, i) => (r.bytes[start + (i >> 3)] & (1 << (i & 7))) !== 0;

  // One slot's read: the value, the default or, for a required one under
  // validation, an error with its key or index.
  const slotReader = (node, required, def, path) => {
    const read = nested(readerOf(node), path);
    const missing = required && validate ? () => fail('required', path) : () => def;
    return (r, present) => (present ? read(r) : missing());
  };

  // Objects start as a copy of a literal-shaped template, so every decoded
  // record has one hidden class.
  const structReader = (node) => {
    const keys = node.fields.map((field) => field.key);
    const size = keys.length;
    const header = node.fields.filter((field) => inHeader(field.node));
    const bytes = (size + header.length + 7) >> 3;
    const flagBit = node.fields.map((field) =>
      inHeader(field.node) ? size + header.indexOf(field) : -1,
    );
    const readers = node.fields.map((field) =>
      slotReader(field.node, field.required, field.def, step(field.key)),
    );
    const { tag } = node;
    const template = literal(tag === undefined ? keys : tag.keys, 'null');
    return (r, t) => {
      const start = r.pos;
      if (validate && start + bytes > r.end) length();
      r.pos = start + bytes;
      const object = { ...template };
      if (tag !== undefined) object[tag.key] = tag.values[t];
      for (let i = 0; i < size; i++) {
        const present = bit(r, start, i);
        const flag = flagBit[i];
        object[keys[i]] = flag === -1 || !present ? readers[i](r, present) : bit(r, start, flag);
      }
      return object;
    };
  };

  // The branch a tag belongs to: tags run through the branches in order.
  const branchOf = (node) => {
    const out = [];
    node.branches.forEach((branch, b) => {
      for (let i = 0; i < branch.count; i++) out.push(b);
    });
    return out;
  };

  const unionWriter = (node) => {
    const { key, tag } = node;
    const wide = tag.values.length > BYTE;
    const writers = node.branches.map((branch) => structWriter(branch.node));
    const branches = branchOf(node);
    return (w, object) => {
      if (typeof object !== 'object' || Array.isArray(object)) refuse('object', '');
      const t = tag.checkedPack(object[key]);
      if (t === undefined) refuse('union', step(key), tag.expected);
      if (wide) w.uvar(t);
      else w.u8(t);
      writers[branches[t]](w, object);
    };
  };

  const unionReader = (node) => {
    const { key, tag } = node;
    const wide = tag.values.length > BYTE;
    const readers = node.branches.map((branch) => structReader(branch.node));
    const branches = branchOf(node);
    const where = step(key);
    return (r) => {
      const t = wide ? r.uvar() : r.u8();
      if (wide && validate && r.pos > r.end) fail('structure', where, 'length');
      const b = branches[t];
      if (b === undefined) fail('union', where, tag.expected);
      return readers[b](r, t);
    };
  };

  // An element of a collection: its path is its index, formatted on error.
  const indexed = (fn) => (a, b, i) => {
    try {
      return fn(a, b);
    } catch (error) {
      throw nest(error, `[${i}]`);
    }
  };

  // The count, a bitmap when an item may be null, the items. A Set travels as
  // its elements. A null item of a list of required items has no form.
  const arrayWriter = (node) => {
    const { item } = node;
    const value = valueOf(item);
    const write = indexed(writerOf(item));
    const nullable = !node.itemRequired;
    const set = node.container === 'set';
    const expected = expectedOf(item);
    return (w, input) => {
      let list = input;
      if (set) {
        list = Array.isArray(input) ? input : listOf(input);
        if (list === undefined) refuse('set', '');
      } else if (!Array.isArray(input)) refuse('array', '');
      const count = list.length;
      w.uvar(count);
      if (!nullable) {
        for (let i = 0; i < count; i++) {
          const v = value(list[i]);
          if (v == null) refuse('type', `[${i}]`, expected);
          write(w, v, i);
        }
        return;
      }
      const start = w.bitmap(count);
      for (let i = 0; i < count; i++) {
        const v = value(list[i]);
        if (v == null) continue;
        w.mark(start, i);
        write(w, v, i);
      }
    };
  };

  // A collection's count, bounded by the bytes left, of which every item
  // takes at least one (a required item, a key) or a bit of the bitmap (a
  // nullable item), so no count allocates past the message.
  const counter = (perByte) => {
    if (!validate) return (r) => r.uvar();
    return (r) => {
      const count = r.uvar();
      if (r.pos > r.end || count > (r.end - r.pos) * perByte) length();
      return count;
    };
  };

  const arrayReader = (node) => {
    const { item } = node;
    const read = indexed(readerOf(item));
    const nullable = !node.itemRequired;
    const count = counter(nullable ? 8 : 1);
    const set = node.container === 'set';
    return (r) => {
      const n = count(r);
      const out = new Array(n);
      if (nullable) {
        const start = r.pos;
        r.pos = start + ((n + 7) >> 3);
        for (let i = 0; i < n; i++) out[i] = bit(r, start, i) ? read(r, undefined, i) : null;
      } else {
        for (let i = 0; i < n; i++) out[i] = read(r, undefined, i);
      }
      return set ? new Set(out) : out;
    };
  };

  // A map's or a dictionary's value: behind a presence byte when it may be
  // null, as it is when required.
  const valueWriter = (node, required) => {
    const value = valueOf(node);
    const write = writerOf(node);
    const expected = expectedOf(node);
    return (w, v) => {
      const x = value(v);
      if (required) {
        if (x == null) refuse('type', '', expected);
        write(w, x);
      } else if (x == null) w.u8(0);
      else {
        w.u8(1);
        write(w, x);
      }
    };
  };

  const valueReader = (node, required) => {
    const read = readerOf(node);
    if (required) return read;
    return (r) => {
      const f = r.u8();
      if (validate && !(f < 2)) length();
      return f === 1 ? read(r) : null;
    };
  };

  // The count, then each entry: its key (a string or a number) and its value.
  // An entry's path is its index, since a key may be anything.
  const mapWriter = (node) => {
    const key = node.key.type === 'string' ? writeString : (w, k) => w.f64(k);
    const entry = indexed((w, pair) => {
      key(w, pair[0]);
      value(w, pair[1]);
    });
    const value = valueWriter(node.value, node.valueRequired);
    return (w, map) => {
      if (!isMap(map)) refuse('map', '');
      w.uvar(map.size);
      let i = 0;
      for (const pair of map) {
        entry(w, pair, i);
        i++;
      }
    };
  };

  const mapReader = (node) => {
    const numeric = node.key.type !== 'string';
    const key = (r) => {
      if (numeric) {
        if (validate && r.pos + 8 > r.end) length();
        return r.f64();
      }
      const k = r.string();
      if (validate && k === undefined) length();
      return k;
    };
    const entry = indexed((r) => {
      const k = key(r);
      return [k, value(r)];
    });
    const value = valueReader(node.value, node.valueRequired);
    const count = counter(1);
    return (r) => {
      const n = count(r);
      const out = new Map();
      for (let i = 0; i < n; i++) {
        const pair = entry(r, undefined, i);
        out.set(pair[0], pair[1]);
      }
      return out;
    };
  };

  // A dictionary's value: its path is its key, as the payload spells it.
  const keyed = (fn) => (a, b, k) => {
    try {
      return fn(a, b);
    } catch (error) {
      throw nest(error, member('', k));
    }
  };

  const dictWriter = (node) => {
    const value = keyed(valueWriter(node.value, node.valueRequired));
    return (w, object) => {
      if (typeof object !== 'object' || Array.isArray(object)) refuse('object', '');
      const keys = Object.keys(object);
      w.uvar(keys.length);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        w.string(k);
        value(w, object[k], k);
      }
    };
  };

  const dictReader = (node) => {
    const value = keyed(valueReader(node.value, node.valueRequired));
    const count = counter(1);
    return (r) => {
      const n = count(r);
      const out = {};
      for (let i = 0; i < n; i++) {
        const k = r.string();
        if (validate && k === undefined) length();
        put(out, k, value(r, undefined, k));
      }
      return out;
    };
  };

  const tupleWriter = (node) => {
    const size = node.items.length;
    const writers = node.items.map((item, i) => slotWriter(item.node, `[${i}]`));
    return (w, list) => {
      if (!Array.isArray(list)) refuse('array', '');
      const start = w.bitmap(size);
      for (let i = 0; i < size; i++) if (writers[i](w, list[i])) w.mark(start, i);
    };
  };

  const tupleReader = (node) => {
    const size = node.items.length;
    const bytes = (size + 7) >> 3;
    const readers = node.items.map((item, i) =>
      slotReader(item.node, item.required, item.def, `[${i}]`),
    );
    return (r) => {
      const start = r.pos;
      r.pos = start + bytes;
      if (validate) truncated(r);
      const out = new Array(size);
      for (let i = 0; i < size; i++) out[i] = readers[i](r, bit(r, start, i));
      return out;
    };
  };

  // The root: a record as it is (a null one has no form), a scalar behind a
  // presence byte, a collection as it is.
  if (plan.kind === 'scalar') {
    const value = valueOf(plan);
    const write = scalarWriter(plan);
    const read = scalarReader(plan);
    const missing = plan.required && validate ? () => fail('required', '') : () => null;
    return {
      write: (w, v) => {
        const x = value(v);
        if (x == null) w.u8(0);
        else {
          w.u8(1);
          write(w, x);
        }
      },
      read: (r) => {
        const f = r.u8();
        if (validate && !(f < 2)) length();
        return f === 1 ? read(r) : missing();
      },
    };
  }
  const write = writerOf(plan);
  return {
    write: (w, v) => {
      if (v == null) refuse('required', '');
      write(w, v);
    },
    read: readerOf(plan),
  };
};

module.exports = { build };
