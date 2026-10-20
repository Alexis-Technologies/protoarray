// What the binary wire makes of a plan before a codec is built, shared by
// ../binary.js and ../standalone.js (which writes binary codecs into modules
// without the backends): `inspect` refuses what the wire has no form for and
// collects the nodes a resolved plan compiles for its inner recursions,
// `readsNumbers` says whether a codec reads a float64.

const { SchemaDefinitionError, step } = require('../errors.js');
const { PLAN, children } = require('../plan.js');

// A field's key under its record's path, as the errors and the options spell it.
const at = (path, segment) =>
  path === '' ? segment : segment[0] === '[' ? path + segment : `${path}.${segment}`;

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
      for (const field of node.fields) walk(field.node, at(path, step(field.key)));
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

module.exports = { inspect, readsNumbers };
