// A Schema is a compiled codec: the snapshot of a metaschema schema is read into
// a plan once, the plan is compiled by the codegen backend (or by closures where
// code generation is unavailable or switched off), and the instance carries both.

const {
  SchemaDefinitionError,
  EncodeError,
  DecodeError,
  boundary,
  nest,
  expectedOf,
} = require('./errors.js');
const {
  BRAND,
  PLAN,
  CODEC,
  FALLBACK,
  FOREIGN,
  isSchema,
  slotOf,
  canonical,
  signature,
  fingerprint,
} = require('./plan.js');
const { SCALARS } = require('./types.js');
const {
  isSnapshot,
  isObject,
  readSnapshot,
  placesOf,
  isPaths,
  isLayouts,
} = require('./snapshot.js');
const codegen = require('./codegen.js');
const closures = require('./closures.js');
const layouts = require('./layouts.js');

// An option no caller can spell: a plan built elsewhere (the resolve subpath),
// which the schema compiles instead of reading a snapshot. Object.keys does
// not list it, so readOptions never sees it.
const INTERNAL = Symbol('plan');
// The codec of one item of a collection, for the stream helpers.
const ITEMS = Symbol.for('alexify.protoarray.items');
// The options a schema was built with, for the standalone generator.
const SETTINGS = Symbol.for('alexify.protoarray.settings');
// An option no caller can spell: the entities of one snapshot built together,
// so that references between them reach one schema per entity, a recursion
// included.
const ASSEMBLY = Symbol('assembly');
// Another one: a plan read already, compiled as it is (a collection nested in
// a layout of its own, the list of a schema's records).
const PLANNED = Symbol('planned');
// The entity of the snapshot a schema was read from, for the standalone
// generator and for a schema built again with other options.
const ENTITY = Symbol.for('alexify.protoarray.entity');
// What the id is a fingerprint of: the canonical form with the entities a
// schema references (see plan.js). Two schemas are the same version when it is.
const SIGNATURE = Symbol.for('alexify.protoarray.signature');

// What a generated module passes as `compiled`: the codec of the plan and the
// canonical form it was generated from.
const isCompiled = (value) =>
  value !== null &&
  typeof value === 'object' &&
  typeof value.canonical === 'string' &&
  value.codec !== null &&
  typeof value.codec === 'object' &&
  typeof value.codec.encode === 'function' &&
  typeof value.codec.decode === 'function';
const STRINGIFY = ['auto', 'builder', 'native'];
const REFERENCES = ['kind', 'embed', 'id'];
const isBoolean = (value) => typeof value === 'boolean';

// What a caller injects to build from a definition: metaschema itself, or
// its ./definition entry. protoarray never requires it.
const isMetaschema = (value) =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof value.Schema === 'function';

// The wire types a custom type of metaschema with a check of its own may take.
const isWireTypes = (value) =>
  isObject(value) &&
  Object.keys(value).every(
    (name) => typeof value[name] === 'string' && SCALARS[value[name]] !== undefined,
  );

// What each option accepts; a key not in the table is not an option.
const VALID = Object.assign(Object.create(null), {
  codegen: isBoolean,
  validate: isBoolean,
  sparse: (value) => isBoolean(value) || isPaths(value),
  intern: (value) => isBoolean(value) || isPaths(value),
  delta: isPaths,
  stringify: (value) => STRINGIFY.includes(value),
  compiled: isCompiled,
  layout: isLayouts,
  fingerprint: (value) => typeof value === 'function',
  references: (value) => REFERENCES.includes(value),
  types: isWireTypes,
  entity: (value) => typeof value === 'string',
  entities: (value) => isObject(value) && Object.values(value).every(isObject),
  metaschema: isMetaschema,
});

