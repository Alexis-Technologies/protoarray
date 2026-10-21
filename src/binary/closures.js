// The no-eval backend of the binary wire: the plan compiles into composed
// closures that write and read the bytes ./generate.js describes, with the
// same errors on the same paths. It runs where `new Function` is unavailable
// and is the reference the generated backend is checked against in the test
// suite. Paths are formatted only on error: a scalar throws with a path of
// its own level, and each level that knows its key or index nests it. A plan
// from Schema.resolve is read and written as ./generate.js describes.

const { expectedOf, fail, nest, refuse, step } = require('../errors.js');
const { literal, isBytes, isMap, listOf, put, member } = require('../types.js');
const { byteTag, wordsOf, inHeader, wireOf, droppedBit } = require('./inspect.js');

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
    // A bridge (Schema.resolve) packs the reader's value into the writer's form.
    if (node.writer !== undefined) return node.pack;
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
    // A bridge writes the writer's form; a value the reader drops never travels.
    if (node.writer !== undefined && node.type !== 'null') return scalarWriter(node.writer);
    if (node.decimals !== undefined) return (w, v) => w.svar(v);
    switch (node.type) {
      case 'number':
        return (w, v) => w.f64(v);
      case 'integer':
        // Only a safe integer has a form: an infinity or a fraction would read
        // back as another number (the writer's loop ends on any value).
        return (w, v) => {
          if (!Number.isSafeInteger(v)) refuse('type', '', 'integer');
          w.svar(v);
        };
      case 'date':
        return (w, v) => w.svar(v);
      case 'boolean':
        return (w, v) => w.u8(v ? 1 : 0);
      case 'string':
        return writeString;
      case 'enum':
        return byteTag(node) ? (w, v) => w.u8(v) : (w, v) => w.uvar(v);
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

  // The checks of the generated backend: the structure of the wire in every
  // mode, the values behind `validate`; a scalar's path is its own level's.
  const length = () => fail('structure', '', 'length');
  const truncated = (r) => {
    if (r.pos > r.end) length();
  };

  // A read of a converted type: the raw value, then its own `checkedUnpack`
  // (types.js) under validation, its `unpack` without, as on the text wire.
  const converted = (node, raw, unpack) => {
    if (!validate) {
      return (r) => {
        const v = raw(r);
        truncated(r);
        return unpack(v);
      };
    }
    const { checkedUnpack, code, expected } = node;
    return (r) => {
      const v = raw(r);
      truncated(r);
      const out = checkedUnpack(v);
      if (out === undefined) fail(code, '', expected);
      return out;
    };
  };

  // A read of an integer of the wire, a safe one under validation: the varint
  // is exact over them and no further.
  const integer = (expected) => {
    if (!validate) {
      return (r) => {
        const v = r.svar();
        truncated(r);
        return v;
      };
    }
    return (r) => {
      const v = r.svar();
      truncated(r);
      if (!Number.isSafeInteger(v)) fail('type', '', expected);
      return v;
    };
  };

  // The text wire's form of the writer's scalar, for a bridge (Schema.resolve)
  // to convert: an enum's index, a flags mask, an integer or a string, the
  // writer types a bridge reads.
  const rawReader = (node) => {
    if (node.type === 'enum') {
      const wide = !byteTag(node);
      return (r) => {
        const t = wide ? r.uvar() : r.u8();
        truncated(r);
        return t;
      };
    }
    if (node.type === 'flags') {
      const words = wordsOf(node);
      const read = words === 1 ? (r) => r.uvar() : (r) => r.words(words);
      return (r) => {
        const v = read(r);
        truncated(r);
        return v;
      };
    }
    // An integer and a string read as their own text form.
    return scalarReader(node);
  };

  // A resolved scalar (Schema.resolve): a value the reader drops is read in
  // the writer's form, whatever it is, and dropped; a bridge converts the
  // writer's form, checked with validation.
  const bridgedReader = (node) => {
    if (node.type === 'null') {
      const read = readerOf(node.writer);
      return (r) => {
        read(r);
        return null;
      };
    }
    const raw = rawReader(node.writer);
    const { unpack, checkedUnpack } = node;
    if (!validate) return (r) => unpack(raw(r));
    return (r) => {
      const v = checkedUnpack(raw(r));
      if (v === undefined) fail(node.code, '', node.expected);
      return v;
    };
  };

  // The text of a string slot, which must fit the message.
  const text = (r) => {
    const s = r.string();
    if (s === undefined) length();
    return s;
  };

  const scalarReader = (node) => {
    if (node.writer !== undefined) return bridgedReader(node);
    if (node.decimals !== undefined) {
      const scale = 10 ** node.decimals;
      const read = integer(node.expected);
      return (r) => read(r) / scale;
    }
    switch (node.type) {
      case 'number':
        return (r) => {
          if (r.pos + 8 > r.end) length();
          return r.f64();
        };
      case 'integer':
        return integer('integer');
      case 'date':
        return converted(
          node,
          (r) => r.svar(),
          (t) => new Date(t),
        );
      case 'boolean':
        if (!validate) {
          return (r) => {
            const t = r.u8();
            truncated(r);
            return t === 1;
          };
        }
        return (r) => {
          const t = r.u8();
          truncated(r);
          if (!(t < 2)) fail('type', '', 'boolean');
          return t === 1;
        };
      case 'string':
        return text;
      case 'enum': {
        const { values } = node;
        const size = values.length;
        const wide = !byteTag(node);
        if (!validate) {
          return (r) => {
            const t = wide ? r.uvar() : r.u8();
            truncated(r);
            return values[t];
          };
        }
        return (r) => {
          const t = wide ? r.uvar() : r.u8();
          truncated(r);
          if (!(t < size)) fail('enum', '', node.expected);
          return values[t];
        };
      }
      case 'flags': {
        const words = wordsOf(node);
        const raw = words === 1 ? (r) => r.uvar() : (r) => r.words(words);
        return converted(node, raw, node.unpack);
      }
      case 'bytes':
        return (r) => {
          const v = r.raw();
          if (v === undefined) length();
          return v;
        };
      case 'bigint': {
        if (!validate) {
          return (r) => {
            const s = text(r);
            try {
              return BigInt(s);
            } catch {
              return fail('type', '', 'bigint');
            }
          };
        }
        const { checkedUnpack } = node;
        return (r) => {
          const v = checkedUnpack(text(r));
          if (v === undefined) fail('type', '', 'bigint');
          return v;
        };
      }
      case 'json':
        return (r) => {
          const s = text(r);
          try {
            return JSON.parse(s);
          } catch {
            return fail('json', '');
          }
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
    const header = node.fields.filter((field) => inHeader(wireOf(field.node)));
    const bytes = (size + header.length + 7) >> 3;
    const flagBit = node.fields.map((field) =>
      inHeader(wireOf(field.node)) ? size + header.indexOf(field) : -1,
    );
    // A boolean field has no writer: its value goes into the header. A field
    // only the writer has, or one the reader drops (Schema.resolve), and a
    // null field never travel.
    const writers = node.fields.map((field) => {
      if (field.key === null || field.node.type === 'null') return undefined;
      return inHeader(field.node) ? null : slotWriter(field.node, step(field.key));
    });
    const branch = node.tag !== undefined;
    return (w, object) => {
      if (!branch && (typeof object !== 'object' || Array.isArray(object))) refuse('object', '');
      const start = w.bitmap(bytes * 8);
      for (let i = 0; i < size; i++) {
        const write = writers[i];
        if (write === undefined) continue;
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
    // A field only the writer has (Schema.resolve) has no key: it is read,
    // under the writer's key on an error, and dropped.
    const keys = node.fields.map((field) => field.key);
    const size = keys.length;
    const header = node.fields.filter((field) => inHeader(wireOf(field.node)));
    const bytes = (size + header.length + 7) >> 3;
    // A boolean the reader drops has its bit in the header and reads as null.
    const flagBit = node.fields.map((field) =>
      inHeader(wireOf(field.node)) && !droppedBit(field.node) ? size + header.indexOf(field) : -1,
    );
    const readers = node.fields.map((field) => {
      if (droppedBit(field.node)) return () => null;
      const path = step(field.key === null ? field.wire : field.key);
      return slotReader(field.node, field.required, field.def, path);
    });
    const { tag } = node;
    // A resolved record's template has the reader's keys in its order, with
    // the reader's fields the writer does not have at their defaults.
    const order = node.order === undefined ? keys : node.order;
    const template = literal(tag === undefined ? order : tag.keys, 'null');
    if (node.extras !== undefined) for (const extra of node.extras) template[extra.key] = extra.def;
    return (r, t) => {
      const start = r.pos;
      if (start + bytes > r.end) length();
      r.pos = start + bytes;
      const object = { ...template };
      if (tag !== undefined) object[tag.key] = tag.values[t];
      for (let i = 0; i < size; i++) {
        const present = bit(r, start, i);
        const flag = flagBit[i];
        const value = flag === -1 || !present ? readers[i](r, present) : bit(r, start, flag);
        if (keys[i] !== null) object[keys[i]] = value;
      }
      return object;
    };
  };

  // The branch a tag belongs to: tags run through the branches in order. A
  // branch the reader has no values of (Schema.resolve) has none: its tags
  // are errors.
  const branchOf = (node) => {
    const out = [];
    node.branches.forEach((branch, b) => {
      for (let i = 0; i < branch.count; i++) out.push(branch.node === null ? undefined : b);
    });
    return out;
  };

  const branchCodecs = (node, make) =>
    node.branches.map((branch) => (branch.node === null ? null : make(branch.node)));

  const unionWriter = (node) => {
    const { key, tag } = node;
    const wide = !byteTag(tag);
    const writers = branchCodecs(node, structWriter);
    const branches = branchOf(node);
    return (w, object) => {
      if (typeof object !== 'object' || Array.isArray(object)) refuse('object', '');
      const t = tag.checkedPack(object[key]);
      const b = branches[t];
      if (b === undefined) refuse('union', step(key), tag.expected);
      if (wide) w.uvar(t);
      else w.u8(t);
      writers[b](w, object);
    };
  };

  const unionReader = (node) => {
    const { key, tag } = node;
    const wide = !byteTag(tag);
    const readers = branchCodecs(node, structReader);
    const branches = branchOf(node);
    const where = step(key);
    return (r) => {
      const t = wide ? r.uvar() : r.u8();
      if (r.pos > r.end) fail('structure', where, 'length');
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
    // The wire's optionality is the writer's (Schema.resolve).
    const nullable = !wireOf(node).itemRequired;
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
  const counter = (perByte) => (r) => {
    const count = r.uvar();
    if (r.pos > r.end || count > (r.end - r.pos) * perByte) length();
    return count;
  };

  const arrayReader = (node) => {
    const { item } = node;
    const read = indexed(readerOf(item));
    const nullable = !wireOf(node).itemRequired;
    const count = counter(nullable ? 8 : 1);
    const set = node.container === 'set';
    // An absent item where the reader requires one (Schema.resolve) is refused
    // as a null one is on the text wire.
    const refused = nullable && node.itemRequired && validate;
    const expected = expectedOf(item);
    return (r) => {
      const n = count(r);
      const out = new Array(n);
      if (nullable) {
        const start = r.pos;
        r.pos = start + Math.ceil(n / 8);
        for (let i = 0; i < n; i++) {
          if (bit(r, start, i)) out[i] = read(r, undefined, i);
          else if (refused) fail('type', `[${i}]`, expected);
          else out[i] = null;
        }
      } else {
        for (let i = 0; i < n; i++) out[i] = read(r, undefined, i);
      }
      return set ? new Set(out) : out;
    };
  };

  // A map's or a dictionary's value: behind a presence byte when the writer
  // may omit it, as it is when the wire requires it (Schema.resolve: the
  // writer's optionality); one the reader requires is refused when absent.
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

  const valueReader = (node, onWire, required) => {
    const read = readerOf(node);
    if (onWire) return read;
    const refused = required && validate;
    const expected = expectedOf(node);
    return (r) => {
      const f = r.u8();
      truncated(r);
      if (!(f < 2)) fail('structure', '', 'presence');
      if (f === 1) return read(r);
      if (refused) fail('type', '', expected);
      return null;
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
    const value = valueWriter(node.value, wireOf(node).valueRequired);
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
        if (r.pos + 8 > r.end) length();
        return r.f64();
      }
      const k = r.string();
      if (k === undefined) length();
      return k;
    };
    const entry = indexed((r) => {
      const k = key(r);
      return [k, value(r)];
    });
    const value = valueReader(node.value, wireOf(node).valueRequired, node.valueRequired);
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
    const value = keyed(valueWriter(node.value, wireOf(node).valueRequired));
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
    const value = keyed(valueReader(node.value, wireOf(node).valueRequired, node.valueRequired));
    const count = counter(1);
    return (r) => {
      const n = count(r);
      const out = {};
      for (let i = 0; i < n; i++) {
        const k = r.string();
        if (k === undefined) length();
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

  // The writer's trailing elements the reader does not have (Schema.resolve)
  // are read and dropped; the reader's elements the writer does not have
  // follow at their defaults.
  const tupleReader = (node) => {
    const size = node.items.length;
    const bytes = (size + 7) >> 3;
    const readers = node.items.map((item, i) =>
      slotReader(item.node, item.required, item.def, `[${i}]`),
    );
    const read = node.items.filter((item) => item.skip !== true).length;
    const extras = node.extras === undefined ? [] : node.extras.map((extra) => extra.def);
    return (r) => {
      const start = r.pos;
      r.pos = start + bytes;
      truncated(r);
      const out = new Array(read + extras.length);
      for (let i = 0; i < read; i++) out[i] = readers[i](r, bit(r, start, i));
      for (let i = read; i < size; i++) readers[i](r, bit(r, start, i));
      for (let i = 0; i < extras.length; i++) out[read + i] = extras[i];
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
        truncated(r);
        if (!(f < 2)) fail('structure', '', 'presence');
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
