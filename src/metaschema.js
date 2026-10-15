// The `./metaschema` subpath: one definition for both libraries.
//
// metaschema keeps no raw definition on a Schema, so `fromMetaschema` walks
// its field types (`schema.fields`) and writes the protoarray definition of
// the same shape: every type of the shared DSL as it is, a reference as
// metaschema's storage view holds it (a stored entity's id, a memory kind's
// record), options protoarray reads (`decimals`, `aliases`, `delta`,
// `intern`, a primitive `default`) carried over. Rules, validators and codecs
// stay metaschema's business. `fromModel` does it for every entity of a Model
// and returns a SchemaRegistry. `types` is the custom types table metaschema
// lacks for the types protoarray adds: `bytes` and `flags` (its own `date`
// already exists). `register()` lets `Schema.from(metaschemaSchema)`, a
// metaschema Schema as a field and `SchemaRegistry.from(model)` work.
//
// Nothing here requires metaschema: it is recognised by its brand.

const { Schema } = require('./schema.js');
const { SchemaRegistry } = require('./registry.js');
const { SchemaDefinitionError } = require('./errors.js');
const { HOOKS, FOREIGN } = require('./plan.js');

// The types protoarray spells as metaschema does.
const SAME = /^(string|number|integer|boolean|bigint|date|bytes|json|any|unknown|null)$/;
// A struct whose first key is one of these reads as something else: a kind
// key in front keeps it a struct.
const READS_AS_FORM = /^(type|array|set|map|object|tuple|schema|enum|flags|union|one|many)\??$/;

const isBranded = (value, brand) =>
  value !== null && typeof value === 'object' && value[FOREIGN] === brand;

const unknownType = (name, path) => {
  const where = path === '' ? '' : ` at "${path}"`;
  return new SchemaDefinitionError('ERR_UNKNOWN_TYPE', `Unknown type "${name}"${where}`, '', path);
};

// The options of a field type that protoarray reads too.
const optionsOf = (type) => {
  const out = { required: type.required };
  if (type.default !== undefined && typeof type.default !== 'function') out.default = type.default;
  for (const key of ['decimals', 'aliases', 'delta', 'intern']) {
    if (type[key] !== undefined) out[key] = type[key];
  }
  return out;
};

// A schema in progress: the protoarray schemas its references need, by name.
const translator = (context) => {
  // The type an alias (`{ money: { js: 'number' } }`) stands for, through
  // the chain of aliases in the schema's type table.
  const baseOf = (type) => {
    const table = type.root.types;
    let Type = type.constructor;
    while (Type.source !== undefined && Type.source.js !== undefined) Type = table[Type.source.js];
    return Type.type;
  };

  const typeOf = (type, path, references) => {
    const name = baseOf(type);
    const options = optionsOf(type);
    if (SAME.test(name)) return { type: name, ...options };
    if (name === 'enum') return { enum: type.enum, ...options };
    if (name === 'flags') return { flags: type.flags, ...options };
    if (name === 'array' || name === 'set') {
      return { [name]: typeOf(type.value, `${path}[]`, references), ...options };
    }
    if (name === 'map' || name === 'object') {
      const value = typeOf(type.value, `${path}{}`, references);
      return { type: name, key: type.key, value, ...options };
    }
    if (name === 'tuple') {
      return {
        tuple: type.value.map((item, i) => typeOf(item, `${path}[${i}]`, references)),
        ...options,
      };
    }
    if (name === 'schema') return { schema: structOf(type.schema, path, references), ...options };
    if (name === 'union') {
      const branches = type.union.map((branch, i) => typeOf(branch, `${path}[${i}]`, references));
      return { union: branches, discriminator: type.discriminator, ...options };
    }
    if (name === 'reference' || name === 'one' || name === 'many') {
      return reference(type, path, references, options);
    }
    throw unknownType(type.constructor.type, path);
  };

  // As metaschema's storage view holds it: a stored entity by its id, a
  // memory kind (or a field with `embed: true`) as the record itself.
  const reference = (type, path, references, options) => {
    const target = type.root.findReference(type.type);
    if (target === null || target === undefined) {
      const text = `Unknown reference "${type.type}" at "${path}"`;
      throw new SchemaDefinitionError('ERR_UNKNOWN_REFERENCE', text, '', path);
    }
    const embed = type.embed === undefined ? target.store !== 'persistent' : type.embed;
    const many = type.many !== undefined;
    if (!embed) return many ? { array: 'string', ...options } : { type: 'string', ...options };
    if (target !== context.root) references[target.name] = schemaOf(target, context);
    const item = { type: target.name, required: true };
    return many ? { array: item, ...options } : { ...item, ...options };
  };

  // The fields of a struct, calculated ones left out; a kind key in front
  // where the first key would read as a form.
  const structOf = (fields, path, references) => {
    const out = {};
    const keys = Object.keys(fields);
    if (keys.length > 0 && READS_AS_FORM.test(keys[0])) out.Struct = {};
    for (const key of keys) {
      const type = fields[key];
      if (typeof type === 'function') continue;
      out[key] = typeOf(type, path === '' ? key : `${path}.${key}`, references);
    }
    return out;
  };

  return { typeOf, structOf };
};