const readOptions = (options, name) => {
  const settings = {
    codegen: undefined,
    validate: true,
    sparse: false,
    intern: false,
    delta: [],
    stringify: 'auto',
    layout: 'rows',
    fingerprint,
    references: 'kind',
    types: {},
    entity: undefined,
    entities: {},
    metaschema: undefined,
  };
  const source = options == null ? {} : options;
  if (typeof source !== 'object') {
    throw new SchemaDefinitionError(
      'ERR_INVALID_OPTIONS',
      'Invalid options: expected an object',
      name,
    );
  }
  for (const key of Object.keys(source)) {
    const value = source[key];
    const valid = VALID[key];
    if (value === undefined && valid !== undefined) continue;
    if (valid === undefined || !valid(value)) {
      throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', `Invalid option "${key}"`, name);
    }
    settings[key] = value;
  }
  return settings;
};

// What a codec checks: the wire on decode, unless `validate: false` trusts it.
// The values given to encode are trusted; checking them is metaschema's.
const checks = (validate) => ({ decode: validate });

// The records whose text the builder writes faster than JSON.stringify of
// their wire on every engine measured (Node.js 18 to 24): booleans, enums,
// flags, dates, integers and decimals, nested records of them included. A
// string, a float and a collection are written faster by the native
// serializer since V8 12 (Node.js 22), up to 30% on string-heavy records, so
// `auto` leaves them to it; `builder` writes them by hand anyway, which pays on
// older engines (bench/bench.js has the numbers).
const CONVERTED = /^(integer|boolean|date|enum|flags|null)$/;

const converted = (node) => {
  if (node === null) return true;
  if (node.kind === 'scalar') return CONVERTED.test(node.type) || node.decimals !== undefined;
  if (node.slot !== undefined) return false;
  if (node.kind === 'struct') return node.fields.every((field) => converted(field.node));
  return node.kind === 'union' && node.branches.every((branch) => converted(branch.node));
};

// Whether a plan holds an interned string, in the schemas it embeds too: its
// payload is then `[table, body]`. A recursion counts once.
const internedIn = (node, seen) => {
  if (node === null || node.kind === 'scalar') return node !== null && node.intern === true;
  if (node.slot !== undefined) {
    const { schema } = node.slot;
    // A recursion inside a resolved plan calls a codec of its own: the plan
    // it was built from is traversed where it stands.
    if (schema === undefined) return false;
    // A schema under construction is the root being traversed.
    if (seen.has(schema) || schema[PLAN] === undefined) return false;
    seen.add(schema);
    return internedIn(schema[PLAN], seen);
  }
  if (node.kind === 'struct') return node.fields.some((field) => internedIn(field.node, seen));
  if (node.kind === 'union') return node.branches.some((branch) => internedIn(branch.node, seen));
  if (node.kind === 'tuple') return node.items.some((item) => internedIn(item.node, seen));
  if (node.kind === 'array') return internedIn(node.item, seen);
  return internedIn(node.value, seen);
};

// What a backend compiles for a plan, and with which options: the record of
// a flat or columns collection, the plan itself otherwise. The standalone
// generator compiles the same.
const codecOptions = (plan, settings) => {
  const validate = checks(settings.validate);
  const target = plan.kind === 'array' && plan.layout !== 'rows' ? plan.item : plan;
  const interned = internedIn(plan, new Set());
  // Generated code writes the text of what it encodes where that is faster
  // than JSON.stringify of the wire: by default for records of converted
  // types (see converted), on request for any. An interned payload has its
  // table to put first, so it goes through encode.
  const { stringify } = settings;
  const builder =
    !interned &&
    (stringify === 'builder' || (stringify === 'auto' && plan.kind !== 'array' && converted(plan)));
  return { target, interned, options: { validate, builder } };
};

