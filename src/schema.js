// A Schema is a compiled codec: the definition is parsed into a plan once, the
// plan is compiled by the codegen backend (or by closures where code generation
// is unavailable or switched off), and the instance carries both.

const {
  SchemaDefinitionError,
  EncodeError,
  DecodeError,
  boundary,
  fail,
  nest,
  expectedOf,
} = require('./errors.js');
const {
  BRAND,
  PLAN,
  CODEC,
  CHECKER,
  FALLBACK,
  isSchema,
  compilePlan,
  canonical,
  fingerprint,
} = require('./plan.js');
const { resolvePlan } = require('./resolve.js');
const { INTERN } = require('./types.js');
const codegen = require('./codegen.js');
const closures = require('./closures.js');
const layouts = require('./layouts.js');

const LAYOUTS = ['rows', 'flat', 'columns'];
// An option no caller can spell: a plan built elsewhere (Schema.resolve), which
// the schema compiles instead of parsing a definition. Object.keys does not
// list it, so readOptions never sees it.
const INTERNAL = Symbol('plan');
// The codec of one item of a collection, for the stream helpers.
const ITEMS = Symbol.for('alexify.protoarray.items');
const MODES = ['decode', 'encode', 'both'];
const STRINGIFY = ['auto', 'builder', 'native'];
const isBoolean = (value) => typeof value === 'boolean';

// What each option accepts; a key not in the table is not an option.
const VALID = Object.assign(Object.create(null), {
  codegen: isBoolean,
  validate: (value) => isBoolean(value) || MODES.includes(value),
  sparse: isBoolean,
  intern: isBoolean,
  stringify: (value) => STRINGIFY.includes(value),
  layout: (value) => LAYOUTS.includes(value),
  schemas: (value) => value !== null && typeof value === 'object',
  fingerprint: (value) => typeof value === 'function',
});

