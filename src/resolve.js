// Schema.resolve: reading what another version of a schema wrote, and writing
// for it. The writer's plan says where every value is on the wire, the
// reader's plan which key, type and default it has in the object. Resolving
// walks the two together into a third plan: the writer's positions under the
// reader's keys, which either backend compiles like any other plan, so the
// result is as fast as a schema of its own.
//
// A resolved struct keeps the writer's fields in wire order; each one has the
// reader's `key` (null for one the reader does not have, which decode skips
// and encode writes as null), the reader's `required` and `def` for decode and
// the writer's `encodeRequired` for encode. `order` is the reader's key order
// for the decoded object and `extras` the reader's fields the writer does not
// have, decoded as their default. Collections and tuples carry the same twin
// flags (`itemEncodeRequired`, `valueEncodeRequired`, an item's
// `encodeRequired`); a tuple's `skip` items and `extras` play the part of a
// struct's skipped fields and extras.

const { SchemaDefinitionError } = require('./errors.js');
const { PLAN, canonical } = require('./plan.js');
const { bridge } = require('./types.js');

// What a slot falls back to when the writer's value has no reader value (an
// enum value the reader dropped): its default, null for an optional slot,
// undefined (an error) for a required one.
const fallbackOf = (required, def) => (def !== null ? def : required ? undefined : null);

const resolvePlan = (writerPlan, readerPlan, context) => {
  const error = (text, path) => {
    const message = path === '' ? text : `${text} at "${path}"`;
    return new SchemaDefinitionError('ERR_INCOMPATIBLE', message, context.name, path);
  };

  // Every pair of schemas met at a schema boundary (an embedded schema, a
  // reference, the roots) resolves once: a pair met again while it is being
  // resolved is a recursion, and calls a codec compiled for it.
  const pairs = new Map();
  const compiled = [];

  // A schema used by value or by name stands for its own plan.
  const target = (node) => (node.slot !== undefined ? node.slot.schema[PLAN] : node);

  const isJson = (node) => node.kind === 'scalar' && node.type === 'json';
  const isNull = (node) => node.kind === 'scalar' && node.type === 'null';

  const scalar = (w, r, path, fallback) => {
    const from = canonical(w);
    const to = canonical(r);
    if (from === to) return r;
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
    node[w.kind === 'array' ? 'itemEncodeRequired' : 'valueEncodeRequired'] = w[required];
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
      encodeRequired: field.required,
      def: null,
      node: field.node,
    }));
    const extras = [];
    for (const field of r.fields) {
      const at = path === '' ? field.key : `${path}.${field.key}`;
      const names = [field.key, ...(field.aliases || []), ...(context.aliases[at] || [])];
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

  // Branches pair up by their discriminator values: every value of a writer
  // branch in one reader branch. A writer branch the reader has no values of
  // is dropped (its tag is an error on decode); one split between two reader
  // branches cannot be read.
  const union = (w, r, path) => {
    if (w.key !== r.key) {
      throw error(`Cannot read a union on "${w.key}" as one on "${r.key}"`, path);
    }
    const branches = w.branches.map((branch) => {
      const values = w.values.slice(branch.first, branch.first + branch.count);
      const at = values.map((value) => r.values.indexOf(value));
      const index = r.branches.findIndex(
        (other) => at[0] >= other.first && at[0] < other.first + other.count,
      );
      const inside = (i) =>
        i >= r.branches[index].first && i < r.branches[index].first + r.branches[index].count;
      if (index === -1 && at.every((i) => i === -1)) return { ...branch, node: null };
      if (index === -1 || !at.every(inside)) {
        throw error(`The values ${values.join(', ')} are split between branches`, path);
      }
      const reader = r.branches[index].node;
      const node = struct(branch.node, reader, `${path}[${index}]`);
      node.tag = { ...reader.tag, values: w.values };
      return { ...branch, node };
    });
    return { kind: 'union', key: w.key, tag: w.tag, values: w.values, branches };
  };

  const tuple = (w, r, path) => {
    const items = w.items.map((item, i) => {
      const other = r.items[i];
      if (other === undefined) {
        return {
          node: item.node,
          required: false,
          encodeRequired: item.required,
          def: null,
          skip: true,
        };
      }
      const at = `${path}[${i}]`;
      const node = slot(item.node, other.node, at, other.required, other.def);
      return { node, required: other.required, encodeRequired: item.required, def: other.def };
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

  // A root scalar keeps its own optionality: the reader's on decode, the
  // writer's on encode.
  let plan;
  if (writerPlan.kind === 'scalar' && readerPlan.kind === 'scalar') {
    const node = slot(writerPlan, readerPlan, '', readerPlan.required, null);
    plan = { ...node, required: readerPlan.required, encodeRequired: writerPlan.required };
  } else plan = isJson(readerPlan) ? target(writerPlan) : resolve(writerPlan, readerPlan, '');
  return { plan, compiled };
};

module.exports = { resolvePlan };
