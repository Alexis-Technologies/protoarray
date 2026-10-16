// Schema.resolve: reading what another version of a schema wrote, and writing
// for it. The writer's plan says where every value is on the wire, the
// reader's plan which key, type and default it has in the object. Resolving
// walks the two together into a third plan: the writer's positions under the
// reader's keys, which either backend compiles like any other plan, so the
// result is as fast as a schema of its own.
//
// A resolved struct keeps the writer's fields in wire order; each one has the
// reader's `key` (null for one the reader does not have, which decode skips
// and encode writes as null) and the reader's `required` and `def` for
// decode. `order` is the reader's key order for the decoded object and
// `extras` the reader's fields the writer does not have, decoded as their
// default; a tuple's `skip` items and `extras` play the part of a struct's
// skipped fields and extras.
//
// The `@alexify/protoarray/resolve` subpath: kept out of the core, which does
// not need it; `register()` installs `Schema.resolve`.

const { SchemaDefinitionError, overflowed, join, step } = require('./errors.js');
const { PLAN, canonical, isSchema } = require('./plan.js');
const { bridge } = require('./types.js');
const { Schema, SETTINGS, SAME, INTERNAL, inherited } = require('./schema.js');

// What a slot falls back to when the writer's value has no reader value (an
// enum value the reader dropped): its default, null for an optional slot,
// undefined (an error) for a required one.
const fallbackOf = (required, def) => (def !== null ? def : required ? undefined : null);

