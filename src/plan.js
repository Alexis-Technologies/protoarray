// Turns a definition (the metaschema DSL subset) into a plan: a tree of nodes
// the two backends compile. A plan is immutable and can be shared, which is
// how a Schema used as a field is embedded in another one.

const { SchemaDefinitionError } = require('./errors.js');
const { SCALARS, enumeration, flags, decimal } = require('./types.js');

/**
 * The nodes of a plan, as both backends read them.
 *
 * @typedef {object} ScalarNode A type from types.js.
 * @property {'scalar'} kind
 * @property {string} type The type name; `expected` and `code` name it in errors.
 * @property {((wire: unknown) => boolean) | null} check The wire check of an identity type
 *   (null for `json`); an enum keeps one for a union's tag.
 * @property {((value: unknown) => boolean) | null} [accept] The check of a value given to
 *   encode, null where there is nothing to check.
 * @property {((value: unknown) => unknown) | null} pack Null for an identity type.
 * @property {((wire: unknown) => unknown) | null} unpack Total: a stray value stays as it is.
 * @property {(value: unknown) => unknown} [checkedPack] Checks and converts a value in one call,
 *   undefined for one of the wrong type; replaces `accept` where the two share their work.
 * @property {(wire: unknown) => unknown} [checkedUnpack] The same on the wire; every converted
 *   type has one.
 * @property {boolean} [required] Only on a root scalar.
 * @property {boolean} [nullable] A slot that holds null as a value (json, null): never required.
 *
 * @typedef {object} Field
 * @property {string} key
 * @property {number} index The position on the wire.
 * @property {boolean} required
 * @property {string | number | boolean | null} def The default, a decoded value.
 * @property {Node} node
 * @property {string[]} [aliases] Keys the field had in older versions (Schema.resolve).
 *
 * @typedef {object} StructNode
 * @property {'struct'} kind
 * @property {Field[]} fields
 * @property {string[]} keys
 * @property {boolean} sparse
 * @property {number} tail Where the trailing run of optional fields starts.
 * @property {{ key: string, position: number, keys: string[], values: unknown[] }} [tag] On a
 *   union's branch: the discriminator it carries as the leading tag.
 * @property {Slot} [slot] On a schema used by value: the codec to call instead of compiling.
 *
 * @typedef {object} UnionNode
 * @property {'union'} kind
 * @property {string} key The discriminator.
 * @property {ScalarNode} tag An enum over the values of every branch, in order.
 * @property {unknown[]} values
 * @property {{ node: StructNode, first: number, count: number, source: StructNode }[]} branches
 *
 * @typedef {object} ArrayNode An array, or a Set travelling as one (`container: 'set'`).
 * @property {'array'} kind
 * @property {Node} item
 * @property {boolean} itemRequired
 * @property {string} layout
 * @property {'set'} [container]
 *
 * @typedef {object} MapNode A Map: `[k0, v0, k1, v1, …]` on the wire.
 * @property {'map'} kind
 * @property {ScalarNode} key A string or a number.
 * @property {Node} value
 * @property {boolean} valueRequired
 *
 * @typedef {{ kind: 'dict', value: Node, valueRequired: boolean }} DictNode An object used as
 *   a dictionary: its keys travel, as JSON keys.
 * @typedef {{ node: Node, required: boolean, def: Field['def'] }} TupleItem
 * @typedef {{ kind: 'tuple', items: TupleItem[] }} TupleNode
 * @typedef {{ kind: 'ref', name: string, slot: Slot }} RefNode A reference by name.
 * @typedef {{ codec: { encode: Function, decode: Function }, checker: object }} Slot A compiled
 *   schema: its codec, and the codec `check` runs, built when first asked for.
 * @typedef {ScalarNode | StructNode | UnionNode | ArrayNode | MapNode | DictNode | TupleNode
 *   | RefNode} Node
 */

const BRAND = Symbol.for('alexify.protoarray.brand');
const PLAN = Symbol.for('alexify.protoarray.plan');
const CODEC = Symbol.for('alexify.protoarray.codec');
const CHECKER = Symbol.for('alexify.protoarray.checker');
// The error that made the automatic backend choice fall back to closures.
const FALLBACK = Symbol.for('alexify.protoarray.fallback');

// metaschema shorthands that have no positional form here (`union` has one,
// but only as `{ union: [...] }`): rejected loudly so a shared definition
// never silently changes meaning.
const UNSUPPORTED = /^(one|many|union)$/;
// The keys that open a collection, as a shorthand (`{ set: T }`) or as the
// type of a long form (`{ type: 'set', value: T }`).
const COLLECTIONS = /^(array|set|map|object|tuple|schema)$/;
// Names a tuple element cannot have: metaschema reads `{ array: 'number' }` as
// a definition, not as an element named `array`.
const KEYWORDS = /^(type|array|set|map|object|tuple|schema|enum|flags|union|one|many)$/;
// The object forms of a field, which may carry `aliases`: a struct's own keys
// are its fields.
const FORMS = /^(type|enum|flags|union|array|set|map|object|tuple|schema)$/;
// A default is the decoded value itself, so only primitive-valued types have one.
const DEFAULTABLE = /^(string|number|integer|boolean|json|enum)$/;

