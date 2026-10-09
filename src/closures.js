// The no-eval backend: the plan compiles into composed closures. It runs where
// `new Function` is unavailable (CSP without unsafe-eval, edge runtimes) and
// is the reference the codegen backend is checked against in the test suite.

const { fail, nest } = require('./errors.js');
const { literal } = require('./types.js');

const EXPECTED = { struct: 'object', array: 'array', tuple: 'tuple', ref: 'object' };

// Paths are passed as a key or an element index and only formatted on error.
const at = (path) => (typeof path === 'number' ? `[${path}]` : path);

const build = (plan, options) => {
  const { validate } = options;

  // Encoders take a non-null value; `null` stands for an identity conversion
  // so callers skip the call on the hot path.
  const encoder = (node) => {
    if (node.kind === 'scalar') return node.pack;
    if (node.kind === 'ref') return (value) => node.slot.codec.encode(value);
    if (node.kind === 'struct') return structEncoder(node);
    const encoders = node.kind === 'tuple' ? node.items.map((item) => encoder(item.node)) : null;
    const encode = encoders === null ? encoder(node.item) : null;
    if (encoders === null && encode === null) return null;
    return (list) => {
      const count = encoders === null ? list.length : encoders.length;
      const out = new Array(count);
      for (let i = 0; i < count; i++) {
        const value = list[i];
        const convert = encoders === null ? encode : encoders[i];
        out[i] = value == null ? null : convert === null ? value : convert(value);
      }
      return out;
    };
  };

  const structEncoder = (node) => {
    const { keys, tail, sparse } = node;
    const size = keys.length;
    const encoders = node.fields.map((field) => encoder(field.node));
    return (object) => {
      const out = sparse ? [0] : new Array(size);
      let mask = 0;
      for (let i = 0; i < size; i++) {
        const value = object[keys[i]];
        const encode = encoders[i];
        const wire = value == null ? null : encode === null ? value : encode(value);
        if (!sparse) out[i] = wire;
        else if (wire !== null) {
          mask |= 1 << i;
          out.push(wire);
        }
      }
      if (sparse) {
        out[0] = mask;
        return out;
      }
      let length = size;
      while (length > tail && out[length - 1] === null) length--;
      if (length < size) out.length = length;
      return out;
    };
  };

  // Decoders take a non-null value and throw with a path relative to it; the
  // caller that knows the key or index re-throws through `nest`.
  const decoder = (node) => {
    if (node.kind === 'scalar') {
      const slot = slotDecoder(node, false, null);
      return (value, strict) => slot(value, '', strict);
    }
    if (node.kind === 'ref') return (value, strict) => node.slot.codec.decode(value, strict);
    if (node.kind === 'struct') return structDecoder(node);
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
    const { keys, sparse } = node;
    const size = keys.length;
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
    const template = literal(keys, 'null');
    return (array, strict) => {
      if (!Array.isArray(array)) fail('structure', '', 'array');
      const { length } = array;
      const object = { ...template };
      let mask = 0;
      let next = 1;
      if (sparse) {
        mask = array[0];
        if ((mask | 0) !== mask) fail('structure', '', 'mask');
      } else if (strict && length > size) {
        fail('extra', '');
      }
      for (let i = 0; i < size; i++) {
        const key = keys[i];
        const field = fields[i];
        let value = null;
        if (!sparse) value = i < length ? array[i] : null;
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

  const encode = encoder(plan);
  const decode = decoder(plan);
  const required = plan.kind === 'scalar' && validate && plan.required;
  return {
    encode: (value) => (value == null ? null : encode === null ? value : encode(value)),
    decode: (value, strict) => {
      if (plan.kind !== 'scalar' || value != null) return decode(value, strict);
      if (required) fail('required', '');
      return null;
    },
  };
};

module.exports = { build };