const readOptions = (options, name) => {
  const settings = {
    codegen: undefined,
    validate: true,
    sparse: false,
    intern: false,
    stringify: 'auto',
    layout: 'rows',
    schemas: {},
    fingerprint,
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

// What each direction checks. `true`, the default, is the 1.0 setting: the
// wire is validated on decode and the values given to encode are trusted, so
// a codec that only encodes pays nothing for checks it did not ask for.
const checks = (validate, checking) => ({
  encode: checking || validate === 'encode' || validate === 'both',
  decode: checking || validate === true || validate === 'decode' || validate === 'both',
});

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

// The root codec of an interned schema: the message's string table is set
// for the length of one call, and the payload carries it. A codec called
// inside one (an embedded schema, a record of a layout) finds it set and
// uses it.
const withTable = (codec, validate) => ({
  encode: (value) => {
    if (INTERN.table !== null) return codec.encode(value);
    INTERN.table = [];
    INTERN.map = new Map();
    try {
      const body = codec.encode(value);
      return [INTERN.table, body];
    } finally {
      INTERN.table = null;
      INTERN.map = null;
    }
  },
  decode: (wire, strict) => {
    if (INTERN.table !== null) return codec.decode(wire, strict);
    if (!Array.isArray(wire) || wire.length !== 2 || !Array.isArray(wire[0])) {
      fail('structure', '', 'intern');
    }
    const table = wire[0];
    if (validate && !table.every((entry) => typeof entry === 'string')) {
      fail('structure', '', 'intern');
    }
    INTERN.table = table;
    try {
      return codec.decode(wire[1], strict);
    } finally {
      INTERN.table = null;
    }
  },
});

// A call from outside into an interned schema starts without a table, even
// one made midway through another (a getter of the value encoding another
// payload): the outer table is put back after it.
const isolated = (run) => {
  const { table, map } = INTERN;
  INTERN.table = null;
  INTERN.map = null;
  try {
    return run();
  } finally {
    INTERN.table = table;
    INTERN.map = map;
  }
};

// The codec of a plan, compiled by a backend and wrapped in a layout for a
// collection. A checking codec validates both directions and calls the
// checking codecs of the schemas it embeds (see Schema#check).
const build = (plan, backend, settings, checking) => {
  const validate = checks(settings.validate, checking);
  const target = plan.kind === 'array' && plan.layout !== 'rows' ? plan.item : plan;
  const interned = internedIn(plan, new Set());
  // Generated code writes the text of what it encodes where that is faster
  // than JSON.stringify of the wire: by default for records without strings
  // (see numeric), on request for any. An interned payload has its table to
  // put first, so it goes through encode.
  const { stringify } = settings;
  const builder =
    !checking &&
    !interned &&
    (stringify === 'builder' || (stringify === 'auto' && plan.kind !== 'array' && converted(plan)));
  let codec = null;
  let fallback;
  if (target.slot !== undefined) {
    // A layout over a compiled schema, or a root reference by name, reuses
    // that codec: nothing new to compile.
    codec = checking ? target.slot.checker : target.slot.codec;
  } else if (backend === codegen && settings.codegen === undefined) {
    // The probe only proves that source text compiles: a runtime that still
    // rejects this one function (its size, a stricter policy) gets closures.
    // The error is kept, so the fallback can be told from a choice.
    try {
      codec = codegen.build(target, { validate, checking, builder });
    } catch (error) {
      fallback = error;
      backend = closures;
    }
  }
  if (codec === null) codec = backend.build(target, { validate, checking, builder });
  if (target !== plan) codec = layouts[plan.layout](codec, plan.item, validate);
  if (interned) codec = withTable(codec, validate.decode);
  return { codec, backend, fallback };
};

// The `aliases` option of Schema.resolve: reader paths, as definition errors
// spell them (`address.city`, `orders[].sku`), to the writer's keys.
const readAliases = (options, name) => {
  const invalid = (text) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, name);
  const aliases = Object.create(null);
  if (options == null) return aliases;
  if (typeof options !== 'object') throw invalid('Invalid options: expected an object');
  for (const key of Object.keys(options)) {
    if (key !== 'aliases') throw invalid(`Invalid option "${key}"`);
  }
  const source = options.aliases;
  if (source === undefined) return aliases;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw invalid('Invalid option "aliases"');
  }
  for (const path of Object.keys(source)) {
    const value = source[path];
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list) || !list.every((key) => typeof key === 'string' && key !== '')) {
      throw invalid(`Invalid aliases for "${path}"`);
    }
    aliases[path] = list;
  }
  return aliases;
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
  const validate = checks(settings.validate, false);
  const { item } = plan;
  const codec = build(item, backend, settings, false).codec;
  const required = plan.itemRequired;
  const expected = expectedOf(item);
  const size = plan.layout === 'flat' ? item.fields.length : 0;
  return {
    size,
    encode: (value, index) => {
      try {
        if (size !== 0) return layouts.padded(codec, value, size, index, validate.encode);
        if (value != null) return codec.encode(value);
        if (required && validate.encode) throw new EncodeError('type', '', expected);
        return null;
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

class Schema {
  #settings;
  #interned = false;
  #items = null;
  #canonical = null;
  #id = null;
  #list = null;
  #checker = null;

  constructor(name, definition, options) {
    if (typeof name !== 'string') {
      options = definition;
      definition = name;
      name = '';
    }
    const settings = readOptions(options, name);
    // What a reference to the schema's own name calls, filled once built.
    const selfSlot = { codec: null, schema: this };
    Object.defineProperty(selfSlot, 'checker', { get: () => this[CHECKER] });
    const internal = options == null ? undefined : options[INTERNAL];
    let plan;
    if (internal === undefined) plan = compilePlan(definition, { ...settings, name, selfSlot });
    else {
      // A resolved plan prints as the writer's canonical form: its wire. A
      // recursion back to the root calls this schema's codec through `slot`.
      const { slot, ...rest } = internal.plan;
      plan = { ...rest, text: internal.text };
      if (slot !== undefined) {
        slot.schema = this;
        Object.defineProperty(slot, 'checker', { get: () => this[CHECKER] });
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
        entry.slot.codec = build(entry.plan, target, settings, false).codec;
        let checker = null;
        Object.defineProperty(entry.slot, 'checker', {
          get: () => checker || (checker = build(entry.plan, target, settings, true).codec),
        });
      }
    }
    const { codec, backend, fallback } = build(
      plan,
      useCodegen ? codegen : closures,
      settings,
      false,
    );
    selfSlot.codec = codec;
    if (internal !== undefined && internal.plan.slot !== undefined) {
      internal.plan.slot.codec = codec;
    }
    Object.defineProperty(this, BRAND, { value: true });
    if (fallback !== undefined) Object.defineProperty(this, FALLBACK, { value: fallback });
    Object.defineProperty(this, PLAN, { value: plan });
    Object.defineProperty(this, CODEC, { value: codec });
    this.name = name;
    this.definition = definition;
    this.keys = Object.freeze(plan.kind === 'struct' ? plan.keys.slice() : []);
    this.backend = backend === codegen ? 'codegen' : 'closures';
    this.layout = plan.kind === 'array' ? plan.layout : plan.sparse === true ? 'sparse' : 'dense';
    this.#settings = settings;
    this.#interned = internedIn(plan, new Set());
  }

  static from(definition, options) {
    return new Schema('', definition, options);
  }

  // What `writer` wrote, read as `reader` objects, and `reader` objects written
  // as `writer` writes them: the writer's wire and id under the reader's keys,
  // types and defaults, matched by key, by the reader's aliases or by the
  // `aliases` option. Compiled like any schema (see resolve.js).
  static resolve(writer, reader, options) {
    if (!isSchema(writer) || !isSchema(reader)) {
      throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
    }
    const aliases = readAliases(options, reader.name);
    const text = writer.toString();
    if (text === reader.toString()) return reader;
    const writerPlan = writer[PLAN];
    const context = { name: reader.name, aliases };
    const { plan, compiled } = resolvePlan(writerPlan, reader[PLAN], context);
    const { codegen: useCodegen, validate } = reader.#settings;
    return new Schema(reader.name, reader.definition, {
      codegen: useCodegen,
      validate,
      fingerprint: writer.#settings.fingerprint,
      [INTERNAL]: { plan, compiled, text },
    });
  }

  // Keys only: every field is `json`, values travel as they are.
  static keys(keys, options) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
      throw new SchemaDefinitionError('ERR_INVALID_DEFINITION', 'Schema.keys takes a list of keys');
    }
    const definition = Object.create(null);
    for (const key of keys) definition[key] = 'json';
    return new Schema('', definition, options);
  }

  // Fingerprint of the canonical form: two sides agree on the wire format when
  // their ids match, whatever names they use.
  get id() {
    if (this.#id === null) this.#id = this.#settings.fingerprint(this.toString());
    return this.#id;
  }

  // The same records as rows: `[[...], [...]]`.
  get list() {
    if (this.#list === null) {
      const { codegen: useCodegen, validate, fingerprint: hash, stringify } = this.#settings;
      const options = { codegen: useCodegen, validate, fingerprint: hash, stringify };
      this.#list = new Schema(this.name, { array: this }, options);
    }
    return this.#list;
  }

  // The codec of one item of this collection, for the stream helpers.
  get [ITEMS]() {
    if (this.#items === null) {
      const backend = this.backend === 'codegen' ? codegen : closures;
      this.#items = itemCodec(this[PLAN], backend, this.#settings, this.name);
    }
    return this.#items;
  }

  // The codec `check` runs, compiled when first asked for: it validates even
  // where the options say not to, here and in the schemas this one embeds.
  get [CHECKER]() {
    if (this.#checker === null) {
      const backend = this.backend === 'codegen' ? codegen : closures;
      this.#checker = build(this[PLAN], backend, this.#settings, true).codec;
    }
    return this.#checker;
  }

  #encodeWith(codec, value, method = 'encode') {
    const { kind } = this[PLAN];
    if (kind !== 'scalar' && (value === null || typeof value !== 'object')) {
      const code = kind === 'array' || kind === 'tuple' ? 'array' : 'object';
      throw boundary(new EncodeError(code), this.name, false);
    }
    try {
      return this.#interned ? isolated(() => codec[method](value)) : codec[method](value);
    } catch (error) {
      throw boundary(error, this.name, false);
    }
  }

  encode(value) {
    return this.#encodeWith(this[CODEC], value);
  }

  // What encoding this value with validation would throw, as the EncodeError
  // itself, or null: a check that never throws over the data.
  check(value) {
    try {
      this.#encodeWith(this[CHECKER], value);
      return null;
    } catch (error) {
      if (error instanceof EncodeError) return error;
      throw error;
    }
  }

  decode(array, options) {
    const strict = options != null && options.strict === true;
    const codec = this[CODEC];
    try {
      return this.#interned
        ? isolated(() => codec.decode(array, strict))
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

module.exports = { Schema, ITEMS, each, iterable };
