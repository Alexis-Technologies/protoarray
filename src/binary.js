// The `./binary` subpath: the same schema on a binary wire. `toBinary(schema,
// value)` gives the bytes of a value, `fromBinary(schema, bytes)` the value
// back; the codec is compiled from the schema's plan on first use and kept on
// the schema, by the backend the schema runs (generated code, or closures
// where it has none), checking the wire on decode as the schema does
// (`validate`); a schema of a standalone module written with `binary` carries
// its codec already (`compiled.binary`). The wire is described in
// ./binary/generate.js and docs/guide/wire-format.md: smaller and faster than
// the text wire on numbers, booleans, enums and dates, with no text to read;
// both sides need the same schema, as with Avro, since positions and header
// bits are the schema's. A schema from `resolve` (./resolve.js) reads what
// another version wrote and writes for it, as on the text wire. What the text
// wire's own options shape (interned strings, lists of differences, the flat
// and columns layouts) has no binary form and is refused (./binary/inspect.js).
// Kept out of the core entry; `register()` installs the functions as methods
// of Schema.

const { SchemaDefinitionError, DecodeError, boundary } = require('./errors.js');
const { PLAN, isSchema } = require('./plan.js');
const { Schema, SETTINGS } = require('./schema.js');
const { inspect, readsNumbers } = require('./binary/inspect.js');
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

// The codec of a schema, built on first use by the backend the schema runs:
// generated code falls back to closures where the runtime refuses its source,
// unless the schema asked for it. A schema reached through a slot (a
// reference, an embedded schema, the record of a list) is built the same way,
// a recursion included: the entry is registered before its code is built. A
// recursion inside a resolved plan calls a codec of this schema's own, built
// by the same backend from the node it stands on and registered the same way.
// A schema of a standalone module carries its codec, generated from the same
// plan (the module's canonical form was checked against the snapshot's):
// nothing is inspected or built.
const entryOf = (schema) => {
  let entry = schema[BINARY];
  if (entry !== undefined) return entry;
  const plan = schema[PLAN];
  const settings = schema[SETTINGS];
  const carried = settings.compiled === undefined ? undefined : settings.compiled.binary;
  const inner = carried === undefined ? inspect(plan, schema.name) : new Map();
  entry = {
    write: null,
    read: null,
    numbers: readsNumbers(schema),
    writer: new Writer(),
    reader: new Reader(),
    busy: false,
  };
  Object.defineProperty(schema, BINARY, { value: entry, configurable: true });
  if (carried !== undefined) {
    entry.write = carried.write;
    entry.read = carried.read;
    return entry;
  }
  let backend = schema.backend === 'codegen' ? generated : closures;
  const own = new Map();
  const innerOf = (slot) => {
    let codec = own.get(slot);
    if (codec !== undefined) return codec;
    codec = { write: null, read: null };
    own.set(slot, codec);
    const fns = backend.build(inner.get(slot), context);
    codec.write = fns.write;
    codec.read = fns.read;
    return codec;
  };
  const context = {
    validate: settings.validate,
    slot: (slot) => (slot.schema === undefined ? innerOf(slot) : entryOf(slot.schema)),
  };
  let fns;
  try {
    fns = backend.build(plan, context);
  } catch (error) {
    if (backend === closures || settings.codegen === true) {
      // A schema that cannot be built keeps no half-built codec.
      delete schema[BINARY];
      throw error;
    }
    backend = closures;
    own.clear();
    fns = backend.build(plan, context);
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
