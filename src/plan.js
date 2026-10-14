// Turns a definition (the metaschema DSL subset) into a plan: a tree of nodes
// the two backends compile. A plan is immutable and can be shared, which is
// how a Schema used as a field is embedded in another one.

const { SchemaDefinitionError } = require('./errors.js');
const { SCALARS, enumeration, flags } = require('./types.js');

const BRAND = Symbol.for('alexify.protoarray.brand');
const PLAN = Symbol.for('alexify.protoarray.plan');
const CODEC = Symbol.for('alexify.protoarray.codec');

// Sparse masks and flags are 32-bit integers; bit 31 would make them negative.
const MAX_BITS = 31;
// metaschema shorthands that have no positional form yet: rejected loudly so a
// shared definition never silently changes meaning.
const UNSUPPORTED = /^(set|map|object|tuple|schema|one|many|union)$/;
// A default is the decoded value itself, so only primitive-valued types have one.
const DEFAULTABLE = /^(string|number|boolean|json|enum)$/;

const isSchema = (value) => value !== null && typeof value === 'object' && value[BRAND] === true;

const isPlain = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !isSchema(value);

const isPrimitive = (value) => {
  const type = typeof value;
  return type === 'string' || type === 'boolean' || (type === 'number' && Number.isFinite(value));
};