const resolvePlan = (writerPlan, readerPlan, context) => {
  const error = (text, path) => {
    const message = path === '' ? text : `${text} at "${path}"`;
    return new SchemaDefinitionError('ERR_INCOMPATIBLE', message, context.name, path);
  };

  // The reader paths of the `aliases` option a field of the reader was met at.
  const named = new Set();

  // Every pair of schemas met at a schema boundary (an embedded schema, a
  // reference, the roots) resolves once: a pair met again while it is being
  // resolved is a recursion, and calls a codec compiled for it.
  const pairs = new Map();
  const compiled = [];

  // A schema reached through a slot (an entity, a nested layout) stands for
  // its own plan, an alias for the plan of what it stands for.
  const target = (node) => {
    let out = node;
    while (out.slot !== undefined) out = out.slot.schema[PLAN];
    return out;
  };

  const isJson = (node) => node.kind === 'scalar' && node.type === 'json';
  const isNull = (node) => node.kind === 'scalar' && node.type === 'null';

  const scalar = (w, r, path, fallback) => {
    const from = canonical(w);
    const to = canonical(r);
    if (from === to) return r;
    // The same type on another wire (an interned string, a number written as
    // differences): the writer's node reads its own wire.
    if (from.replace(/[*~]$/, '') === to.replace(/[*~]$/, '')) return w;
    // Widening that needs no conversion: what the writer's node decodes to is
    // a value of the reader's type.
    const integer = w.type === 'integer' || (w.type === 'number' && w.decimals === 0);
    if (r.type === 'number' && (integer || w.type === 'number')) {
      if (r.decimals === undefined || integer) return w;
      if (w.decimals !== undefined && w.decimals <= r.decimals) return w;
    }
    if (w.type === 'integer' && r.type === 'bigint') return bridge.bigint();
    if (w.type === 'enum' && r.type === 'enum') return bridge.enumeration(w, r, fallback);
    if (w.type === 'enum' && r.type === 'string') {
      if (w.values.every((value) => typeof value === 'string')) {
        return bridge.enumeration(w, r, fallback);
      }
    }
    if (w.type === 'string' && r.type === 'enum') return bridge.choice(r, fallback);
    if (w.type === 'flags' && r.type === 'flags') return bridge.flags(w, r);
    throw error(`Cannot read ${from} as ${to}`, path);
  };

  // One slot of a struct, a collection or a tuple, with the reader's
  // optionality and default.
  const slot = (w0, r0, path, required, def) => {
    const w = target(w0);
    const r = target(r0);
    // A json slot takes whatever the writer's node decodes to.
    if (isJson(r)) return w0;
    if (isNull(w)) {
      if (required && def === null) {
        throw error('The writer always sends null where the reader requires a value', path);
      }
      return w;
    }
    if (isNull(r)) return bridge.ignore();
    // A list written as differences reads as a plain one, and a plain one as
    // a list the reader writes as differences.
    if (canonical(w) === `~${canonical(r)}` || `~${canonical(w)}` === canonical(r)) return w;
    if (w.kind === 'scalar' && r.kind === 'scalar') {
      return scalar(w, r, path, fallbackOf(required, def));
    }
    return resolve(w0, r0, path);
  };

  // A schema boundary or the roots: resolved once per pair. A collection
  // layout other than rows only exists at a root, so one met inside a record
  // gets a codec of its own, as an embedded schema has.
  const resolve = (w0, r0, path) => {
    const boundary = w0.slot !== undefined || r0.slot !== undefined || path === '';
    if (!boundary) return shape(w0, r0, path);
    const w = target(w0);
    const r = target(r0);
    let byReader = pairs.get(w);
    if (byReader === undefined) pairs.set(w, (byReader = new Map()));
    let entry = byReader.get(r);
    if (entry !== undefined) {
      if (entry.node !== null) return entry.node;
      if (entry.slot === null) entry.slot = { codec: null };
      return { kind: 'ref', name: context.name, slot: entry.slot };
    }
    entry = { node: null, slot: null, plan: null };
    byReader.set(r, entry);
    entry.plan = shape(w, r, path);
    const layout = entry.plan.kind === 'array' && entry.plan.layout !== 'rows';
    if (layout && path !== '' && entry.slot === null) entry.slot = { codec: null };
    entry.node = entry.slot === null ? entry.plan : { ...entry.plan, slot: entry.slot };
    if (entry.slot !== null) compiled.push(entry);
    return entry.node;
  };

  const shape = (w, r, path) => {
    if (w.kind !== r.kind) throw error(`Cannot read ${canonical(w)} as ${canonical(r)}`, path);
    if (w.kind === 'struct') return struct(w, r, path);
    if (w.kind === 'union') return union(w, r, path);
    if (w.kind === 'tuple') return tuple(w, r, path);
    const item = w.kind === 'array' ? 'item' : 'value';
    const required = w.kind === 'array' ? 'itemRequired' : 'valueRequired';
    if (w.kind === 'map' && canonical(w.key) !== canonical(r.key)) {
      throw error(`Cannot read ${canonical(w)} as ${canonical(r)}`, path);
    }
    const at = w.kind === 'array' ? `${path}[]` : `${path}{}`;
    const node = { ...r, [item]: slot(w[item], r[item], at, r[required], null) };
    if (w.kind === 'array') node.layout = w.layout;
    return node;
  };

  const struct = (w, r, path) => {
    const byKey = new Map();
    for (const field of w.fields) byKey.set(field.key, field);
    const fields = w.fields.map((field) => ({
      key: null,
      wire: field.key,
      index: field.index,
      required: false,
      def: null,
      node: field.node,
    }));
    const extras = [];
    for (const field of r.fields) {
      const at = join(path, step(field.key));
      const given = context.aliases[at];
      if (given !== undefined) named.add(at);
      const names = [field.key, ...(field.aliases || []), ...(given || [])];
      let match;
      for (const name of names) {
        const candidate = byKey.get(name);
        if (candidate !== undefined && fields[candidate.index].key === null) {
          match = candidate;
          break;
        }
      }
      if (match === undefined) {
        if (field.required) {
          throw error(`Field "${field.key}" is required and the writer does not have it`, at);
        }
        extras.push({ key: field.key, def: field.def });
        continue;
      }
      const resolved = fields[match.index];
      resolved.key = field.key;
      resolved.required = field.required;
      resolved.def = field.def;
      resolved.node = slot(match.node, field.node, at, field.required, field.def);
    }
    const keys = r.keys.slice();
    return { kind: 'struct', fields, keys, order: keys, extras, sparse: w.sparse, tail: w.tail };
  };

  // Branches pair up by their discriminator values: the values of a writer
  // branch the reader has are in one reader branch, and the ones it dropped
  // are errors on decode, as is a writer branch the reader has no values of.
  // A branch split between two reader branches cannot be read.
  const union = (w, r, path) => {
    if (w.key !== r.key) {
      throw error(`Cannot read a union on "${w.key}" as one on "${r.key}"`, path);
    }
    const tags = new Map();
    const owners = [];
    r.values.forEach((value, i) => tags.set(value, i));
    r.branches.forEach((other, b) => {
      for (let i = 0; i < other.count; i++) owners.push(b);
    });
    const branches = [];
    for (const branch of w.branches) {
      const values = w.values.slice(branch.first, branch.first + branch.count);
      const at = values.map((value) => (tags.has(value) ? owners[tags.get(value)] : -1));
      const index = at.find((b) => b !== -1);
      if (index === undefined) {
        branches.push({ ...branch, node: null });
        continue;
      }
      if (!at.every((b) => b === -1 || b === index)) {
        throw error(`The values ${values.join(', ')} are split between branches`, path);
      }
      const reader = r.branches[index].node;
      const node = struct(branch.node, reader, `${path}[${index}]`);
      node.tag = { ...reader.tag, values: w.values };
      if (!at.includes(-1)) branches.push({ ...branch, node });
      else {
        // One entry a value: the ones the reader dropped have no branch.
        at.forEach((b, k) => {
          branches.push({
            ...branch,
            first: branch.first + k,
            count: 1,
            node: b === -1 ? null : node,
          });
        });
      }
    }
    return { kind: 'union', key: w.key, tag: w.tag, values: w.values, branches };
  };

  const tuple = (w, r, path) => {
    const items = w.items.map((item, i) => {
      const other = r.items[i];
      if (other === undefined) {
        return { node: item.node, required: false, def: null, skip: true };
      }
      const at = `${path}[${i}]`;
      const node = slot(item.node, other.node, at, other.required, other.def);
      return { node, required: other.required, def: other.def };
    });
    const extras = r.items.slice(w.items.length).map((item, i) => {
      if (item.required && item.def === null) {
        const at = `${path}[${w.items.length + i}]`;
        throw error('A required element the writer does not have', at);
      }
      return { def: item.def };
    });
    return { kind: 'tuple', items, extras };
  };

  // A root scalar keeps the reader's optionality, which is no part of the
  // type the two compare.
  let plan;
  if (writerPlan.kind === 'scalar' && readerPlan.kind === 'scalar') {
    const typed = (node) => ({ ...node, required: undefined });
    const node = slot(typed(writerPlan), typed(readerPlan), '', readerPlan.required, null);
    plan = { ...node, required: readerPlan.required };
  } else plan = isJson(readerPlan) ? target(writerPlan) : resolve(writerPlan, readerPlan, '');
  // A path no field of the reader is at would lose a value without a word.
  for (const path of Object.keys(context.aliases)) {
    if (named.has(path)) continue;
    const text = `Option "aliases" names no field of the reader at "${path}"`;
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, context.name, path);
  }
  return { plan, compiled };
};

