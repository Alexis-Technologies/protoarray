// What the binary wire makes of a plan before a codec is built, shared by
// ../binary.js and ../standalone.js (which writes binary codecs into modules
// without the backends): `inspect` refuses what the wire has no form for,
// `readsNumbers` says whether a codec reads a float64.

const { SchemaDefinitionError, step } = require('../errors.js');
const { PLAN, children } = require('../plan.js');

// A field's key under its record's path, as the errors and the options spell it.
const at = (path, segment) =>
  path === '' ? segment : segment[0] === '[' ? path + segment : `${path}.${segment}`;

// What the binary wire has no form for, named by its path as the errors
// spell it. A schema a slot calls checks its own plan when its codec is built.
const inspect = (plan, name) => {
  const refuse = (what, path) => {
    const where = path === '' ? '' : ` at "${path}"`;
    const text = `The binary wire has no form for ${what}${where}`;
    throw new SchemaDefinitionError('ERR_NO_BINARY_FORM', text, name, path);
  };
  const walk = (node, path) => {
    if (node.kind === 'scalar') {
      if (node.intern === true) refuse('an interned string', path);
      if (node.delta === true || node.type === 'deltas') refuse('a list of differences', path);
      return;
    }
    if (node.text !== undefined || node.order !== undefined) refuse('a resolved schema', path);
    if (node.kind === 'array' && node.layout !== 'rows') refuse(`the ${node.layout} layout`, path);
    if (node.slot !== undefined) return;
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
};

// Whether a codec of the schema, or of a schema it reaches, reads a float64:
// the reader makes its view only then.
const readsNumbers = (schema) => {
  const seen = new Set([schema]);
  const walk = (node) => {
    if (node.kind === 'scalar') return node.type === 'number' && node.decimals === undefined;
    if (node.kind === 'map' && node.key.type === 'number') return true;
    if (node.slot !== undefined) {
      const target = node.slot.schema;
      if (seen.has(target)) return false;
      seen.add(target);
      return walk(target[PLAN]);
    }
    return children(node).some(walk);
  };
  return walk(schema[PLAN]);
};

module.exports = { inspect, readsNumbers };