// The codec of a plan, compiled by a backend and wrapped in a layout for a
// collection.
const build = (plan, backend, settings) => {
  const { target, interned, options } = codecOptions(plan, settings);
  const { validate } = options;
  const { compiled } = settings;
  let codec = null;
  let fallback;
  // A generated module's codec, where it has the one asked for.
  if (compiled !== undefined) codec = compiled.codec;
  if (codec !== null || target.slot !== undefined) {
    // A layout over a compiled schema, or a root reference by name, reuses
    // that codec: nothing new to compile.
    if (codec === null) codec = target.slot.codec;
  } else if (backend === codegen && settings.codegen === undefined) {
    // The probe only proves that source text compiles: a runtime that still
    // rejects this one function (its size, a stricter policy) gets closures.
    // The error is kept, so the fallback can be told from a choice.
    try {
      codec = codegen.build(target, options);
    } catch (error) {
      fallback = error;
      backend = closures;
    }
  }
  if (codec === null) codec = backend.build(target, options);
  if (target !== plan) codec = layouts[plan.layout](codec, plan.item, validate);
  if (interned) codec = layouts.withTable(codec, validate.decode);
  return { codec, backend, fallback };
};

// An iterable of values, or an async one; a string is iterable and surely a
// mistake.
const iterable = (values) =>
  values != null &&
  typeof values !== 'string' &&
  (typeof values[Symbol.iterator] === 'function' ||
    typeof values[Symbol.asyncIterator] === 'function');

// One result per value of an iterable, lazily, in its order: a generator for
// an iterable, an async generator for an async one. An error names the index
// of the value it is about.
const eachSync = function* (values, convert, name, decoding) {
  let index = 0;
  for (const value of values) {
    let result;
    try {
      result = convert(value);
    } catch (error) {
      throw boundary(nest(error, `[${index}]`), name, decoding);
    }
    yield result;
    index += 1;
  }
};

const eachAsync = async function* (values, convert, name, decoding) {
  let index = 0;
  for await (const value of values) {
    let result;
    try {
      result = convert(value);
    } catch (error) {
      throw boundary(nest(error, `[${index}]`), name, decoding);
    }
    yield result;
    index += 1;
  }
};

const each = (values, convert, name, decoding) => {
  if (!iterable(values)) {
    const error = decoding
      ? new DecodeError('structure', '', 'iterable')
      : new EncodeError('iterable');
    throw boundary(error, name, decoding);
  }
  const run = typeof values[Symbol.asyncIterator] === 'function' ? eachAsync : eachSync;
  return run(values, convert, name, decoding);
};

// The items of a collection one at a time, with the collection's rules: a
// null item where items are required, a row of a flat collection. Only rows
// and flat collections without interned strings have items that stand on
// their own.
const itemCodec = (plan, backend, settings, name) => {
  if (plan.kind !== 'array' || plan.layout === 'columns' || internedIn(plan, new Set())) {
    throw new SchemaDefinitionError(
      'ERR_INVALID_OPTIONS',
      'Only a collection in rows or flat, without interned strings, streams item by item',
      name,
    );
  }
  const validate = checks(settings.validate);
  const { item } = plan;
  const codec = build(item, backend, settings).codec;
  const required = plan.itemRequired;
  const expected = expectedOf(item);
  const size = plan.layout === 'flat' ? item.fields.length : 0;
  return {
    size,
    encode: (value, index) => {
      try {
        if (size !== 0) return layouts.padded(codec, value, size, index);
        return value == null ? null : codec.encode(value);
      } catch (error) {
        throw boundary(size === 0 ? nest(error, `[${index}]`) : error, name, false);
      }
    },
    decode: (wire, index, strict) => {
      try {
        if (wire != null || size !== 0) return codec.decode(wire, strict);
        if (required && validate.decode) throw new DecodeError('type', '', expected);
        return null;
      } catch (error) {
        throw boundary(nest(error, `[${index}]`), name, true);
      }
    },
  };
};

// The options an entity reached by a reference is built with: the ones that
// shape no place of the schema that refers to it, then its own (`entities`).
const SHARED = ['codegen', 'validate', 'stringify', 'fingerprint', 'references', 'types'];