// A metaschema Schema as a protoarray one, once per context: the schemas it
// embeds are built first and reach it by name, a recursion by its own name.
const schemaOf = (source, context) => {
  const built = context.built.get(source);
  if (built !== undefined) return built;
  if (context.building.has(source)) {
    const text = `References between "${source.name}" and another embedded schema form a cycle`;
    throw new SchemaDefinitionError('ERR_UNKNOWN_REFERENCE', text, source.name);
  }
  context.building.add(source);
  const outer = context.root;
  context.root = source;
  const references = {};
  const { typeOf, structOf } = translator(context);
  const { fields } = source;
  const definition =
    fields[FOREIGN] === 'Struct'
      ? structOf(fields, '', references)
      : typeOf(fields, '', references);
  context.root = outer;
  const options = context.options === undefined ? {} : context.options;
  const schemas = { ...options.schemas, ...references };
  const schema = new Schema(source.name, definition, { ...options, schemas });
  context.building.delete(source);
  context.built.set(source, schema);
  return schema;
};

const contextOf = (options) => ({ built: new Map(), building: new Set(), root: null, options });

const fromMetaschema = (schema, options) => {
  if (!isBranded(schema, 'Schema')) {
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'A metaschema Schema expected');
  }
  return schemaOf(schema, contextOf(options));
};

// Every entity of a Model, in its dependency order, by name and by id.
const fromModel = (model, options) => {
  if (!isBranded(model, 'Model')) {
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'A metaschema Model expected');
  }
  const context = contextOf(options);
  const registry = new SchemaRegistry();
  const names = new Set([...model.order, ...model.entities.keys()]);
  for (const name of names) registry.add(schemaOf(model.entities.get(name), context));
  return registry;
};

// The custom types metaschema lacks, for `new Model(types, entities)`: the
// same objects every time, so registering them again is accepted.
const isBytes = (value) => value instanceof Uint8Array;

const types = {
  bytes: {
    kind: 'scalar',
    construct() {},
    checkType: (value) => (isBytes(value) ? null : false),
  },
  flags: {
    kind: 'scalar',
    construct(definition) {
      this.flags = definition.flags;
    },
    // An object of the flag names, each true or false.
    checkType(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
      const valid = Object.keys(value).every(
        (key) => this.flags.includes(key) && typeof value[key] === 'boolean',
      );
      return valid ? null : false;
    },
  },
};

let registered = false;

const register = () => {
  if (registered) return;
  registered = true;
  HOOKS.foreign = (schema) => fromMetaschema(schema);
  HOOKS.model = fromModel;
};

module.exports = { fromMetaschema, fromModel, types, register };
