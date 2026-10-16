// Reads a schema out of metaschema's snapshot (format 1: `schema.toSnapshot()`,
// `model.toJSON()`) into a plan, the tree of nodes both backends compile. The
// snapshot is plain JSON with a written contract, so protoarray needs nothing
// of metaschema to read it, and a snapshot may come from anywhere: a server,
// a file, a build step. It is read as untrusted input.
//
// The options that shape the wire rather than the data name their places by
// path, as the errors do: `address.city`, `orders[].sku` (an item), `scores{}`
// (a dictionary's value), `pair[1]` (a tuple's element), `''` the root.

const { SchemaDefinitionError } = require('./errors.js');
const { SCALARS, enumeration, flags, decimal, interned, deltas } = require('./types.js');

const FORMAT = 1;
// Deeper than any schema a person writes, shallow enough for the stack.
const DEPTH = 64;
const LAYOUTS = /^(rows|flat|columns)$/;
// The types whose wire is an integer, or can be checked to be one: they travel
// as differences with `delta`.
const INTEGERS = /^(integer|number|date)$/;
// A default is the decoded value itself, so only primitive-valued types have one.
const DEFAULTABLE = /^(string|number|integer|boolean|json|enum)$/;
// The types of metaschema that open a structure rather than name a scalar.
const FORMS = /^(enum|flags|array|set|map|object|tuple|schema|union)$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A function of the definition (a calculated field, a validate, a default
// factory) has no JSON form: the snapshot writes it as `{ $function: true }`.
const isFunction = (value) => isObject(value) && value.$function === true;

const isPrimitive = (value) => {
  const type = typeof value;
  return type === 'string' || type === 'boolean' || (type === 'number' && Number.isFinite(value));
};

const isSnapshot = (value) =>
  isObject(value) && value.format === FORMAT && isObject(value.entities);

// A list of unique names or values, as enum and flags take them: values are
// strings or numbers (an enum's only), never `__proto__`.
const listOf = (values, numbers) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const seen = new Set();
  for (const value of values) {
    const type = typeof value;
    if (type !== 'string' && !(numbers && type === 'number' && Number.isFinite(value))) return null;
    if (value === '__proto__' || seen.has(String(value))) return null;
    seen.add(String(value));
  }
  return values.slice();
};

// The place a key holds under its parent, as the errors name it.
const at = (path, key) => (path === '' ? key : `${path}.${key}`);