const assemblyOf = (snapshot, settings) => {
  const shared = {};
  for (const key of SHARED) shared[key] = settings[key];
  return { snapshot, shared, entities: settings.entities, built: new Map(), building: new Map() };
};

const brandOf = (value) =>
  value !== null && typeof value === 'object' ? value[FOREIGN] : undefined;

// What a schema is built from: a snapshot and the entity of it to read, and
// the metaschema Schema it came from, if any. A definition is metaschema's to
// read, so it needs metaschema injected: `{ metaschema }`.
const sourceOf = (source, settings, name, assembly) => {
  if (assembly !== undefined) {
    return { snapshot: assembly.snapshot, entity: settings.entity, origin: null };
  }
  let origin = null;
  let snapshot;
  let entity = settings.entity;
  if (brandOf(source) === 'Schema') {
    origin = source;
    snapshot = source.toSnapshot();
    entity = snapshot.root;
  } else if (brandOf(source) === 'Model') {
    snapshot = source.toJSON();
  } else if (isSchema(source) && source.snapshot !== null) {
    // A schema built again with other options, from what it was read from.
    origin = source.source;
    snapshot = source.snapshot;
    if (entity === undefined) entity = source[ENTITY];
  } else if (isSnapshot(source)) {
    snapshot = source;
  } else if (settings.metaschema !== undefined) {
    origin = new settings.metaschema.Schema(name, source);
    snapshot = origin.toSnapshot();
    entity = snapshot.root;
  } else {
    const text =
      'A metaschema Schema or Model, a snapshot, or a definition with { metaschema } expected';
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text, name);
  }
  if (entity === undefined) entity = snapshot.root;
  if (typeof entity !== 'string') {
    const text = 'Name the entity to build: { entity }';
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, name);
  }
  return { snapshot, entity, origin };
};

// The slot of an entity of the assembly: the schema built for it, the one
// being built (a recursion), or a new one.
const slotFor = (assembly, entity) => {
  const built = assembly.built.get(entity);
  if (built !== undefined) return slotOf(built);
  const building = assembly.building.get(entity);
  if (building !== undefined) return building;
  const own = Object.hasOwn(assembly.entities, entity) ? assembly.entities[entity] : {};
  const options = { ...assembly.shared, ...own, entity, [ASSEMBLY]: assembly };
  return slotOf(new Schema(entity, assembly.snapshot, options));
};

class Schema {
  #settings;
  #entity = null;
  #interned = false;
  #items = null;
  #canonical = null;
  #id = null;
  #signature = null;
  #list = null;