// The `aliases` option: reader paths, as the errors spell them
// (`address.city`, `orders[].sku`), to the writer's keys.
const readAliases = (options, name) => {
  const invalid = (text) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, name);
  const aliases = Object.create(null);
  if (options == null) return aliases;
  if (typeof options !== 'object') throw invalid('Invalid options: expected an object');
  for (const key of Object.keys(options)) {
    if (key !== 'aliases') throw invalid(`Invalid option "${key}"`);
  }
  const source = options.aliases;
  if (source === undefined) return aliases;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw invalid('Invalid option "aliases"');
  }
  for (const path of Object.keys(source)) {
    const value = source[path];
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list) || !list.every((key) => typeof key === 'string' && key !== '')) {
      throw invalid(`Invalid aliases for "${path}"`);
    }
    aliases[path] = list;
  }
  return aliases;
};

// What `writer` wrote, read as `reader` objects, and `reader` objects written
// as `writer` writes them: the writer's wire and id under the reader's keys,
// types and defaults, matched by key, by the reader's aliases or by the
// `aliases` option. Compiled like any schema.
const resolve = (writer, reader, options) => {
  if (!isSchema(writer) || !isSchema(reader)) {
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
  }
  // A resolved schema reads one version as another: it is no version itself.
  if (writer[PLAN].text !== undefined || reader[PLAN].text !== undefined) {
    const text = 'A resolved schema is no version to resolve: give its writer or its reader';
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text);
  }
  const aliases = readAliases(options, reader.name);
  // The same version, the entities it references included: nothing to bridge.
  if (writer[SAME](reader)) return reader;
  const text = writer.toString();
  const context = { name: reader.name, aliases };
  try {
    const { plan, compiled } = resolvePlan(writer[PLAN], reader[PLAN], context);
    return new Schema(reader.name, null, {
      ...inherited(reader[SETTINGS]),
      fingerprint: writer[SETTINGS].fingerprint,
      [INTERNAL]: { plan, compiled, text, writer, id: writer.id },
    });
  } catch (error) {
    // Two versions are walked together, a chain of references included: one
    // too long for the stack cannot be resolved, which is no RangeError.
    if (!overflowed(error)) throw error;
    const message = 'The schemas are nested too deeply to resolve';
    throw new SchemaDefinitionError('ERR_INCOMPATIBLE', message, reader.name, '', error);
  }
};

let registered = false;

// Installs `Schema.resolve`, non-enumerable, once.
const register = () => {
  if (registered) return;
  registered = true;
  Object.defineProperty(Schema, 'resolve', {
    value: resolve,
    writable: true,
    configurable: true,
  });
};

module.exports = { resolve, register };
