// The no-eval backend: the plan compiles into composed closures. It runs where
// `new Function` is unavailable (CSP without unsafe-eval, edge runtimes) and
// is the reference the codegen backend is checked against in the test suite.

const { expectedOf, fail, nest, refuse, step } = require('./errors.js');
const { WORD, literal, isMap, listOf, put, member } = require('./types.js');

// Paths are passed as a key or an element index and only formatted on error.
const at = (path) => (typeof path === 'number' ? `[${path}]` : path);
// A dictionary's key is the payload's: formatted as member writes it.
const keyAt = (key) => member('', key);

const build = (plan, options) => {
  // Whether the wire is checked on decode. The values given to encode are
  // trusted: checking them is metaschema's (`check`, `parse`).
  const { validate } = options;

  // A scalar slot as a function of a non-null value, or null when the value
  // travels as it is. A list of differences (`always`) checks its values
  // whatever `validate` says, since only integers have exact differences; it
  // knows its own path (a key or an index, formatted only on error).
  const scalarEncoder = (node, path) => {
    const { pack, checkedPack, code, expected } = node;
    if (node.always !== true) return pack;
    return (value) => {
      const wire = checkedPack(value);
      if (wire === undefined) refuse(code, at(path), expected);
      return wire;
    };
  };

  // One element of a map or a dictionary: null, its own wire form or a throw
  // with its path (an index or a key, formatted on error).
  const elementEncoder = (node, format = at) => {
    const encode = node.kind === 'scalar' ? scalarEncoder(node, '') : encoder(node);
    return (value, path) => {
      if (value == null) return null;
      if (encode === null) return value;
      try {
        return encode(value);
      } catch (error) {
        throw nest(error, format(path));
      }
    };
  };

  // Encoders of everything but scalars take a non-null value. A slot (a
  // reference by name or an embedded schema) is called as it is.
  const encoder = (node) => {
    if (node.slot !== undefined) return (value) => node.slot.codec.encode(value);
    if (node.kind === 'struct') return structEncoder(node);
    if (node.kind === 'union') return unionEncoder(node);
    if (node.kind === 'tuple') return tupleEncoder(node);
    if (node.kind === 'map') return mapEncoder(node);
    if (node.kind === 'dict') return dictEncoder(node);
    const { item } = node;
    // Identity items travel in the same array.
    const encode = item.kind === 'scalar' ? scalarEncoder(item, '') : encoder(item);
    const set = node.container === 'set';
    return (input) => {
      // A Set travels as the array of its elements; an array is taken as it is.
      const list = set && !Array.isArray(input) ? listOf(input) : input;
      if (list === undefined) refuse('set', '');
      if (!Array.isArray(list)) refuse('array', '');
      if (encode === null) return list;
      const count = list.length;
      const out = new Array(count);
      for (let i = 0; i < count; i++) {
        const value = list[i];
        if (value == null) out[i] = null;
        else {
          try {
            out[i] = encode(value);
          } catch (error) {
            throw nest(error, `[${i}]`);
          }
        }
      }
      return out;
    };
  };

  // A scalar element knows its own path; any other one is nested on error.
  const tupleEncoder = (node) => {
    const size = node.items.length;
    const encoders = node.items.map((item, i) => {
      if (item.node.kind === 'scalar') return scalarEncoder(item.node, i);
      const encode = encoder(item.node);
      return (value) => {
        try {
          return encode(value);
        } catch (error) {
          throw nest(error, `[${i}]`);
        }
      };
    });
    return (list) => {
      if (!Array.isArray(list)) refuse('array', '');
      const out = new Array(size);
      for (let i = 0; i < size; i++) {
        const value = list[i];
        const encode = encoders[i];
        out[i] = value == null ? null : encode === null ? value : encode(value);
      }
      return out;
    };
  };

  // `[k0, v0, k1, v1, …]`; an entry's path is its index, since a key may be
  // anything.
  const mapEncoder = (node) => {
    const value = elementEncoder(node.value);
    return (map) => {
      if (!isMap(map)) refuse('map', '');
      const out = [];
      let i = 0;
      for (const entry of map) {
        out.push(entry[0], value(entry[1], i));
        i++;
      }
      return out;
    };
  };

  const dictEncoder = (node) => {
    const { value } = node;
    // Identity values travel in the same object.
    const identity = value.kind === 'scalar' && scalarEncoder(value, '') === null;
    const element = elementEncoder(value, keyAt);
    return (object) => {
      if (typeof object !== 'object' || Array.isArray(object)) refuse('object', '');
      if (identity) return object;
      const keys = Object.keys(object);
      const out = {};
      for (let i = 0; i < keys.length; i++) put(out, keys[i], element(object[keys[i]], keys[i]));
      return out;
    };
  };

  // A dense record and a sparse one get a loop each. A branch of a union has
  // a tag: it leads the wire, so every position moves one place to the right.
  const structEncoder = (node) => {
    const { tail, sparse } = node;
    // A field only the writer has (Schema.resolve) has no key: it is null on
    // the wire.
    const keys = node.fields.map((field) => field.key);
    const paths = keys.map((key) => (key === null ? null : step(key)));
    const size = keys.length;
    const lead = node.tag === undefined ? 0 : 1;
    const width = size + lead;
    const end = tail + lead;
    const encoders = node.fields.map((field) =>
      field.node.kind === 'scalar' ? scalarEncoder(field.node, '') : encoder(field.node),
    );
    // The wire form of one field, or null for one that is missing.
    const wireOf = (object, i) => {
      const key = keys[i];
      const value = key === null ? null : object[key];
      if (value == null) return null;
      const encode = encoders[i];
      if (encode === null) return value;
      try {
        return encode(value);
      } catch (error) {
        throw nest(error, paths[i]);
      }
    };
    if (!sparse) {
      return (object, t) => {
        if (typeof object !== 'object' || Array.isArray(object)) refuse('object', '');
        const out = new Array(width);
        if (lead === 1) out[0] = t;
        for (let i = 0; i < size; i++) out[i + lead] = wireOf(object, i);
        let length = width;
        while (length > end && out[length - 1] === null) length--;
        if (length < width) out.length = length;
        return out;
      };
    }
    // One [mask, ...present values] segment per 31 fields: `start` is where
    // the current mask goes, `keep` where the last segment with something in
    // it ends (the first one is always kept).
    return (object) => {
      if (typeof object !== 'object' || Array.isArray(object)) refuse('object', '');
      const out = [0];
      let mask = 0;
      let start = 0;
      let keep = 0;
      for (let i = 0; i < size; i++) {
        if (i > 0 && i % WORD === 0) {
          out[start] = mask;
          if (start === 0 || mask !== 0) keep = out.length;
          start = out.length;
          out.push(0);
          mask = 0;
        }
        const wire = wireOf(object, i);
        if (wire !== null) {
          mask |= 1 << (i % WORD);
          out.push(wire);
        }
      }
      out[start] = mask;
      if (start === 0 || mask !== 0) keep = out.length;
      if (keep < out.length) out.length = keep;
      return out;
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

  // A union picks its branch by the discriminator on encode and by the tag on
  // decode; either one outside the union is an error even without validation,
  // since there is no branch to fall back to.
  // A branch the reader has no values of (Schema.resolve) has no codec: its
  // tags are errors.
  const unionEncoder = (node) => {
    const { key, tag } = node;
    const where = step(key);
    const encoders = node.branches.map((branch) =>
      branch.node === null ? null : structEncoder(branch.node),
    );
    const branches = branchOf(node);
    return (object) => {
      if (typeof object !== 'object' || Array.isArray(object)) refuse('object', '');
      const t = tag.checkedPack(object[key]);
      const encode = t === undefined ? null : encoders[branches[t]];
      if (encode === null) refuse('union', where, tag.expected);
      return encode(object, t);
    };
  };

  const unionDecoder = (node) => {
    const { key, tag } = node;
    const where = step(key);
    const decoders = node.branches.map((branch) =>
      branch.node === null ? null : structDecoder(branch.node),
    );
    const branches = branchOf(node);
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const t = array[0];
      const decode = tag.check(t) ? decoders[branches[t]] : null;
      if (decode === null) fail('union', where, tag.expected);
      return decode(array, strict, t);
    };
  };

  // Decoders take a non-null value and throw with a path relative to it; the
  // caller that knows the key or index re-throws through `nest`.
  const decoder = (node) => {
    if (node.kind === 'scalar') {
      const slot = slotDecoder(node, false, null);
      return (value, strict) => slot(value, '', strict);
    }
    if (node.slot !== undefined) return (value, strict) => node.slot.codec.decode(value, strict);
    if (node.kind === 'struct') return structDecoder(node);
    if (node.kind === 'union') return unionDecoder(node);
    if (node.kind === 'tuple') return tupleDecoder(node);
    if (node.kind === 'map') return mapDecoder(node);
    if (node.kind === 'dict') return dictDecoder(node);
    return arrayDecoder(node);
  };

  // A scalar's check and conversion in one call, where the type has one.
  const converter = (node) =>
    validate.decode && node.checkedUnpack !== undefined ? node.checkedUnpack : null;

  // One slot: nullish → required check or default; a scalar → wire check and
  // conversion; anything else → the nested decoder with the path prefixed.
  const slotDecoder = (node, required, def, format = at) => {
    const scalar = node.kind === 'scalar';
    const check = scalar && validate.decode ? node.check : null;
    const convert = scalar ? converter(node) : null;
    const decode = scalar ? null : decoder(node);
    return (value, path, strict) => {
      if (value == null) {
        if (required && validate.decode) fail('required', format(path));
        return def;
      }
      if (convert !== null) {
        const out = convert(value);
        if (out === undefined) fail(node.code, format(path), node.expected);
        return out;
      }
      if (scalar) {
        if (check !== null && !check(value)) fail(node.code, format(path), node.expected);
        return node.unpack === null ? value : node.unpack(value);
      }
      try {
        return decode(value, strict);
      } catch (error) {
        throw nest(error, format(path));
      }
    };
  };

  // Objects start as a copy of a literal-shaped template so every decoded
  // record has the same hidden class, as an object literal would. Scalars are
  // handled in the loop; only nested values go through a call.
  const structDecoder = (node) => {
    const { sparse, tag } = node;
    // A field only the writer has (Schema.resolve) has no key: it is not read.
    const keys = node.fields.map((field) => field.key);
    const size = keys.length;
    const lead = tag === undefined ? 0 : 1;
    const fields = node.fields.map((field) => {
      const scalar = field.node.kind === 'scalar';
      return {
        path: field.key === null ? null : step(field.key),
        required: field.required && validate.decode,
        def: field.def,
        check: scalar && validate.decode ? field.node.check : null,
        code: field.node.code,
        expected: field.node.expected,
        checked: scalar ? converter(field.node) : null,
        convert: scalar ? field.node.unpack : null,
        decode: scalar ? null : slotDecoder(field.node, field.required, field.def),
      };
    });
    // A branch's template has every key of the branch, its discriminator too;
    // a resolved record's has the reader's keys in its order, with the
    // reader's fields the writer does not have at their defaults.
    const order = node.order === undefined ? keys : node.order;
    const template = literal(lead === 0 ? order : tag.keys, 'null');
    if (node.extras !== undefined) for (const extra of node.extras) template[extra.key] = extra.def;
    return (array, strict, t) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const { length } = array;
      const object = { ...template };
      if (lead === 1) object[tag.key] = tag.values[t];
      let mask = 0;
      let next = 0;
      if (!sparse && strict && length > size + lead) fail('extra', '');
      for (let i = 0; i < size; i++) {
        const key = keys[i];
        const field = fields[i];
        let value = null;
        if (!sparse) value = i + lead < length ? array[i + lead] : null;
        else {
          // The first mask is required; a later segment may be missing.
          if (i % WORD === 0) {
            mask = i === 0 || next < length ? array[next++] : 0;
            if (typeof mask !== 'number' || (mask | 0) !== mask || mask < 0) {
              fail('structure', '', 'mask');
            }
          }
          if ((mask & (1 << (i % WORD))) !== 0) value = array[next++];
        }
        if (key === null) continue;
        if (field.decode !== null) {
          object[key] = field.decode(value, field.path, strict);
        } else if (value == null) {
          if (field.required) fail('required', field.path);
          object[key] = field.def;
        } else if (field.checked !== null) {
          const out = field.checked(value);
          if (out === undefined) fail(field.code, field.path, field.expected);
          object[key] = out;
        } else {
          if (field.check !== null && !field.check(value)) {
            fail(field.code, field.path, field.expected);
          }
          object[key] = field.convert === null ? value : field.convert(value);
        }
      }
      if (sparse && strict && next !== length) fail('extra', '');
      return object;
    };
  };

  // An element the reader does not have (Schema.resolve) is not read; the
  // reader's elements the writer does not have follow at their defaults.
  const tupleDecoder = (node) => {
    const slots = node.items.map((item) => slotDecoder(item.node, item.required, item.def));
    const size = slots.length;
    const read = node.items.filter((item) => item.skip !== true).length;
    const extras = node.extras === undefined ? [] : node.extras.map((extra) => extra.def);
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      if (validate.decode && array.length !== size) fail('structure', '', 'length');
      const out = new Array(read + extras.length);
      for (let i = 0; i < read; i++) out[i] = slots[i](array[i], i, strict);
      for (let i = 0; i < extras.length; i++) out[read + i] = extras[i];
      return out;
    };
  };

  // One element of a collection: the required check, then its slot.
  const elementDecoder = (node, required, format = at) => {
    const slot = slotDecoder(node, false, null, format);
    const nullType = required && validate.decode;
    const expected = expectedOf(node);
    return (value, path, strict) => {
      if (value != null) return slot(value, path, strict);
      if (nullType) fail('type', format(path), expected);
      return null;
    };
  };

  const arrayDecoder = (node) => {
    const { item } = node;
    const identity = item.kind === 'scalar' && item.pack === null;
    const required = node.itemRequired && validate.decode;
    const set = node.container === 'set';
    if (identity && !required && (!validate.decode || item.check === null)) {
      return (array) => {
        if (!Array.isArray(array)) fail('structure', '', 'array');
        return set ? new Set(array) : array;
      };
    }
    const element = elementDecoder(item, node.itemRequired);
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const count = array.length;
      const out = identity ? array : new Array(count);
      for (let i = 0; i < count; i++) {
        const decoded = element(array[i], i, strict);
        if (!identity) out[i] = decoded;
      }
      return set ? new Set(out) : out;
    };
  };

  const mapDecoder = (node) => {
    const value = elementDecoder(node.value, node.valueRequired);
    const { key } = node;
    const check = validate.decode ? key.check : null;
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const count = array.length;
      if (count % 2 !== 0) fail('structure', '', 'length');
      const out = new Map();
      for (let i = 0; i < count; i += 2) {
        const k = array[i];
        if (check !== null && !check(k)) fail(key.code, at(i / 2), key.expected);
        out.set(k, value(array[i + 1], i / 2, strict));
      }
      return out;
    };
  };

  const dictDecoder = (node) => {
    const { value } = node;
    const identity = value.kind === 'scalar' && value.pack === null;
    const required = node.valueRequired && validate.decode;
    const pass = identity && !required && (!validate.decode || value.check === null);
    const element = elementDecoder(value, node.valueRequired, keyAt);
    return (object, strict) => {
      if (object === null || typeof object !== 'object' || Array.isArray(object)) {
        fail('structure', '', 'object');
      }
      if (pass) return object;
      const keys = Object.keys(object);
      const out = identity ? object : {};
      for (let i = 0; i < keys.length; i++) {
        const decoded = element(object[keys[i]], keys[i], strict);
        if (!identity) put(out, keys[i], decoded);
      }
      return out;
    };
  };

  const encode = plan.kind === 'scalar' ? scalarEncoder(plan, '') : encoder(plan);
  const decode = decoder(plan);
  const requiredOut = plan.kind === 'scalar' && plan.required && validate.decode;
  return {
    encode: (value) => (value == null ? null : encode === null ? value : encode(value)),
    decode: (value, strict) => {
      if (plan.kind !== 'scalar' || value != null) return decode(value, strict);
      if (requiredOut) fail('required', '');
      return null;
    },
  };
};

module.exports = { build };