const compilePlan = (definition, context) => {
  const error = (code, text, path) => {
    const message = path === '' ? text : `${text} at "${path}"`;
    return new SchemaDefinitionError(code, message, context.name, path);
  };

  // Enum values travel as an index, so their number is free; flags are bits.
  const list = (values, code, path) => {
    const bits = code === 'ERR_INVALID_FLAGS';
    const names = Array.isArray(values) ? values.map(String) : [];
    const valid =
      names.length > 0 &&
      (!bits || names.length <= MAX_BITS) &&
      new Set(names).size === names.length &&
      !names.includes('__proto__') &&
      values.every((value) => typeof value === 'string' || (typeof value === 'number' && !bits));
    if (!valid) {
      const expected = bits ? `up to ${MAX_BITS} unique names` : 'unique strings or numbers';
      throw error(code, `Expected ${expected}`, path);
    }
    return values.slice();
  };

  const typeNode = (name, path) => {
    const factory = SCALARS[name];
    if (factory !== undefined) return factory();
    if (!/^[A-Z]/.test(name)) throw error('ERR_UNKNOWN_TYPE', `Unknown type "${name}"`, path);
    if (name === context.name) return { kind: 'ref', name, slot: context.selfSlot };
    const target = context.schemas[name];
    if (isSchema(target)) return { kind: 'ref', name, slot: { codec: target[CODEC] } };
    throw error('ERR_UNKNOWN_REFERENCE', `Unknown reference "${name}"`, path);
  };

  const typed = (text, path) => {
    const optional = text.startsWith('?');
    const node = typeNode(optional ? text.slice(1) : text, path);
    return { node, required: !optional && node.type !== 'json', def: null };
  };

  // A field in any of the metaschema spellings: a Schema instance, a type
  // name with an optional `?`, a tuple, a shorthand (`{ array }`, `{ enum }`,
  // `{ flags }`), the long form (`{ type, required, default }`) or a struct.
  const field = (source, path) => {
    if (isSchema(source)) {
      const node = source[PLAN];
      if (node.kind === 'scalar') {
        const { required, ...plain } = node;
        return { node: plain, required, def: null };
      }
      // A compiled schema is used as it is, with its own options, exactly like
      // a reference by name: its codec is called through a slot.
      return { node: { ...node, slot: { codec: source[CODEC] } }, required: true, def: null };
    }
    if (typeof source === 'string') return typed(source, path);
    if (Array.isArray(source)) {
      if (source.length === 0) throw error('ERR_INVALID_DEFINITION', 'An empty tuple', path);
      const items = source.map((item, i) => {
        const keys = isPlain(item) ? Object.keys(item) : [];
        const type = keys.length === 1 ? item[keys[0]] : item;
        const slot = typeof type === 'string' ? typed(type, `${path}[${i}]`) : null;
        if (slot === null || slot.node.kind !== 'scalar') {
          throw error(
            'ERR_INVALID_DEFINITION',
            'Tuple elements must be scalar types',
            `${path}[${i}]`,
          );
        }
        return slot;
      });
      return { node: { kind: 'tuple', items }, required: true, def: null };
    }
    if (!isPlain(source)) throw error('ERR_INVALID_DEFINITION', 'Unexpected definition', path);
    const keys = Object.keys(source);
    const first = keys[0];
    const required = source.required !== false;
    if (first === 'array') {
      const item = field(source.array, `${path}[]`);
      const node = { kind: 'array', item: item.node, itemRequired: item.required, layout: 'rows' };
      return { node, required, def: null };
    }
    if (first === 'enum' || first === 'flags' || first === 'type') {
      const type = first === 'type' ? source.type : first;
      let node;
      if (type === 'enum') node = enumeration(list(source.enum, 'ERR_INVALID_ENUM', path));
      else if (type === 'flags') node = flags(list(source.flags, 'ERR_INVALID_FLAGS', path));
      else if (typeof type === 'string') node = typeNode(type, path);
      else {
        // As in metaschema: a struct whose first key is `type` reads as the
        // long form; a kind first (`{ Struct: {}, type: … }`) makes it a struct.
        const text = 'The type must be a string; a struct starting with "type" needs a kind first';
        throw error('ERR_INVALID_DEFINITION', text, path);
      }
      const hasDefault = source.default !== undefined && node.kind === 'scalar';
      // -0 has no JSON form and would tell the two backends apart.
      const def = hasDefault ? (source.default === 0 ? 0 : source.default) : null;
      if (def !== null && (!isPrimitive(def) || !DEFAULTABLE.test(node.type))) {
        throw error(
          'ERR_INVALID_DEFINITION',
          'A default must be a string, number or boolean',
          path,
        );
      }
      return { node, required: required && !hasDefault && node.type !== 'json', def };
    }
    if (first === 'union' && Array.isArray(source.union)) {
      return { node: union(source, path), required, def: null };
    }
    if (first === undefined) throw error('ERR_INVALID_DEFINITION', 'An empty definition', path);
    if (SCALARS[first] !== undefined || UNSUPPORTED.test(first)) {
      throw error('ERR_UNKNOWN_TYPE', `A struct cannot start with the type name "${first}"`, path);
    }
    return { node: struct(source, keys, path), required: true, def: null };
  };

  // A discriminated union in metaschema's spelling: every branch is a struct
  // whose `discriminator` field is an enum. The wire is `[tag, ...the other
  // fields of the branch]`, the tag being the index of the discriminator value
  // among the values of all branches. Branches are always built from their
  // plans, so the options of the union apply to them.
  const union = (source, path) => {
    const key = source.discriminator;
    if (typeof key !== 'string' || key === '') {
      throw error('ERR_UNKNOWN_TYPE', 'A union needs a discriminator', path);
    }
    if (source.union.length === 0) {
      throw error('ERR_INVALID_UNION', 'A union needs at least one branch', path);
    }
    const values = [];
    const branches = source.union.map((branch, i) => {
      const at = `${path}[${i}]`;
      let node;
      if (isSchema(branch)) node = branch[PLAN];
      else if (typeof branch === 'string' && /^[A-Z]/.test(branch) && branch !== context.name) {
        const target = context.schemas[branch];
        if (!isSchema(target)) {
          throw error('ERR_UNKNOWN_REFERENCE', `Unknown reference "${branch}"`, at);
        }
        node = target[PLAN];
      } else node = field(branch, at).node;
      const index = node.kind === 'struct' && !node.sparse ? node.keys.indexOf(key) : -1;
      const tag = index === -1 ? null : node.fields[index];
      if (tag === null || tag.node.type !== 'enum' || tag.def !== null) {
        throw error(
          'ERR_INVALID_UNION',
          `A branch must be a struct with the enum "${key}" without a default`,
          at,
        );
      }
      const first = values.length;
      values.push(...tag.node.values);
      const fields = node.fields
        .filter((item) => item !== tag)
        .map((item, j) => ({ ...item, index: j }));
      let tail = fields.length;
      while (tail > 0 && !fields[tail - 1].required) tail--;
      const keys = fields.map((item) => item.key);
      const shape = { kind: 'struct', fields, keys, sparse: false, tail };
      shape.tag = { key, position: index, keys: node.keys, values };
      return { node: shape, first, count: tag.node.values.length, source: node };
    });
    const tag = enumeration(list(values, 'ERR_INVALID_UNION', path));
    return { kind: 'union', key, tag, values, branches };
  };

  const struct = (source, keys, path) => {
    const fields = [];
    const names = new Set();
    // metaschema puts the kind and its metadata first: `{ Entity: {}, ... }`.
    const start = /^[A-Z]/.test(keys[0]) && isPlain(source[keys[0]]) ? 1 : 0;
    for (let i = start; i < keys.length; i++) {
      const raw = source[keys[i]];
      // A calculated field has no position on the wire.
      if (typeof raw === 'function') continue;
      const optional = keys[i].endsWith('?');
      const key = optional ? keys[i].slice(0, -1) : keys[i];
      const at = path === '' ? key : `${path}.${key}`;
      if (key === '__proto__') throw error('ERR_RESERVED_KEY', 'Reserved key "__proto__"', at);
      if (/^\d+$/.test(key)) {
        throw error('ERR_INTEGER_KEY', `Integer-like key "${key}": JavaScript orders it first`, at);
      }
      if (key === '' || names.has(key)) {
        throw error('ERR_INVALID_DEFINITION', `Invalid key "${key}"`, at);
      }
      names.add(key);
      const parsed = field(raw, at);
      fields.push({
        key,
        index: fields.length,
        required: parsed.required && !optional,
        def: parsed.def,
        node: parsed.node,
      });
    }
    if (fields.length === 0) throw error('ERR_INVALID_DEFINITION', 'A struct needs fields', path);
    // Only the trailing run of optional fields can be left off the wire.
    let tail = fields.length;
    while (tail > 0 && !fields[tail - 1].required) tail--;
    return { kind: 'struct', fields, keys: fields.map((item) => item.key), sparse: false, tail };
  };

  const root = field(definition, '');
  // A root scalar keeps its own optionality; every other root is required. A
  // schema given as the whole definition is built again from its plan, so the
  // options of this schema apply to it; a root reference stays an alias.
  let node = root.node;
  if (node.kind === 'scalar') node = { ...node, required: root.required };
  else if (node.kind !== 'ref' && node.slot !== undefined) {
    const { slot, ...plain } = node;
    node = plain;
  }
  if (context.sparse) {
    if (node.kind !== 'struct' || node.fields.length > MAX_BITS) {
      throw error('ERR_INVALID_OPTIONS', `sparse needs a struct of up to ${MAX_BITS} fields`, '');
    }
    node = { ...node, sparse: true };
  }
  if (context.layout !== 'rows') {
    if (node.kind !== 'array' || node.item.kind !== 'struct' || node.item.sparse) {
      throw error(
        'ERR_INVALID_OPTIONS',
        `layout "${context.layout}" needs an array of records`,
        '',
      );
    }
    node = { ...node, layout: context.layout };
  }
  return node;
};

