// Schemas by id, and the envelope that tells a receiver which version wrote a
// payload: `[id, payload]`. A registry that knows the writer's schema reads
// its payloads as any reader schema through Schema.resolve, and writes for a
// peer on an older version the same way.

const { Schema, SIGNATURE } = require('./schema.js');
const { resolve } = require('./resolve.js');
const { SchemaDefinitionError, DecodeError, boundary } = require('./errors.js');
const { isSchema } = require('./plan.js');

const expect = (schema) => {
  if (isSchema(schema)) return schema;
  throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
};

const isEnvelope = (value) =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';

class SchemaRegistry {
  #byId = new Map();
  #byName = new Map();
  // Resolved schemas by writer id, then by reader.
  #resolved = new Map();

  constructor(schemas) {
    if (schemas == null) return;
    for (const schema of schemas) this.add(schema);
  }

  // Every entity of a metaschema Model or of its snapshot (Schema.fromModel).
  static from(source, options) {
    const schemas = Schema.fromModel(source, options);
    return new SchemaRegistry(Object.keys(schemas).map((name) => schemas[name]));
  }

  // Two schemas with one id must sign the same: a different one under a
  // known id means the fingerprint is too narrow for this registry.
  add(schema) {
    expect(schema);
    const { id } = schema;
    const known = this.#byId.get(id);
    if (known !== undefined && known[SIGNATURE] !== schema[SIGNATURE]) {
      throw new SchemaDefinitionError(
        'ERR_ID_COLLISION',
        `Schemas "${known.name}" and "${schema.name}" share the id ${id}: use a wider fingerprint`,
        schema.name,
      );
    }
    if (known === undefined) this.#byId.set(id, schema);
    // The latest version added under a name is the one found by it.
    if (schema.name !== '') this.#byName.set(schema.name, schema);
    return this;
  }

  get(id) {
    return this.#byId.get(id);
  }

  has(id) {
    return this.#byId.has(id);
  }

  find(name) {
    return this.#byName.get(name);
  }

  get size() {
    return this.#byId.size;
  }

  [Symbol.iterator]() {
    return this.#byId.values();
  }

  // The schema that reads what the schema with this id wrote as `reader`
  // objects: the reader itself for its own id, else Schema.resolve, once.
  resolve(id, reader) {
    expect(reader);
    const writer = this.#byId.get(id);
    if (writer === undefined) throw boundary(new DecodeError('schema', '', id), reader.name, true);
    if (writer[SIGNATURE] === reader[SIGNATURE]) return reader;
    let byReader = this.#resolved.get(id);
    if (byReader === undefined) this.#resolved.set(id, (byReader = new WeakMap()));
    let resolved = byReader.get(reader);
    if (resolved === undefined) byReader.set(reader, (resolved = resolve(writer, reader)));
    return resolved;
  }

  // `as` writes for a peer that knows an older (or newer) id.
  encode(schema, value, options) {
    expect(schema);
    const as = options == null ? undefined : options.as;
    if (as === undefined || as === schema.id) return [schema.id, schema.encode(value)];
    return [as, this.resolve(as, schema).encode(value)];
  }

  // Without a reader the payload decodes as its writer wrote it.
  decode(envelope, reader, options) {
    if (!isEnvelope(envelope)) {
      throw boundary(new DecodeError('structure', '', 'envelope'), '', true);
    }
    const id = envelope[0];
    if (reader != null) return this.resolve(id, reader).decode(envelope[1], options);
    const writer = this.#byId.get(id);
    if (writer === undefined) throw boundary(new DecodeError('schema', '', id), '', true);
    return writer.decode(envelope[1], options);
  }

  stringify(schema, value, options) {
    return JSON.stringify(this.encode(schema, value, options));
  }

  parse(text, reader, options) {
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch (error) {
      throw boundary(new DecodeError('json', '', '', error), '', true);
    }
    return this.decode(envelope, reader, options);
  }
}

module.exports = { SchemaRegistry };