// `context`: `name` (of the schema, for errors), `entity` (the entity read),
// `snapshot`, `selfSlot`, `slotOf(name)` (the slot of another entity, built on
// demand), `references` ('kind', 'embed' or 'id'), `types` (custom type names
// to wire types) and the options by path: `internAll`, `intern`, `delta`,
// `sparse` (Sets of paths) and `layout` (a Map of path to layout).
const readSnapshot = (context) => {
  const { snapshot } = context;
  const used = new Set();

  const error = (code, text, path) => {
    const message = path === '' ? text : `${text} at "${path}"`;
    return new SchemaDefinitionError(code, message, context.name, path);
  };
  const broken = (text, path) => error('ERR_INVALID_SNAPSHOT', text, path);
  const misplaced = (option, text, path) => {
    const where = path === '' ? '' : ` at "${path}"`;
    const message = `Option "${option}" ${text}${where}`;
    return new SchemaDefinitionError('ERR_INVALID_OPTIONS', message, context.name, path);
  };

  // Whether an option names this place; the ones that name no place are
  // reported once the whole schema has been read.
  const marked = (option, path) => {
    if (!context[option].has(path)) return false;
    used.add(`${option}\u0000${path}`);
    return true;
  };

  // A string slot is interned on request, everywhere or at its path.
  const scalar = (type, path) => {
    const intern = marked('intern', path);
    if (type === 'string' && (intern || context.internAll)) return interned();
    if (intern) throw misplaced('intern', 'takes a string', path);
    return SCALARS[type]();
  };

  // The built-in type a custom one stands for: an alias (`{ money: { js:
  // 'number' } }`) down its chain, or the wire type the `types` option gives a
  // type with a check of its own.
  const baseOf = (name, path) => {
    const types = isObject(snapshot.types) ? snapshot.types : {};
    let current = name;
    for (let hops = 0; hops < DEPTH; hops++) {
      if (SCALARS[current] !== undefined || FORMS.test(current)) return current;
      const entry = Object.hasOwn(types, current) ? types[current] : undefined;
      if (!isObject(entry)) break;
      if (typeof entry.js === 'string') {
        current = entry.js;
        continue;
      }
      const wire = context.types[current];
      if (wire !== undefined) return wire;
      const text = `Type "${current}" checks values of its own: give it a wire type in "types"`;
      throw error('ERR_UNKNOWN_TYPE', text, path);
    }
    throw error('ERR_UNKNOWN_TYPE', `Unknown type "${name}"`, path);
  };

  // A reference by the name of an entity: the record itself or its id, as
  // metaschema's check reads it (`embeds` there): the call's mode, then the
  // field's `embed`, then the store of the target's kind.
  const reference = (source, path) => {
    const many = source.many !== undefined;
    const name = many ? source.many : source.one;
    if (typeof name !== 'string' || name === '') throw broken('A reference needs a name', path);
    const target = Object.hasOwn(snapshot.entities, name) ? snapshot.entities[name] : undefined;
    let embed;
    if (context.references !== 'kind') embed = context.references === 'embed';
    else if (typeof source.embed === 'boolean') embed = source.embed;
    else if (isObject(target)) embed = target.store !== 'persistent';
    if (embed === undefined || (embed && !isObject(target))) {
      throw error('ERR_UNKNOWN_REFERENCE', `Unknown reference "${name}"`, path);
    }
    let node;
    if (!embed) node = scalar('string', many ? `${path}[]` : path);
    else {
      const slot = name === context.entity ? context.selfSlot : context.slotOf(name);
      node = { kind: 'ref', name, slot };
    }
    if (!many) return node;
    return { kind: 'array', item: node, itemRequired: true, layout: 'rows' };
  };

  // The differences of a list or a column, on request.
  const differences = (node, path) => {
    if (!marked('delta', path)) return node;
    const integral = (item) =>
      item.kind === 'scalar' && (INTEGERS.test(item.type) || item.decimals !== undefined);
    if (node.kind === 'array' && node.container === undefined && integral(node.item)) {
      return deltas(node.item, node.itemRequired);
    }
    if (!integral(node) || node.intern === true) {
      const text = 'takes an integer, a number, a date or decimals, or a list of them';
      throw misplaced('delta', text, path);
    }
    node.delta = true;
    return node;
  };

  // A struct as a sparse record, a collection of records in a layout: both on
  // request, by path.
  const shaped = (node, path) => {
    let out = node;
    if (marked('sparse', path)) {
      if (out.kind !== 'struct') throw misplaced('sparse', 'takes a struct', path);
      out = { ...out, sparse: true };
    }
    if (marked('layout', path)) {
      const layout = context.layout.get(path);
      if (layout !== 'rows') {
        if (out.kind !== 'array' || out.item.kind !== 'struct' || out.item.sparse) {
          throw misplaced('layout', `"${layout}" takes an array of records`, path);
        }
        out = { ...out, layout };
        // The backends lay out a root collection: one inside a record is
        // compiled as a root of its own and called through its slot. The slot
        // goes on a copy, so the plan of that root has none of its own.
        if (path !== '') out = { ...out, slot: context.nested(out) };
      }
    }
    return out;
  };

  // A field of the snapshot: `{ node, required, def, aliases? }`.
  const field = (source, path, depth) => {
    if (depth > DEPTH) throw broken('The schema is nested too deeply', path);
    if (!isObject(source) || typeof source.type !== 'string') {
      throw broken('A field needs a type', path);
    }
    const parsed = typeOf(source, path, depth);
    // Only a string slot takes the intern option (scalar() marks it there).
    if (context.intern.has(path) && !used.has(`intern\u0000${path}`)) {
      throw misplaced('intern', 'takes a string', path);
    }
    const node = differences(shaped(parsed, path), path);
    let required = source.required !== false && source.nullable !== true;
    // A schema of one type held as a field keeps its own optionality: metaschema
    // checks null against it.
    const inner = source.schema;
    if (isObject(inner) && typeof inner.type === 'string') {
      if (inner.required === false || inner.nullable === true) required = false;
    }
    if (node.nullable === true) required = false;
    let def = null;
    const value = source.default;
    // A default the wire has no use for (a factory, a Date, a bigint) stays
    // metaschema's to apply; -0 has no JSON form and would tell the backends
    // apart.
    if (
      value !== undefined &&
      node.kind === 'scalar' &&
      isPrimitive(value) &&
      DEFAULTABLE.test(node.type) &&
      (node.type !== 'integer' || Number.isInteger(value))
    ) {
      def = value === 0 ? 0 : value;
      required = false;
    }
    const out = { node, required, def };
    if (source.aliases !== undefined) out.aliases = aliasesOf(source.aliases, path);
    return out;
  };

  // The keys a field was known by in older versions, read by Schema.resolve
  // only: they never reach the wire or the fingerprint.
  const aliasesOf = (keys, path) => {
    const valid =
      Array.isArray(keys) &&
      keys.every((key) => typeof key === 'string' && key !== '' && key !== '__proto__') &&
      new Set(keys).size === keys.length;
    if (!valid) throw broken('aliases is a list of unique keys', path);
    return keys.slice();
  };

  const typeOf = (source, path, depth) => {
    const { type } = source;
    if (source.one !== undefined || source.many !== undefined) return reference(source, path);
    const base = baseOf(type, path);
    if (base === 'enum') {
      const values = listOf(source.enum, true);
      if (values === null) {
        throw error('ERR_INVALID_ENUM', 'Expected unique strings or numbers', path);
      }
      return enumeration(values);
    }
    if (base === 'flags') {
      const names = listOf(source.flags, false);
      if (names === null) throw error('ERR_INVALID_FLAGS', 'Expected unique names', path);
      return flags(names);
    }
    if (base === 'array' || base === 'set') {
      const item = field(source.value, `${path}[]`, depth + 1);
      const node = { kind: 'array', item: item.node, itemRequired: item.required, layout: 'rows' };
      if (base === 'set') node.container = 'set';
      return node;
    }
    if (base === 'map' || base === 'object') {
      const key = source.key;
      const valid = base === 'map' ? key === 'string' || key === 'number' : key === 'string';
      if (!valid) throw broken(`${base === 'map' ? 'A map' : 'An object'} needs a key type`, path);
      const value = field(source.value, `${path}{}`, depth + 1);
      const node = { kind: base === 'map' ? 'map' : 'dict', value: value.node };
      node.valueRequired = value.required;
      if (base === 'map') node.key = SCALARS[key]();
      return node;
    }
    if (base === 'tuple') return tuple(source.value, path, depth);
    if (base === 'schema') {
      const inner = source.schema;
      // A schema of one type held as a field is that type's snapshot; the
      // field around it says whether it is required.
      if (isObject(inner) && typeof inner.type === 'string') {
        if (depth > DEPTH) throw broken('The schema is nested too deeply', path);
        return typeOf(inner, path, depth + 1);
      }
      return struct(inner, path, depth + 1);
    }
    if (base === 'union') return union(source, path, depth);
    if (source.decimals !== undefined) {
      const n = source.decimals;
      if (base !== 'number' || !Number.isInteger(n) || n < 0 || n > 15) {
        throw broken('decimals is an integer from 0 to 15 on a number', path);
      }
      return decimal(n);
    }
    return scalar(base, path);
  };

  const tuple = (elements, path, depth) => {
    if (!Array.isArray(elements) || elements.length === 0) {
      throw broken('A tuple needs a list of elements', path);
    }
    const items = elements.map((element, i) => {
      const parsed = field(element, `${path}[${i}]`, depth + 1);
      return { node: parsed.node, required: parsed.required, def: parsed.def };
    });
    return { kind: 'tuple', items };
  };

  const struct = (source, path, depth) => {
    if (!isObject(source)) throw broken('A struct needs its fields', path);
    const fields = [];
    for (const key of Object.keys(source)) {
      const raw = source[key];
      // A calculated field and the struct's own functions have no position.
      if (isFunction(raw)) continue;
      const place = at(path, key);
      if (key === '__proto__') throw error('ERR_RESERVED_KEY', 'Reserved key "__proto__"', place);
      if (/^\d+$/.test(key)) {
        const text = `Integer-like key "${key}": JavaScript orders it first`;
        throw error('ERR_INTEGER_KEY', text, place);
      }
      if (key === '') throw error('ERR_INVALID_DEFINITION', 'Invalid key ""', place);
      const parsed = field(raw, place, depth);
      const entry = {
        key,
        index: fields.length,
        required: parsed.required,
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

  // A discriminated union: every branch is a struct whose discriminator field
  // is a required enum without a default. The wire is `[tag, ...the other
  // fields of the branch]`, the tag being the index of the discriminator value
  // among the values of all branches.
  const union = (source, path, depth) => {
    const key = source.discriminator;
    if (typeof key !== 'string' || key === '') {
      throw error('ERR_UNKNOWN_TYPE', 'A union needs a discriminator', path);
    }
    if (!Array.isArray(source.union) || source.union.length === 0) {
      throw error('ERR_INVALID_UNION', 'A union needs at least one branch', path);
    }
    const values = [];
    const branches = source.union.map((branch, i) => {
      const place = `${path}[${i}]`;
      const node = field(branch, place, depth + 1).node;
      const index = node.kind === 'struct' && !node.sparse ? node.keys.indexOf(key) : -1;
      const tag = index === -1 ? null : node.fields[index];
      // The tag always travels, so the discriminator is neither optional nor defaulted.
      if (tag === null || tag.node.type !== 'enum' || !tag.required || tag.def !== null) {
        throw error(
          'ERR_INVALID_UNION',
          `A branch must be a struct with the required enum "${key}" without a default`,
          place,
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
    const unique = listOf(values, true);
    if (unique === null) {
      throw error('ERR_INVALID_UNION', 'The values of the discriminator must be unique', path);
    }
    return { kind: 'union', key, tag: enumeration(unique), values, branches };
  };

  if (!isSnapshot(snapshot)) throw broken('A snapshot of format 1 with entities is expected', '');
  const entities = snapshot.entities;
  const entity = Object.hasOwn(entities, context.entity) ? entities[context.entity] : undefined;
  if (!isObject(entity)) {
    throw broken(`The snapshot has no entity "${context.entity}"`, '');
  }
  let node;
  if (entity.fields !== undefined) node = shaped(struct(entity.fields, '', 0), '');
  else {
    const root = field(entity.type, '', 0);
    node = root.node;
    // A root scalar keeps its own optionality; every other root is required.
    if (node.kind === 'scalar') node = { ...node, required: root.required };
  }
  for (const option of ['intern', 'delta', 'sparse', 'layout']) {
    const paths = option === 'layout' ? context.layout.keys() : context[option];
    for (const path of paths) {
      if (!used.has(`${option}\u0000${path}`)) {
        throw misplaced(option, 'names no place of the schema', path);
      }
    }
  }
  return node;
};

// The options by path, from what a caller gives: a boolean for the root (or,
// for intern, every string), a list of paths, a layout for the root or a
// record of paths to layouts.
const placesOf = (settings) => {
  const sparse = new Set(settings.sparse === true ? [''] : settings.sparse || []);
  const layout = new Map();
  const given = settings.layout;
  if (typeof given === 'string') {
    if (given !== 'rows') layout.set('', given);
  } else {
    for (const path of Object.keys(given)) layout.set(path, given[path]);
  }
  return {
    internAll: settings.intern === true,
    intern: new Set(Array.isArray(settings.intern) ? settings.intern : []),
    delta: new Set(settings.delta),
    sparse,
    layout,
  };
};

const isPaths = (value) => Array.isArray(value) && value.every((path) => typeof path === 'string');

const isLayouts = (value) =>
  (typeof value === 'string' && LAYOUTS.test(value)) ||
  (isObject(value) &&
    Object.keys(value).every(
      (path) => typeof value[path] === 'string' && LAYOUTS.test(value[path]),
    ));

module.exports = { FORMAT, isSnapshot, isObject, readSnapshot, placesOf, isPaths, isLayouts };