// The canonical form names every position and type, so two definitions that
// put the same values in the same slots print the same and share a fingerprint.
const canonical = (node) => {
  if (node.kind === 'struct') {
    const fields = node.fields.map((field) => {
      const def = field.def === null ? '' : `=${JSON.stringify(field.def)}`;
      return `${field.key}:${field.required ? '' : '?'}${canonical(field.node)}${def}`;
    });
    return `${node.sparse ? 'sparse' : ''}{${fields.join(',')}}`;
  }
  if (node.kind === 'array') {
    const layout = node.layout === 'rows' ? '' : node.layout;
    return `${layout}[${node.itemRequired ? '' : '?'}${canonical(node.item)}]`;
  }
  if (node.kind === 'tuple') {
    return `(${node.items.map((item) => (item.required ? '' : '?') + canonical(item.node)).join(',')})`;
  }
  if (node.kind === 'ref') return `@${node.name}`;
  if (node.kind === 'union') {
    return `union(${node.key})[${node.branches.map((branch) => canonical(branch.source)).join('|')}]`;
  }
  const values = node.values || node.names;
  const type = values === undefined ? node.type : `${node.type}(${values.join('|')})`;
  // Only a root scalar carries its own optionality; a field's is on the field.
  return node.required === false ? `?${type}` : type;
};

// FNV-1a, 32-bit: enough to tell schema versions apart in a handshake, and
// cheap enough to compute on every page load.
const fingerprint = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

module.exports = { BRAND, PLAN, CODEC, isSchema, compilePlan, canonical, fingerprint };
