// The `./binary` subpath: the same schema on a binary wire. `toBinary(schema,
// value)` gives the bytes of a value, `fromBinary(schema, bytes)` the value
// back; the codec is compiled from the schema's plan on first use and kept on
// the schema, by the backend the schema runs (generated code, or closures
// where it has none), checking the structure of the wire on every message and
// its values as the schema does (`validate`); a schema of a standalone module
// written with `binary` carries its codec already (`compiled.binary`). The
// wire is described in ./binary/generate.js and docs/guide/wire-format.md:
// smaller and faster than the text wire on numbers, booleans, enums and dates,
// with no text to read; both sides need the same schema, as with Avro, since
// positions and header bits are the schema's, and a message is read whole: a
// byte past it is an error. A schema from `resolve` (./resolve.js) reads what
// another version wrote and writes for it, as on the text wire. What the text
// wire's own options shape (interned strings, lists of differences, the flat
// and columns layouts) has no binary form and is refused (./binary/inspect.js).
// Kept out of the core entry; `register()` installs the functions as methods
// of Schema.

const { SchemaDefinitionError, DecodeError, boundary } = require('./errors.js');
const { PLAN, isSchema } = require('./plan.js');
const { Schema, SETTINGS, RECURSIVE, registrar } = require('./schema.js');
const { isBytes } = require('./types.js');
const layouts = require('./layouts.js');
const { inspect, readsNumbers } = require('./binary/inspect.js');
const generated = require('./binary/generate.js');
const closures = require('./binary/closures.js');
const { Writer, Reader } = require('./binary/wire.js');

// The binary codec of a schema, kept on it: `{ write, read }` of its backend,
// its writer and reader (made on its first call of its own), whether any codec
// it reaches reads a float64, the error that made generated code fall back to
// closures (`fallback`) and the one that left it without a codec (`error`).
const BINARY = Symbol.for('alexify.protoarray.binary');

const expect = (schema) => {
  if (isSchema(schema)) return schema;
  throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
};

// A codec counted against `maxDepth` where the schema asked for one and a
// recursion goes through it, as the text codec is (layouts.guarded): both
// wires refuse a payload at the same depth, on either backend.
const guard = (fns, settings, recursive) =>
  recursive && settings.maxDepth !== Infinity ? layouts.guardedBinary(fns, settings.maxDepth) : fns;

// The codec of a schema, built on first use by the backend the schema runs:
// generated code falls back to closures where the runtime refuses its source,
// unless the schema asked for it. A schema reached through a slot (a
// reference, an embedded schema, the record of a list) is built the same way,
// a recursion included: the entry is registered before its code is built. A
// recursion inside a resolved plan calls a codec of this schema's own, built
// by the same backend from the node it stands on and registered the same way.
// A schema of a standalone module carries its codec, generated from the same
// plan (the module's canonical form was checked against the snapshot's) and
// counted against its `maxDepth` by the module: nothing is inspected or built.
// A schema that cannot have a codec (one it reaches has no binary form) keeps
// the error instead, since a codec built meanwhile may call through its entry.
const entryOf = (schema) => {
  let entry = schema[BINARY];
  if (entry !== undefined) {
    if (entry.error !== undefined) throw entry.error;
    return entry;
  }
  const plan = schema[PLAN];
  const settings = schema[SETTINGS];
  const carried = settings.compiled === undefined ? undefined : settings.compiled.binary;
  const inner = carried === undefined ? inspect(plan, schema.name) : new Map();
  entry = {
    write: null,
    read: null,
    numbers: readsNumbers(schema),
    writer: null,
    reader: null,
    busy: false,
    fallback: undefined,
    error: undefined,
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
    const fns = guard(backend.build(inner.get(slot), context), settings, true);
    codec.write = fns.write;
    codec.read = fns.read;
    return codec;
  };
  const context = {
    validate: settings.validate,
    slot: (slot) => (slot.schema === undefined ? innerOf(slot) : entryOf(slot.schema)),
  };
  try {
    let fns;
    try {
      fns = backend.build(plan, context);
    } catch (error) {
      // What the definition refuses (a schema reached by a slot has no binary
      // form) is no failure of the backend: it is refused as it is.
      if (backend === closures || settings.codegen === true) throw error;
      if (error instanceof SchemaDefinitionError) throw error;
      entry.fallback = error;
      backend = closures;
      own.clear();
      fns = backend.build(plan, context);
    }
    fns = guard(fns, settings, schema[RECURSIVE]);
    entry.write = fns.write;
    entry.read = fns.read;
  } catch (error) {
    entry.error = error;
    throw error;
  }
  if (backend === generated) {
    // Off the public surface, for debugging through the symbol, as the text
    // codec's `source`: generated again when read, so the entry holds no text.
    Object.defineProperty(entry, 'source', {
      get: () => generated.generate(plan, context).body,
    });
  }
  return entry;
};

// The bytes of a value: a Uint8Array of its own. A call made while the
// schema is encoding (from a toJSON of a json value) takes a writer of its
// own; `busy` is restored, not cleared, so the outer call keeps its claim.
const toBinary = (schema, value) => {
  const entry = entryOf(expect(schema));
  let w;
  if (entry.busy) w = new Writer();
  else {
    if (entry.writer === null) entry.writer = new Writer();
    w = entry.writer;
  }
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

// The value of the bytes `toBinary` of the same schema gave, which the
// message must end on. A DecodeError of this wire carries `offset`, where the
// innermost reader stood when it refused the message.
const fromBinary = (schema, bytes) => {
  const target = expect(schema);
  if (!isBytes(bytes)) {
    throw boundary(new DecodeError('structure', '', 'bytes'), schema.name, true);
  }
  const entry = entryOf(target);
  let r;
  if (entry.busy) r = new Reader();
  else {
    if (entry.reader === null) entry.reader = new Reader();
    r = entry.reader;
  }
  const was = entry.busy;
  entry.busy = true;
  let value;
  try {
    value = entry.read(r.reset(bytes, entry.numbers));
    // Nothing follows a message: bytes past it are another schema's, or garbage.
    if (r.pos !== r.end) throw new DecodeError('extra', '');
  } catch (error) {
    entry.busy = was;
    r.release();
    // Where the reader stood when it refused the message: no DecodeError
    // comes from deeper, since nothing of a message runs code of the caller's.
    if (error instanceof DecodeError) error.offset = Math.min(r.pos, r.end);
    throw boundary(error, schema.name, true);
  }
  entry.busy = was;
  r.release();
  return value;
};

// Installed like class members: not enumerable. Once per process.
const register = registrar(Schema.prototype, {
  toBinary(value) {
    return toBinary(this, value);
  },
  fromBinary(bytes) {
    return fromBinary(this, bytes);
  },
});

module.exports = { toBinary, fromBinary, register };