  constructor(name, source, options) {
    if (typeof name !== 'string') {
      options = source;
      source = name;
      name = '';
    }
    const settings = readOptions(options, name);
    // What a reference to the schema's own name calls, filled once built.
    const selfSlot = { codec: null, schema: this };
    const internal = options == null ? undefined : options[INTERNAL];
    let assembly = options == null ? undefined : options[ASSEMBLY];
    const planned = options == null ? undefined : options[PLANNED];
    let plan;
    let input = null;
    if (internal === undefined && planned === undefined) {
      input = sourceOf(source, settings, name, assembly);
    }
    if (planned !== undefined) plan = planned;
    else if (internal === undefined) {
      if (name === '') name = input.entity;
      if (assembly === undefined) assembly = assemblyOf(input.snapshot, settings);
      assembly.building.set(input.entity, selfSlot);
      plan = readSnapshot({
        name,
        entity: input.entity,
        snapshot: input.snapshot,
        selfSlot,
        slotOf: (entity) => slotFor(assembly, entity),
        // A collection in a layout of its own is a codec of its own.
        nested: (node) => {
          const own = { [PLANNED]: node };
          for (const key of ['codegen', 'validate', 'stringify', 'fingerprint']) {
            own[key] = settings[key];
          }
          return slotOf(new Schema(name, null, own));
        },
        references: settings.references,
        types: settings.types,
        ...placesOf(settings),
      });
    } else {
      // A resolved plan prints as the writer's canonical form: its wire. A
      // recursion back to the root calls this schema's codec through `slot`.
      const { slot, ...rest } = internal.plan;
      plan = { ...rest, text: internal.text };
      this.#signature = internal.signature;
      if (slot !== undefined) slot.schema = this;
    }
    const { compiled } = settings;
    if (compiled !== undefined) {
      // A generated module goes with the snapshot it was generated from.
      if (settings.codegen === true || internal !== undefined) {
        const text = 'A compiled codec replaces code generation';
        throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, name);
      }
      if (compiled.canonical !== canonical(plan)) {
        const text = 'The compiled codec is of another schema: generate it again';
        throw new SchemaDefinitionError('ERR_COMPILED_MISMATCH', text, name);
      }
    }
    const useCodegen = settings.codegen === undefined ? codegen.available : settings.codegen;
    if (useCodegen && !codegen.available) {
      throw new SchemaDefinitionError(
        'ERR_CODEGEN_UNAVAILABLE',
        'Code generation is not available in this runtime: pass { codegen: false }',
        name,
      );
    }
    // The codecs a resolved plan calls for its inner recursions, compiled
    // first: a collection layout reads its record's codec as it is built.
    if (internal !== undefined) {
      for (const entry of internal.compiled) {
        if (entry.slot === internal.plan.slot) continue;
        const target = useCodegen ? codegen : closures;
        entry.slot.codec = build(entry.plan, target, settings).codec;
      }
    }
    const { codec, backend, fallback } = build(plan, useCodegen ? codegen : closures, settings);
    selfSlot.codec = codec;
    if (internal !== undefined && internal.plan.slot !== undefined) {
      internal.plan.slot.codec = codec;
    }
    Object.defineProperty(this, BRAND, { value: true });
    if (fallback !== undefined) Object.defineProperty(this, FALLBACK, { value: fallback });
    Object.defineProperty(this, PLAN, { value: plan });
    Object.defineProperty(this, CODEC, { value: codec });
    if (input !== null) {
      assembly.building.delete(input.entity);
      assembly.built.set(input.entity, this);
    }
    this.name = name;
    this.snapshot = input === null ? null : input.snapshot;
    this.source = input === null ? null : input.origin;
    this.keys = Object.freeze(plan.kind === 'struct' ? plan.keys.slice() : []);
    this.backend =
      compiled !== undefined ? 'standalone' : backend === codegen ? 'codegen' : 'closures';
    if (compiled !== undefined && typeof compiled.id === 'string') this.#id = compiled.id;
    this.layout = plan.kind === 'array' ? plan.layout : plan.sparse === true ? 'sparse' : 'dense';
    this.#settings = settings;
    this.#interned = internedIn(plan, new Set());
    this.#entity = input === null ? null : input.entity;
  }

  static from(source, options) {
    return new Schema('', source, options);
  }

  // Every entity of a metaschema Model or of its snapshot, in its order, each
  // with the shared options and its own from `entities`.
  static fromModel(source, options) {
    const settings = readOptions(options, '');
    for (const key of ['sparse', 'layout', 'intern', 'delta', 'entity', 'compiled', 'metaschema']) {
      if (options != null && options[key] !== undefined) {
        const text = `Option "${key}" names one schema: give it in "entities"`;
        throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', text);
      }
    }
    let snapshot = source;
    if (brandOf(source) === 'Model') snapshot = source.toJSON();
    if (!isSnapshot(snapshot)) {
      const model = brandOf(source) === 'Model';
      const text = model
        ? 'A snapshot of format 1 with entities is expected'
        : 'A metaschema Model or a snapshot expected';
      throw new SchemaDefinitionError(model ? 'ERR_INVALID_SNAPSHOT' : 'ERR_SCHEMA_EXPECTED', text);
    }
    const assembly = assemblyOf(snapshot, settings);
    const out = Object.create(null);
    for (const entity of Object.keys(snapshot.entities)) {
      slotFor(assembly, entity);
      out[entity] = assembly.built.get(entity);
    }
    return out;
  }

  // Fingerprint of the canonical form: two sides agree on the wire format when
  // their ids match, whatever names they use.
  get id() {
    if (this.#id === null) this.#id = this.#settings.fingerprint(this[SIGNATURE]);
    return this.#id;
  }

  // The canonical form with the entities this schema references, by name.
  get [SIGNATURE]() {
    if (this.#signature === null) this.#signature = signature(this[PLAN], this);
    return this.#signature;
  }

  // The same records as rows: `[[...], [...]]`, each called through this
  // schema's codec.
  get list() {
    if (this.#list === null) {
      const { codegen: useCodegen, validate, fingerprint: hash, stringify } = this.#settings;
      const plan = this[PLAN];
      let item;
      let itemRequired = true;
      if (plan.kind === 'scalar') {
        const { required, ...plain } = plan;
        item = plain;
        itemRequired = required;
      } else item = { ...plan, slot: slotOf(this) };
      const options = { codegen: useCodegen, validate, fingerprint: hash, stringify };
      options[PLANNED] = { kind: 'array', item, itemRequired, layout: 'rows' };
      this.#list = new Schema(this.name, null, options);
    }
    return this.#list;
  }

  // The entity of the snapshot this schema was read from.
  get [ENTITY]() {
    return this.#entity;
  }

  // The codec of one item of this collection, for the stream helpers.
  get [ITEMS]() {
    if (this.#items === null) {
      const backend = this.backend === 'codegen' ? codegen : closures;
      this.#items = itemCodec(this[PLAN], backend, this.#settings, this.name);
    }
    return this.#items;
  }

  // The options this schema was built with, for the standalone generator.
  get [SETTINGS]() {
    return this.#settings;
  }

  #encodeWith(codec, value, method = 'encode') {
    const { kind } = this[PLAN];
    if (kind !== 'scalar' && (value === null || typeof value !== 'object')) {
      const code = kind === 'array' || kind === 'tuple' ? 'array' : 'object';
      throw boundary(new EncodeError(code), this.name, false);
    }
    try {
      return this.#interned ? layouts.isolated(() => codec[method](value)) : codec[method](value);
    } catch (error) {
      throw boundary(error, this.name, false);
    }
  }

  encode(value) {
    return this.#encodeWith(this[CODEC], value);
  }

  decode(array, options) {
    const strict = options != null && options.strict === true;
    const codec = this[CODEC];
    try {
      return this.#interned
        ? layouts.isolated(() => codec.decode(array, strict))
        : codec.decode(array, strict);
    } catch (error) {
      throw boundary(error, this.name, true);
    }
  }

  // One wire value per value of an iterable (or an async one), lazily.
  encodeEach(values) {
    return each(values, (value) => this.encode(value), this.name, false);
  }

  decodeEach(arrays, options) {
    return each(arrays, (array) => this.decode(array, options), this.name, true);
  }

  // The codec writes the text itself where it can (see codegen.js), the
  // text JSON.stringify of the wire would be.
  stringify(value) {
    const codec = this[CODEC];
    if (codec.stringify !== undefined) return this.#encodeWith(codec, value, 'stringify');
    return JSON.stringify(this.encode(value));
  }

  parse(text, options) {
    let array;
    try {
      array = JSON.parse(text);
    } catch (error) {
      throw boundary(new DecodeError('json', '', '', error), this.name, true);
    }
    return this.decode(array, options);
  }

  toString() {
    if (this.#canonical === null) this.#canonical = canonical(this[PLAN]);
    return this.#canonical;
  }
}

module.exports = {
  Schema,
  ITEMS,
  SETTINGS,
  ENTITY,
  SIGNATURE,
  INTERNAL,
  each,
  iterable,
  codecOptions,
};
