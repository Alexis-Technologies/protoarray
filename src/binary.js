// The `./binary` subpath: the same schema on a binary wire. `toBinary(schema,
// value)` gives the bytes of a value, `fromBinary(schema, bytes)` the value
// back; the codec is compiled from the schema's plan on first use and kept on
// the schema, by the backend the schema runs (generated code, or closures
// where it has none), checking the wire on decode as the schema does
// (`validate`). The wire is described in ./binary/generate.js and
// docs/guide/wire-format.md: smaller and faster than the text wire on
// numbers, booleans, enums and dates, with no text to read; both sides need
// the same schema, as with Avro, since positions and header bits are the
// schema's. What the text wire's own options shape (interned strings, lists
// of differences, the flat and columns layouts) and a resolved schema have no
// binary form and are refused. Kept out of the core entry; `register()`
// installs the functions as methods of Schema.

const { SchemaDefinitionError, DecodeError, boundary, step } = require('./errors.js');
const { PLAN, children, isSchema } = require('./plan.js');
const { Schema, SETTINGS } = require('./schema.js');
const generated = require('./binary/generate.js');
const closures = require('./binary/closures.js');
const { Writer, Reader } = require('./binary/wire.js');

// The binary codec of a schema, kept on it: `{ write, read }` of its backend,
// its writer and reader, and whether any codec it reaches reads a float64.
const BINARY = Symbol.for('alexify.protoarray.binary');

const expect = (schema) => {
  if (isSchema(schema)) return schema;
  throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
};

const TAG = Object.prototype.toString;
const isBytes = (v) =>
  v instanceof Uint8Array || (ArrayBuffer.isView(v) && TAG.call(v) === '[object Uint8Array]');

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

// The codec of a schema, built on first use by the backend the schema runs:
// generated code falls back to closures where the runtime refuses its source,
// unless the schema asked for it. A schema reached through a slot (a
// reference, an embedded schema, the record of a list) is built the same way,
// a recursion included: the entry is registered before its code is built.
const entryOf = (schema) => {
  let entry = schema[BINARY];
  if (entry !== undefined) return entry;
  const plan = schema[PLAN];
  inspect(plan, schema.name);
  entry = {
    write: null,
    read: null,
    numbers: readsNumbers(schema),
    writer: new Writer(),
    reader: new Reader(),
    busy: false,
  };
  Object.defineProperty(schema, BINARY, { value: entry, configurable: true });
  const settings = schema[SETTINGS];
  const context = { validate: settings.validate, slot: (slot) => entryOf(slot.schema) };
  const backend = schema.backend === 'codegen' ? generated : closures;
  let fns;
  try {
    fns = backend.build(plan, context);
  } catch (error) {
    if (backend === closures || settings.codegen === true) {
      // A schema that cannot be built keeps no half-built codec.
      delete schema[BINARY];
      throw error;
    }
    fns = closures.build(plan, context);
  }
  entry.write = fns.write;
  entry.read = fns.read;
  return entry;
};

// The bytes of a value: a Uint8Array of its own. A call made while the
// schema is encoding (from a toJSON of a json value) takes a writer of its
// own; `busy` is restored, not cleared, so the outer call keeps its claim.
const toBinary = (schema, value) => {
  const entry = entryOf(expect(schema));
  const w = entry.busy ? new Writer() : entry.writer;
  const was = entry.busy;
  entry.busy = true;
  let bytes;
  try {
    w.reset();
    entry.write(w, value);
    bytes = w.finish();
  } catch (error) {
    entry.busy = was;
    throw boundary(error, schema.name, false);
  }
  entry.busy = was;
  return bytes;
};

// The value of the bytes `toBinary` of the same schema gave.
const fromBinary = (schema, bytes) => {
  const entry = entryOf(expect(schema));
  if (!isBytes(bytes)) {
    throw boundary(new DecodeError('structure', '', 'bytes'), schema.name, true);
  }
  const r = entry.busy ? new Reader() : entry.reader;
  const was = entry.busy;
  entry.busy = true;
  let value;
  try {
    value = entry.read(r.reset(bytes, entry.numbers));
  } catch (error) {
    entry.busy = was;
    throw boundary(error, schema.name, true);
  }
  entry.busy = was;
  return value;
};

// Installed like class members: not enumerable. Once per process.
let registered = false;

const register = () => {
  if (registered) return;
  registered = true;
  const members = {
    toBinary(value) {
      return toBinary(this, value);
    },
    fromBinary(bytes) {
      return fromBinary(this, bytes);
    },
  };
  const descriptors = Object.getOwnPropertyDescriptors(members);
  for (const name of Object.keys(descriptors)) {
    descriptors[name].enumerable = false;
    Object.defineProperty(Schema.prototype, name, descriptors[name]);
  }
};

module.exports = { toBinary, fromBinary, register };