const isSchema = (value) => value !== null && typeof value === 'object' && value[BRAND] === true;

// A compiled schema in a slot: the codec it runs, the codec that checks
// values for Schema#check, compiled when first asked for, and the schema
// itself, whose plan Schema.resolve reads.
const slotOf = (schema) => ({
  codec: schema[CODEC],
  schema,
  get checker() {
    return schema[CHECKER];
  },
});

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

  // Enum values travel as an index and flags as bits, so their number is free.
  const list = (values, code, path) => {
    const bits = code === 'ERR_INVALID_FLAGS';
    const names = Array.isArray(values) ? values.map(String) : [];
    const valid =
      names.length > 0 &&
      new Set(names).size === names.length &&
      !names.includes('__proto__') &&
      values.every((value) => typeof value === 'string' || (typeof value === 'number' && !bits));
    if (!valid) {
      const expected = bits ? 'unique names' : 'unique strings or numbers';
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
    if (isSchema(target)) return { kind: 'ref', name, slot: slotOf(target) };
    throw error('ERR_UNKNOWN_REFERENCE', `Unknown reference "${name}"`, path);
  };

  const typed = (text, path) => {
    const optional = text.startsWith('?');
    const node = typeNode(optional ? text.slice(1) : text, path);
    return { node, required: !optional && node.nullable !== true, def: null };
  };

  // A tuple element is a definition of its own, or a named one as in
  // metaschema: `{ x: 'number' }`, `{ 'y?': 'string' }`. The name does not
  // travel; a trailing `?` makes the element optional.
  const nameOf = (element) => {
    const keys = isPlain(element) ? Object.keys(element) : [];
    if (keys.length !== 1 || typeof element[keys[0]] !== 'string') return null;
    const name = keys[0].endsWith('?') ? keys[0].slice(0, -1) : keys[0];
    if (KEYWORDS.test(name) || SCALARS[name] !== undefined || /^[A-Z]/.test(name)) return null;
    return keys[0];
  };

  const tuple = (elements, path) => {
    if (!Array.isArray(elements)) {
      throw error('ERR_INVALID_DEFINITION', 'A tuple needs a list of elements', path);
    }
    if (elements.length === 0) throw error('ERR_INVALID_DEFINITION', 'An empty tuple', path);
    const items = elements.map((element, i) => {
      const name = nameOf(element);
      const parsed = field(name === null ? element : element[name], `${path}[${i}]`);
      const required = parsed.required && (name === null || !name.endsWith('?'));
      return { node: parsed.node, required, def: parsed.def };
    });
    return { kind: 'tuple', items };
  };

  // A collection in the shorthand (`{ map: { string: 'number' } }`) or the
  // long form (`{ type: 'map', key: 'string', value: 'number' }`). Map keys
  // are strings or numbers, object keys strings: they travel as JSON keys.
  const collection = (kind, source, short, path) => {
    const required = source.required !== false;
    if (kind === 'schema') {
      const inner = field(short === undefined ? source.schema : short, path);
      return { node: inner.node, required, def: null };
    }
    if (kind === 'tuple') return { node: tuple(short ?? source.value, path), required, def: null };
    if (kind === 'array' || kind === 'set') {
      const item = field(short ?? source.value, `${path}[]`);
      const node = { kind: 'array', item: item.node, itemRequired: item.required, layout: 'rows' };
      if (kind === 'set') node.container = 'set';
      return { node, required, def: null };
    }
    let key = source.key;
    let value = source.value;
    if (isPlain(short)) {
      key = Object.keys(short)[0];
      value = short[key];
    }
    const keys = kind === 'map' ? /^(string|number)$/ : /^string$/;
    if (typeof key !== 'string' || !keys.test(key) || value === undefined) {
      const text =
        kind === 'map'
          ? 'A map needs { string | number: type }'
          : 'An object needs { string: type }';
      throw error('ERR_INVALID_DEFINITION', text, path);
    }
    const parsed = field(value, `${path}{}`);
    const node = { kind: kind === 'map' ? 'map' : 'dict', value: parsed.node };
    node.valueRequired = parsed.required;
    if (kind === 'map') node.key = SCALARS[key]();
    return { node, required, def: null };
  };

  // The keys a field was known by in older versions, read by Schema.resolve
  // only: they never reach the wire or the fingerprint.
  const aliasesOf = (source, path) => {
    const keys = source.aliases;
    const valid =
      Array.isArray(keys) &&
      keys.every((key) => typeof key === 'string' && key !== '' && key !== '__proto__') &&
      new Set(keys).size === keys.length;
    if (!valid) throw error('ERR_INVALID_DEFINITION', 'aliases is a list of unique keys', path);
    return keys.slice();
  };

  const field = (source, path) => {
    const parsed = parse(source, path);
    if (isPlain(source) && source.aliases !== undefined && FORMS.test(Object.keys(source)[0])) {
      parsed.aliases = aliasesOf(source, path);
    }
    return parsed;
  };

  // A field in any of the metaschema spellings: a Schema instance, a type
  // name with an optional `?`, a tuple, a shorthand (`{ array }`, `{ enum }`,
  // `{ flags }`), the long form (`{ type, required, default }`) or a struct.
  const parse = (source, path) => {
    if (isSchema(source)) {
      const node = source[PLAN];
      if (node.kind === 'scalar') {
        const { required, ...plain } = node;
        return { node: plain, required, def: null };
      }
      // A compiled schema is used as it is, with its own options, exactly like
      // a reference by name: its codec is called through a slot.
      return { node: { ...node, slot: slotOf(source) }, required: true, def: null };
    }
    if (typeof source === 'string') return typed(source, path);
    if (Array.isArray(source)) return { node: tuple(source, path), required: true, def: null };
    if (!isPlain(source)) throw error('ERR_INVALID_DEFINITION', 'Unexpected definition', path);
    const keys = Object.keys(source);
    const first = keys[0];
    const required = source.required !== false;
    if (COLLECTIONS.test(first)) return collection(first, source, source[first], path);
    if (first === 'type' && typeof source.type === 'string' && COLLECTIONS.test(source.type)) {
      return collection(source.type, source, undefined, path);
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
      // A valid long form in metaschema too, where an unknown option is kept.
      if (source.decimals !== undefined) {
        const n = source.decimals;
        if (node.type !== 'number' || !Number.isInteger(n) || n < 0 || n > 15) {
          throw error(
            'ERR_INVALID_DEFINITION',
            'decimals is an integer from 0 to 15 on a number',
            path,
          );
        }
        node = decimal(n);
      }
      const hasDefault = source.default !== undefined && node.kind === 'scalar';
      // -0 has no JSON form and would tell the two backends apart.
      const def = hasDefault ? (source.default === 0 ? 0 : source.default) : null;
      const valid = node.type !== 'integer' || Number.isInteger(def);
      if (def !== null && (!isPrimitive(def) || !DEFAULTABLE.test(node.type) || !valid)) {
        throw error(
          'ERR_INVALID_DEFINITION',
          'A default must be a string, number or boolean',
          path,
        );
      }
      return { node, required: required && !hasDefault && node.nullable !== true, def };
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
      // The tag always travels, so the discriminator is neither optional nor defaulted.
      if (tag === null || tag.node.type !== 'enum' || !tag.required || tag.def !== null) {
        throw error(
          'ERR_INVALID_UNION',
          `A branch must be a struct with the required enum "${key}" without a default`,
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
      const entry = {
        key,
        index: fields.length,
        required: parsed.required && !optional,
        def: parsed.def,
        node: parsed.node,
      };
      if (parsed.aliases !== undefined) entry.aliases = parsed.aliases;
      fields.push(entry);
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
    if (node.kind !== 'struct') {
      throw error('ERR_INVALID_OPTIONS', 'sparse needs a struct', '');
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
  // A plan from Schema.resolve prints as its writer: the wire it reads.
  if (node.text !== undefined) return node.text;
  if (node.kind === 'struct') {
    const fields = node.fields.map((field) => {
      const def = field.def === null ? '' : `=${JSON.stringify(field.def)}`;
      return `${field.key}:${field.required ? '' : '?'}${canonical(field.node)}${def}`;
    });
    return `${node.sparse ? 'sparse' : ''}{${fields.join(',')}}`;
  }
  if (node.kind === 'array') {
    const layout = node.layout === 'rows' ? '' : node.layout;
    const container = node.container === undefined ? '' : node.container;
    return `${layout}${container}[${node.itemRequired ? '' : '?'}${canonical(node.item)}]`;
  }
  if (node.kind === 'map' || node.kind === 'dict') {
    const value = `${node.valueRequired ? '' : '?'}${canonical(node.value)}`;
    return node.kind === 'map' ? `map<${node.key.type},${value}>` : `object<${value}>`;
  }
  if (node.kind === 'tuple') {
    const items = node.items.map((item) => {
      const def = item.def === null ? '' : `=${JSON.stringify(item.def)}`;
      return (item.required ? '' : '?') + canonical(item.node) + def;
    });
    return `(${items.join(',')})`;
  }
  if (node.kind === 'ref') return `@${node.name}`;
  if (node.kind === 'union') {
    return `union(${node.key})[${node.branches.map((branch) => canonical(branch.source)).join('|')}]`;
  }
  const values = node.values || node.names;
  let type = values === undefined ? node.type : `${node.type}(${values.join('|')})`;
  if (node.decimals !== undefined) type = `${type}(${node.decimals})`;
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

module.exports = {
  BRAND,
  PLAN,
  CODEC,
  CHECKER,
  FALLBACK,
  isSchema,
  compilePlan,
  canonical,
  fingerprint,
};
