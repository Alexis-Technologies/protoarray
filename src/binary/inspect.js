// What the binary wire makes of a plan before a codec is built, shared by
// ../binary.js and ../standalone.js (which writes binary codecs into modules
// without the backends): `inspect` refuses what the wire has no form for and
// collects the nodes a resolved plan compiles for its inner recursions,
// `readsNumbers` says whether a codec reads a float64, and the shape of the
// wire's nodes is read by both backends (./generate.js, ./closures.js) from
// the helpers below, so they cannot disagree on it.

const { SchemaDefinitionError, step, join } = require('../errors.js');
const { PLAN, children } = require('../plan.js');
const { WORD } = require('../types.js');

// An enum index or a union tag over this many values takes a varint.
const BYTE = 256;
const byteTag = (node) => node.values.length <= BYTE;
const wordsOf = (node) => Math.ceil(node.names.length / WORD);

// A boolean field of a struct travels in the struct's header.
const inHeader = (node) => node.kind === 'scalar' && node.type === 'boolean';

// The node whose form a value has on the wire: the writer's for a resolved
// node that carries one (Schema.resolve), its own otherwise.
const wireOf = (node) => (node.writer === undefined ? node : node.writer);

// A boolean of the writer that the reader drops (Schema.resolve): a bit of
// the header that reads as null.
const droppedBit = (node) => node.writer !== undefined && inHeader(node.writer);

// A node without the slot it was placed with: the plan of a codec of its own.
const detached = (node) => {
  const copy = { ...node };
  delete copy.slot;
  return copy;
};

// What the binary wire has no form for, named by its path as the errors
// spell it, and the nodes a resolved plan compiles for its inner recursions
// (resolve.js: a pair of schemas met again while it is resolved calls a codec
// of its own, through a slot without a schema), by slot. A schema a slot
// holds checks its own plan when its codec is built; a resolved node reads
// the writer's wire, so what that has no form for is refused too.
const inspect = (plan, name) => {
  const inner = new Map();
  const refuse = (what, path) => {
    const where = path === '' ? '' : ` at "${path}"`;
    const text = `The binary wire has no form for ${what}${where}`;
    throw new SchemaDefinitionError('ERR_NO_BINARY_FORM', text, name, path);
  };
  const walk = (node, path) => {
    // A union branch the reader has no values of (Schema.resolve) has no node.
    if (node === null) return;
    if (node.writer !== undefined) walk(node.writer, path);
    if (node.kind === 'scalar') {
      if (node.intern === true) refuse('an interned string', path);
      if (node.delta === true || node.type === 'deltas') refuse('a list of differences', path);
      return;
    }
    if (node.kind === 'array' && node.layout !== 'rows') refuse(`the ${node.layout} layout`, path);
    if (node.kind === 'ref') return;
    if (node.slot !== undefined) {
      if (node.slot.schema !== undefined) return;
      inner.set(node.slot, detached(node));
    }
    if (node.kind === 'struct') {
      for (const field of node.fields) walk(field.node, join(path, step(field.key)));
    } else if (node.kind === 'union') {
      node.branches.forEach((branch, i) => walk(branch.node, `${path}[${i}]`));
    } else if (node.kind === 'tuple') {
      node.items.forEach((item, i) => walk(item.node, `${path}[${i}]`));
    } else if (node.kind === 'array') walk(node.item, `${path}[]`);
    else walk(node.value, `${path}{}`);
  };
  walk(plan, '');
  return inner;
};

// Whether a codec of the schema, or of a schema it reaches, reads a float64:
// the reader makes its view only then. A resolved node reads the writer's
// wire; a recursion inside a resolved plan is walked where its node stands.
const readsNumbers = (schema) => {
  const seen = new Set([schema]);
  const walk = (node) => {
    if (node === null) return false;
    if (node.writer !== undefined && walk(node.writer)) return true;
    if (node.slot !== undefined) {
      const target = node.slot.schema;
      if (target !== undefined) {
        if (seen.has(target)) return false;
        seen.add(target);
        return walk(target[PLAN]);
      }
      if (node.kind === 'ref') return false;
    }
    if (node.kind === 'scalar') return node.type === 'number' && node.decimals === undefined;
    if (node.kind === 'map' && node.key.type === 'number') return true;
    return children(node).some(walk);
  };
  return walk(schema[PLAN]);
};

module.exports = { inspect, readsNumbers, byteTag, wordsOf, inHeader, wireOf, droppedBit };
