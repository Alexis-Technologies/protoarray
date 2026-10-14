// The no-eval backend: the plan compiles into composed closures. It runs where
// `new Function` is unavailable (CSP without unsafe-eval, edge runtimes) and
// is the reference the codegen backend is checked against in the test suite.

const { EXPECTED, fail, nest, refuse } = require('./errors.js');
const { literal } = require('./types.js');

// Paths are passed as a key or an element index and only formatted on error.
const at = (path) => (typeof path === 'number' ? `[${path}]` : path);

// The inline encode check of an identity scalar; v-v is NaN for NaN and the
// infinities, which have no JSON form.
const mismatch = (type, value) =>
  // oxlint-disable-next-line valid-typeof
  typeof value !== type || (type === 'number' && value - value !== 0);

const build = (plan, options) => {
  const { validate } = options;
  // A checking codec (Schema#check) calls the checking codecs of the schemas
  // it embeds.
  const via = options.checking ? 'checker' : 'codec';

  // Identity scalars are checked in the loops that read them, without a call.
  const inlineType = (node) =>
    validate && node.kind === 'scalar' && node.pack === null && node.accept !== null
      ? node.type
      : null;

  // A scalar slot as a function of a non-null value, or null when the value
  // travels as it is with nothing to check. It knows its own path (a key or
  // an index, formatted only on error), so callers need no try/catch.
  const scalarEncoder = (node, path) => {
    const { accept, pack, code, expected } = node;
    if (!validate || accept === null) return pack;
    return (value) => {
      if (!accept(value)) refuse(code, at(path), expected);
      return pack === null ? value : pack(value);
    };
  };

  // Encoders of everything but scalars take a non-null value. A slot (a
  // reference by name or an embedded schema) is called as it is.
  const encoder = (node) => {
    if (node.slot !== undefined) return (value) => node.slot[via].encode(value);
    if (node.kind === 'struct') return structEncoder(node);
    if (node.kind === 'union') return unionEncoder(node);
    if (node.kind === 'tuple') return tupleEncoder(node);
    const { item } = node;
    const scalar = item.kind === 'scalar';
    // Identity items travel in the same array: at most a checking pass.
    const identity = scalar && item.pack === null;
    const type = inlineType(item);
    const encode = identity ? null : scalar ? scalarEncoder(item, '') : encoder(item);
    const nullType = validate && node.itemRequired;
    const expected = scalar ? item.expected : EXPECTED[item.kind];
    return (list) => {
      if (!Array.isArray(list)) refuse('array', '');
      if (identity && type === null && !nullType) return list;
      const count = list.length;
      const out = identity ? list : new Array(count);
      for (let i = 0; i < count; i++) {
        const value = list[i];
        let wire = null;
        if (value == null) {
          if (nullType) refuse('type', `[${i}]`, expected);
        } else if (encode === null) {
          if (type !== null && mismatch(type, value)) refuse('type', `[${i}]`, expected);
          wire = value;
        } else {
          try {
            wire = encode(value);
          } catch (error) {
            throw nest(error, `[${i}]`);
          }
        }
        if (!identity) out[i] = wire;
      }
      return out;
    };
  };

  // Tuple elements are scalars.
  const tupleEncoder = (node) => {
    const size = node.items.length;
    const encoders = node.items.map((item, i) => scalarEncoder(item.node, i));
    const required = node.items.map((item) => validate && item.required);
    return (list) => {
      if (!Array.isArray(list)) refuse('array', '');
      const out = new Array(size);
      for (let i = 0; i < size; i++) {
        const value = list[i];
        const encode = encoders[i];
        if (value == null) {
          if (required[i]) refuse('required', `[${i}]`);
          out[i] = null;
        } else out[i] = encode === null ? value : encode(value);
      }
      return out;
    };
  };

  // A branch of a union has a tag: it leads the wire, so every position moves
  // one place to the right.
  const structEncoder = (node) => {
    const { keys, tail, sparse } = node;
    const size = keys.length;
    const lead = node.tag === undefined ? 0 : 1;
    const width = size + lead;
    const end = tail + lead;
    const types = node.fields.map((field) => inlineType(field.node));
    const encoders = node.fields.map((field, i) => {
      if (types[i] !== null) return null;
      return field.node.kind === 'scalar' ? scalarEncoder(field.node, '') : encoder(field.node);
    });
    const required = node.fields.map((field) => validate && field.required);
    return (object, t) => {
      if (typeof object !== 'object') refuse('object', '');
      const out = sparse ? [0] : new Array(width);
      if (lead === 1) out[0] = t;
      let mask = 0;
      for (let i = 0; i < size; i++) {
        const value = object[keys[i]];
        const encode = encoders[i];
        let wire = null;
        if (value != null) {
          if (encode === null) {
            if (validate && types[i] !== null && mismatch(types[i], value)) {
              refuse('type', keys[i], types[i]);
            }
            wire = value;
          } else {
            try {
              wire = encode(value);
            } catch (error) {
              throw nest(error, keys[i]);
            }
          }
        } else if (required[i]) refuse('required', keys[i]);
        if (!sparse) out[i + lead] = wire;
        else if (wire !== null) {
          mask |= 1 << i;
          out.push(wire);
        }
      }
      if (sparse) {
        out[0] = mask;
        return out;
      }
      let length = width;
      while (length > end && out[length - 1] === null) length--;
      if (length < width) out.length = length;
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
  const unionEncoder = (node) => {
    const { key, tag } = node;
    const encoders = node.branches.map((branch) => structEncoder(branch.node));
    const branches = branchOf(node);
    return (object) => {
      if (typeof object !== 'object') refuse('object', '');
      const value = object[key];
      if (!tag.accept(value)) refuse('union', key, tag.expected);
      const t = tag.pack(value);
      return encoders[branches[t]](object, t);
    };
  };

  const unionDecoder = (node) => {
    const { key, tag } = node;
    const decoders = node.branches.map((branch) => structDecoder(branch.node));
    const branches = branchOf(node);
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const t = array[0];
      if (!tag.check(t)) fail('union', key, tag.expected);
      return decoders[branches[t]](array, strict, t);
    };
  };

  // Decoders take a non-null value and throw with a path relative to it; the
  // caller that knows the key or index re-throws through `nest`.
  const decoder = (node) => {
    if (node.kind === 'scalar') {
      const slot = slotDecoder(node, false, null);
      return (value, strict) => slot(value, '', strict);
    }
    if (node.slot !== undefined) return (value, strict) => node.slot[via].decode(value, strict);
    if (node.kind === 'struct') return structDecoder(node);
    if (node.kind === 'union') return unionDecoder(node);
    if (node.kind === 'tuple') return tupleDecoder(node);
    return arrayDecoder(node);
  };

  // One slot: nullish → required check or default; a scalar → wire check and
  // conversion; anything else → the nested decoder with the path prefixed.
  const slotDecoder = (node, required, def) => {
    const scalar = node.kind === 'scalar';
    const check = scalar && validate ? node.check : null;
    const decode = scalar ? null : decoder(node);
    return (value, path, strict) => {
      if (value == null) {
        if (required && validate) fail('required', at(path));
        return def;
      }
      if (scalar) {
        if (check !== null && !check(value)) fail(node.code, at(path), node.expected);
        return node.unpack === null ? value : node.unpack(value);
      }
      try {
        return decode(value, strict);
      } catch (error) {
        throw nest(error, at(path));
      }
    };
  };

  // Objects start as a copy of a literal-shaped template so every decoded
  // record has the same hidden class, as an object literal would. Scalars are
  // handled in the loop; only nested values go through a call.
  const structDecoder = (node) => {
    const { keys, sparse, tag } = node;
    const size = keys.length;
    const lead = tag === undefined ? 0 : 1;
    const fields = node.fields.map((field) => {
      const scalar = field.node.kind === 'scalar';
      return {
        required: field.required && validate,
        def: field.def,
        check: scalar && validate ? field.node.check : null,
        code: field.node.code,
        expected: field.node.expected,
        convert: scalar ? field.node.unpack : null,
        decode: scalar ? null : slotDecoder(field.node, field.required, field.def),
      };
    });
    // A branch's template has every key of the branch, its discriminator too.
    const template = literal(lead === 0 ? keys : tag.keys, 'null');
    return (array, strict, t) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const { length } = array;
      const object = { ...template };
      if (lead === 1) object[tag.key] = tag.values[t];
      let mask = 0;
      let next = 1;
      if (sparse) {
        mask = array[0];
        if (typeof mask !== 'number' || (mask | 0) !== mask) fail('structure', '', 'mask');
      } else if (strict && length > size + lead) {
        fail('extra', '');
      }
      for (let i = 0; i < size; i++) {
        const key = keys[i];
        const field = fields[i];
        let value = null;
        if (!sparse) value = i + lead < length ? array[i + lead] : null;
        else if ((mask & (1 << i)) !== 0) value = array[next++];
        if (field.decode !== null) {
          object[key] = field.decode(value, key, strict);
        } else if (value == null) {
          if (field.required) fail('required', key);
          object[key] = field.def;
        } else {
          if (field.check !== null && !field.check(value)) fail(field.code, key, field.expected);
          object[key] = field.convert === null ? value : field.convert(value);
        }
      }
      if (sparse && strict && next !== length) fail('extra', '');
      return object;
    };
  };

  const tupleDecoder = (node) => {
    const slots = node.items.map((item) => slotDecoder(item.node, item.required, null));
    const size = slots.length;
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      if (validate && array.length !== size) fail('structure', '', 'length');
      const out = new Array(size);
      for (let i = 0; i < size; i++) out[i] = slots[i](array[i], i, strict);
      return out;
    };
  };

  const arrayDecoder = (node) => {
    const { item } = node;
    const identity = item.kind === 'scalar' && item.pack === null;
    const required = node.itemRequired && validate;
    const expected = item.kind === 'scalar' ? item.expected : EXPECTED[item.kind];
    if (identity && !required && (!validate || item.check === null)) {
      return (array) => {
        if (!Array.isArray(array)) fail('structure', '', 'array');
        return array;
      };
    }
    const slot = slotDecoder(item, false, null);
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const count = array.length;
      const out = identity ? array : new Array(count);
      for (let i = 0; i < count; i++) {
        const value = array[i];
        if (value == null && required) fail('type', `[${i}]`, expected);
        const decoded = value == null ? null : slot(value, i, strict);
        if (!identity) out[i] = decoded;
      }
      return out;
    };
  };

  const encode = plan.kind === 'scalar' ? scalarEncoder(plan, '') : encoder(plan);
  const decode = decoder(plan);
  const required = plan.kind === 'scalar' && validate && plan.required;
  return {
    encode: (value) => {
      if (value == null && required) refuse('required', '');
      return value == null ? null : encode === null ? value : encode(value);
    },
    decode: (value, strict) => {
      if (plan.kind !== 'scalar' || value != null) return decode(value, strict);
      if (required) fail('required', '');
      return null;
    },
  };
};

module.exports = { build };
