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
  INTERNED,
  children,
  isSchema,
  slotOf,
  canonical,
  referenced,
  signature,
  fingerprint,
  identify,
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
// An option no caller can spell: an entity of a snapshot, read with every
// entity it reaches (see assemble) and compiled as it was read.
const UNIT = Symbol('unit');
// Another one: a plan read already, compiled as it is (a collection nested in
// a layout of its own, the list of a schema's records), with the slot it fills.
const PLANNED = Symbol('planned');
// The entity of the snapshot a schema was read from, for the standalone
// generator and for a schema built again with other options.
const ENTITY = Symbol.for('alexify.protoarray.entity');
// What the id is a fingerprint of: the canonical form with the entities a
// schema references (see plan.js). Two schemas are the same version when it is.
const SIGNATURE = Symbol.for('alexify.protoarray.signature');
// Whether another schema is the same version: what comparing the signatures
// says, without writing either out.
const SAME = Symbol('same');
// What a schema's values are, an alias (an entity whose root is a reference)
// looked through: the plan its encode checks the shape of, its keys and layout.
const SHAPE = Symbol('shape');
// Whether a recursion goes through the schema: its codec counts the levels.
const RECURSIVE = Symbol('recursive');

const isCodec = (value) =>
  value !== null &&
  typeof value === 'object' &&
  typeof value.encode === 'function' &&
  typeof value.decode === 'function';

// What a generated module passes as `compiled`: the codec of the plan, the
// canonical form it was generated from, and the codec of one record of a rows
// collection, for the stream helpers.
const isCompiled = (value) =>
  value !== null &&
  typeof value === 'object' &&
  typeof value.canonical === 'string' &&
  isCodec(value.codec) &&
  (value.items === undefined || isCodec(value.items));
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

// The options that are lists or records, copied: a schema keeps what it was
// built with, whatever the caller does with its objects afterwards. A record
// is a dictionary, never read from a prototype.
const LISTS = ['sparse', 'intern', 'delta'];
const RECORDS = ['layout', 'types', 'entities'];

// What is wrong with an option: its name, and the place a record of places
// names wrongly.
const invalidOption = (key, value) => {
  if (key === 'layout' && isObject(value)) {
    const path = Object.keys(value).find((place) => !isLayouts(value[place]));
    return `Invalid option "layout" at "${path}": rows, flat or columns`;
  }
  return `Invalid option "${key}"`;
};

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
    types: Object.create(null),
    entity: undefined,
    entities: Object.create(null),
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
      throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', invalidOption(key, value), name);
    }
    if (LISTS.includes(key) && Array.isArray(value)) settings[key] = value.slice();
    else if (RECORDS.includes(key) && isObject(value)) {
      settings[key] = Object.assign(Object.create(null), value);
    } else settings[key] = value;
  }
  return Object.freeze(settings);
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
  return (node.kind === 'struct' || node.kind === 'union') && children(node).every(converted);
};

// Whether a plan holds an interned string, in the schemas it calls too: its
// payload is then `[table, body]`. A slot says it for the schema it calls. A
// recursion inside a resolved plan calls a codec compiled for the node it
// stands on, which is traversed where it stands, once.
const internedIn = (node, seen) => {
  if (node === null) return false;
  if (node.kind === 'scalar') return node.intern === true;
  if (node.slot !== undefined) {
    const { slot } = node;
    if (slot.interned !== undefined) return slot.interned;
    if (node.kind === 'ref' || seen.has(slot)) return false;
    seen.add(slot);
  }
  return children(node).some((child) => internedIn(child, seen));
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
  // table to put first, and a flat or columns collection is laid out from its
  // records' wire: both go through encode.
  const { stringify } = settings;
  const builder =
    !interned &&
    target === plan &&
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

// The codec of one record of a collection from a generated module, where the
// module has it: a flat collection's codec is its record's, a rows collection
// carries one as `items`.
const recordOf = (plan, settings) => {
  const { compiled } = settings;
  if (compiled === undefined) return undefined;
  return plan.layout === 'rows' ? compiled.items : compiled.codec;
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
  const own = recordOf(plan, settings);
  const codec =
    own !== undefined ? own : build(item, backend, { ...settings, compiled: undefined }).codec;
  const required = plan.itemRequired;
  const expected = expectedOf(item);
  const size = plan.layout === 'flat' ? item.fields.length : 0;
  const encode = (value, index) => {
    try {
      if (size !== 0) return layouts.padded(codec, value, size, index);
      return value == null ? null : codec.encode(value);
    } catch (error) {
      throw boundary(size === 0 ? nest(error, `[${index}]`) : error, name, false);
    }
  };
  return {
    size,
    encode,
    // The text of one item: the record's codec writes it where it can.
    text: (value, index) => {
      if (size !== 0 || value == null || codec.stringify === undefined) {
        return JSON.stringify(encode(value, index));
      }
      try {
        return codec.stringify(value);
      } catch (error) {
        throw boundary(nest(error, `[${index}]`), name, false);
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
// What an entity's own options cannot hold: its name is its key, its snapshot
// is the one of the schema around it.
const OWN = ['entity', 'entities', 'metaschema'];
// What a schema built from another one's plan is compiled with: a collection
// nested in a layout of its own, the list of a schema's records, a resolved
// schema (the reader's, with the writer's fingerprint).
const INHERITED = ['codegen', 'validate', 'stringify', 'fingerprint'];

const inherited = (settings) => {
  const out = {};
  for (const key of INHERITED) out[key] = settings[key];
  return out;
};

// The shared options, then an entity's own, where it gives one.
const merged = (shared, own) => {
  const out = { ...shared };
  for (const key of Object.keys(own)) if (own[key] !== undefined) out[key] = own[key];
  return out;
};

// The entities of one snapshot built together. Every entity a reference
// reaches is read first, from a list of pending entities rather than by a
// recursion, so a long chain of references cannot exhaust the stack; whether
// each payload carries a string table is then decided over the whole graph,
// the same whichever entity is built first; each one is compiled last, an
// alias after the entity it stands for (see assemble).
const assemblyOf = (snapshot, settings, name) => {
  const shared = {};
  for (const key of SHARED) shared[key] = settings[key];
  const { entities } = settings;
  const invalid = (text) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, name);
  for (const key of Object.keys(entities)) {
    const own = entities[key];
    for (const option of OWN) {
      if (own[option] !== undefined) throw invalid(`Option "${option}" is no option of an entity`);
    }
    readOptions(own, key);
    if (isSnapshot(snapshot) && !Object.hasOwn(snapshot.entities, key)) {
      throw invalid(`Option "entities" names no entity of the snapshot: "${key}"`);
    }
  }
  return { snapshot, shared, entities, units: new Map(), queue: [], nested: [] };
};

// The unit of an entity: read once, by whichever schema reaches it first,
// which an error in it names (`via`).
const unitOf = (assembly, entity, settings, name, origin, via) => {
  let unit = assembly.units.get(entity);
  if (unit !== undefined) return unit;
  let own = settings;
  if (own === undefined) {
    const given = Object.hasOwn(assembly.entities, entity) ? assembly.entities[entity] : {};
    own = readOptions({ ...merged(assembly.shared, given), entity }, entity);
  }
  unit = {
    entity,
    name: name === undefined ? entity : name,
    settings: own,
    snapshot: assembly.snapshot,
    origin: origin === undefined ? null : origin,
    slot: { codec: null, schema: null, interned: undefined },
    plan: null,
    via,
  };
  assembly.units.set(entity, unit);
  assembly.queue.push(unit);
  return unit;
};

const readUnit = (assembly, unit) => {
  const { settings } = unit;
  return readSnapshot({
    name: unit.name,
    entity: unit.entity,
    snapshot: assembly.snapshot,
    selfSlot: unit.slot,
    slotOf: (entity, path) => {
      const via = path === '' ? `"${unit.entity}"` : `"${unit.entity}" at "${path}"`;
      return unitOf(assembly, entity, undefined, undefined, undefined, via).slot;
    },
    // A collection in a layout of its own is a codec of its own, compiled
    // with the entities.
    nested: (node) => {
      const slot = { codec: null, schema: null, interned: undefined };
      assembly.nested.push({ name: unit.name, plan: node, slot, owner: unit });
      return slot;
    },
    references: settings.references,
    types: settings.types,
    ...placesOf(settings),
  });
};

// The slots a plan read from a snapshot calls, and whether it holds an
// interned string itself.
const scan = (node, slots) => {
  if (node.kind === 'scalar') return node.intern === true;
  if (node.slot !== undefined) {
    slots.push(node.slot);
    return false;
  }
  // Every child, the ones after an interned string too: all slots count.
  let found = false;
  for (const child of children(node)) found = scan(child, slots) || found;
  return found;
};

// The units a recursion goes through: the ones on a cycle of calls, as the
// strongly connected components of Tarjan find them, from a list of frames
// rather than by a recursion.
const cyclic = (all, callees) => {
  const index = new Map();
  const low = new Map();
  const stack = [];
  const open = new Set();
  const out = new Set();
  const enter = (unit, frames) => {
    index.set(unit, index.size);
    low.set(unit, low.size);
    stack.push(unit);
    open.add(unit);
    frames.push({ unit, next: 0 });
  };
  for (const root of all) {
    if (index.has(root)) continue;
    const frames = [];
    enter(root, frames);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const { unit } = frame;
      const next = callees.get(unit);
      if (frame.next < next.length) {
        const callee = next[frame.next++];
        if (!index.has(callee)) enter(callee, frames);
        else if (open.has(callee)) low.set(unit, Math.min(low.get(unit), index.get(callee)));
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const caller = frames[frames.length - 1].unit;
        low.set(caller, Math.min(low.get(caller), low.get(unit)));
      }
      if (low.get(unit) !== index.get(unit)) continue;
      const component = [];
      let member;
      do {
        member = stack.pop();
        open.delete(member);
        component.push(member);
      } while (member !== unit);
      if (component.length > 1 || next.includes(unit)) for (const one of component) out.add(one);
    }
  }
  return out;
};

// Whether each payload carries a string table: its own interned strings, or
// those of any schema it calls, through any chain of references. What holds
// one marks every caller, and their callers in turn. And whether a recursion
// goes through each entity, which then counts its levels.
const analyse = (assembly) => {
  const all = [...assembly.units.values(), ...assembly.nested];
  const bySlot = new Map();
  for (const unit of all) bySlot.set(unit.slot, unit);
  const callers = new Map();
  const callees = new Map();
  const found = [];
  for (const unit of all) {
    const slots = [];
    unit.interned = scan(unit.plan, slots);
    callees.set(unit, []);
    for (const slot of slots) {
      const callee = bySlot.get(slot);
      callees.get(unit).push(callee);
      const list = callers.get(callee);
      if (list === undefined) callers.set(callee, [unit]);
      else list.push(unit);
    }
    if (unit.interned) found.push(unit);
  }
  const recursive = cyclic(all, callees);
  for (const unit of assembly.units.values()) unit.recursive = recursive.has(unit);
  for (let i = 0; i < found.length; i++) {
    const list = callers.get(found[i]);
    if (list === undefined) continue;
    for (const caller of list) {
      if (caller.interned) continue;
      caller.interned = true;
      found.push(caller);
    }
  }
  for (const unit of all) unit.slot.interned = unit.interned;
};

// The units in the order they are compiled: an alias (an entity whose root is
// a reference) after the entity it stands for, whose codec it reuses. A cycle
// of aliases stands for no record at all.
const ordered = (assembly) => {
  const bySlot = new Map();
  for (const unit of assembly.units.values()) bySlot.set(unit.slot, unit);
  const out = [];
  const placed = new Set();
  for (const unit of assembly.units.values()) {
    const pending = [];
    const seen = new Set();
    let current = unit;
    while (!placed.has(current)) {
      if (seen.has(current)) {
        const text = `The entity "${unit.entity}" refers to itself through references alone`;
        throw new SchemaDefinitionError('ERR_INVALID_SNAPSHOT', text, unit.name);
      }
      seen.add(current);
      pending.push(current);
      if (current.plan.kind !== 'ref') break;
      current = bySlot.get(current.plan.slot);
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      placed.add(pending[i]);
      out.push(pending[i]);
    }
  }
  return out;
};

// A collection nested in a layout of its own, compiled with the schema it
// belongs to. A generated module writes it in place in that schema's code, so
// there its own codec is built only if something calls it (the record codec
// of a stream).
const compileNested = (nested) => {
  const { owner, slot } = nested;
  const own = { ...inherited(owner.settings), [PLANNED]: { plan: nested.plan, slot } };
  const make = () => new Schema(nested.name, null, own);
  if (owner.settings.compiled === undefined) return make();
  const data = { value: null, writable: true, configurable: true, enumerable: true };
  for (const key of ['codec', 'schema']) {
    Object.defineProperty(slot, key, {
      configurable: true,
      enumerable: true,
      get() {
        Object.defineProperty(slot, 'codec', data);
        Object.defineProperty(slot, 'schema', data);
        make();
        return slot[key];
      },
    });
  }
  return null;
};

// Reads every unit of the assembly, the ones a reference reaches on the way,
// decides which payloads carry a string table, and compiles every unit with
// `compile`. A snapshot that breaks the reader in a way it does not check is
// still an invalid snapshot.
const assemble = (assembly, compile) => {
  let unit = null;
  try {
    for (let i = 0; i < assembly.queue.length; i++) {
      unit = assembly.queue[i];
      unit.plan = readUnit(assembly, unit);
    }
  } catch (error) {
    let failed = error;
    if (!(error instanceof SchemaDefinitionError)) {
      const text = 'The snapshot cannot be read';
      failed = new SchemaDefinitionError('ERR_INVALID_SNAPSHOT', text, unit.name, '', error);
    }
    // An entity a reference reached says which one did.
    if (unit.via !== undefined) failed.message += ` (reached from ${unit.via})`;
    throw failed;
  }
  analyse(assembly);
  for (const entry of ordered(assembly)) compile(entry);
  for (const nested of assembly.nested) {
    // A collection that fell back to closures is the fallback of its schema.
    const schema = compileNested(nested);
    const owner = nested.owner.slot.schema;
    if (schema !== null && schema[FALLBACK] !== undefined && owner[FALLBACK] === undefined) {
      Object.defineProperty(owner, FALLBACK, { value: schema[FALLBACK] });
    }
  }
};

const brandOf = (value) =>
  value !== null && typeof value === 'object' ? value[FOREIGN] : undefined;

// The snapshot a metaschema object writes (`toSnapshot()`, `toJSON()`): an
// object with the brand but not the method, or one that writes no snapshot,
// is no source protoarray reads.
const written = (source, method, name) => {
  if (typeof source[method] !== 'function') {
    const text = `A metaschema ${source[FOREIGN]} with ${method}() expected`;
    throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text, name);
  }
  const snapshot = source[method]();
  if (!isSnapshot(snapshot)) {
    const text = 'A snapshot of format 1 with entities is expected';
    const root = isObject(snapshot) && typeof snapshot.root === 'string' ? snapshot.root : '';
    throw new SchemaDefinitionError('ERR_INVALID_SNAPSHOT', text, name === '' ? root : name);
  }
  return snapshot;
};

// A metaschema Schema is the root entity of its own snapshot.
const rooted = (snapshot, entity, name) => {
  if (typeof snapshot.root !== 'string') {
    throw new SchemaDefinitionError('ERR_INVALID_SNAPSHOT', 'The snapshot has no root', name);
  }
  if (entity !== undefined && entity !== snapshot.root) {
    const text = `A metaschema Schema builds its own entity "${snapshot.root}", not "${entity}"`;
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, name);
  }
  return snapshot.root;
};

// What a schema is built from: a snapshot and the entity of it to read, and
// the metaschema Schema it came from, if any. A definition is metaschema's to
// read, so it needs metaschema injected: `{ metaschema }`.
const sourceOf = (source, settings, name) => {
  let origin = null;
  let snapshot;
  let entity = settings.entity;
  if (brandOf(source) === 'Schema') {
    origin = source;
    snapshot = written(source, 'toSnapshot', name);
    entity = rooted(snapshot, entity, name);
  } else if (brandOf(source) === 'Model') {
    snapshot = written(source, 'toJSON', name);
  } else if (isSchema(source) && source.snapshot !== null) {
    // A schema built again with other options, from what it was read from:
    // the metaschema Schema goes with its own entity only.
    snapshot = source.snapshot;
    if (entity === undefined) entity = source[ENTITY];
    if (entity === source[ENTITY]) origin = source.source;
  } else if (isSnapshot(source)) {
    snapshot = source;
  } else if (settings.metaschema !== undefined) {
    origin = new settings.metaschema.Schema(name, source);
    snapshot = written(origin, 'toSnapshot', name);
    entity = rooted(snapshot, entity, name);
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

class Schema {
  #settings;
  #entity = null;
  #interned = false;
  #items = null;
  #canonical = null;
  #id = null;
  // The writer a resolved schema reads: its version is the writer's.
  #writer = null;
  // The other entities it reaches, by name: schemas, not their text.
  #entities = null;
  #list = null;
  #shape = null;
  #selves = null;
  #recursive = false;
  #builder = false;

  constructor(name, source, options) {
    if (typeof name !== 'string') {
      options = source;
      source = name;
      name = '';
    }
    const unit = options == null ? undefined : options[UNIT];
    if (unit !== undefined) {
      const input = { snapshot: unit.snapshot, entity: unit.entity, origin: unit.origin };
      const place = { input, slot: unit.slot, recursive: unit.recursive };
      this.#init(unit.name, unit.plan, unit.settings, place);
      return;
    }
    const settings = readOptions(options, name);
    const planned = options == null ? undefined : options[PLANNED];
    if (planned !== undefined) {
      this.#init(name, planned.plan, settings, planned);
      return;
    }
    const internal = options == null ? undefined : options[INTERNAL];
    if (internal !== undefined) {
      // A resolved plan prints as the writer's canonical form: its wire, its
      // id. A recursion back to the root calls this schema's codec through
      // `slot`.
      const { slot, ...rest } = internal.plan;
      this.#writer = internal.writer;
      this.#id = internal.id;
      const place = { internal, slot, recursive: slot !== undefined };
      this.#init(name, { ...rest, text: internal.text }, settings, place);
      return;
    }
    const input = sourceOf(source, settings, name);
    if (name === '') name = input.entity;
    const assembly = assemblyOf(input.snapshot, settings, name);
    const root = unitOf(assembly, input.entity, settings, name, input.origin);
    assemble(assembly, (entry) => {
      const place = { input, slot: root.slot, recursive: root.recursive };
      if (entry === root) this.#init(name, root.plan, settings, place);
      else entry.slot.schema = new Schema(entry.name, null, { [UNIT]: entry });
    });
  }

  // Compiles a plan: the codec, the slot it fills, and what the schema shows.
  #init(name, plan, settings, place) {
    const { input = null, slot, internal, selves, recursive = false } = place;
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
    // A choice made, or a generated module's codec, has nothing to probe.
    const useCodegen =
      settings.codegen === undefined
        ? compiled === undefined && codegen.available()
        : settings.codegen;
    if (useCodegen && !codegen.available()) {
      throw new SchemaDefinitionError(
        'ERR_CODEGEN_UNAVAILABLE',
        'Code generation is not available in this runtime: pass { codegen: false }',
        name,
      );
    }
    if (slot !== undefined) slot.schema = this;
    // The codecs a resolved plan calls for its inner recursions, compiled
    // first: a collection layout reads its record's codec as it is built.
    if (internal !== undefined) {
      for (const entry of internal.compiled) {
        if (entry.slot === slot) continue;
        const target = useCodegen ? codegen : closures;
        entry.slot.codec = layouts.guarded(build(entry.plan, target, settings).codec);
      }
    }
    const built = build(plan, useCodegen ? codegen : closures, settings);
    const { backend, fallback } = built;
    const codec = recursive ? layouts.guarded(built.codec) : built.codec;
    if (slot !== undefined) slot.codec = codec;
    // An alias is compiled after what it stands for (see ordered).
    const shape = plan.kind === 'ref' && plan.slot.schema != null ? plan.slot.schema[SHAPE] : plan;
    Object.defineProperty(this, BRAND, { value: true });
    if (fallback !== undefined) Object.defineProperty(this, FALLBACK, { value: fallback });
    Object.defineProperty(this, PLAN, { value: plan });
    Object.defineProperty(this, CODEC, { value: codec });
    this.name = name;
    this.snapshot = input === null ? null : input.snapshot;
    this.source = input === null ? null : input.origin;
    this.keys = Object.freeze(shape.kind === 'struct' ? shape.keys.slice() : []);
    this.backend =
      compiled !== undefined ? 'standalone' : backend === codegen ? 'codegen' : 'closures';
    if (compiled !== undefined && typeof compiled.id === 'string') this.#id = compiled.id;
    this.layout =
      shape.kind === 'array' ? shape.layout : shape.sparse === true ? 'sparse' : 'dense';
    this.#settings = settings;
    this.#interned = internedIn(plan, new Set());
    this.#entity = input === null ? null : input.entity;
    this.#shape = shape;
    this.#selves = selves === undefined ? [this] : [this, ...selves];
    this.#recursive = recursive;
    this.#builder = codec.stringify !== undefined;
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
    const snapshot = brandOf(source) === 'Model' ? written(source, 'toJSON', '') : source;
    if (!isSnapshot(snapshot)) {
      const text = 'A metaschema Model or a snapshot expected';
      throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', text);
    }
    const assembly = assemblyOf(snapshot, settings, '');
    const names = Object.keys(snapshot.entities);
    for (const entity of names) unitOf(assembly, entity);
    assemble(assembly, (entry) => {
      entry.slot.schema = new Schema(entry.name, null, { [UNIT]: entry });
    });
    const out = Object.create(null);
    for (const entity of names) out[entity] = assembly.units.get(entity).slot.schema;
    return out;
  }

  // Fingerprint of the signature: two sides agree on the wire format when
  // their ids match, whatever names they use.
  get id() {
    if (this.#id === null) {
      const entities = this.#reached();
      const id = identify(this.toString(), entities, this.#settings.fingerprint);
      if (typeof id !== 'string' || id === '') {
        const text = 'Option "fingerprint" returns a non-empty string';
        throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', text, this.name);
      }
      this.#id = id;
    }
    return this.#id;
  }

  // The canonical form with the entities this schema references, by name.
  // Computed when asked: it can be long, and the id is all a schema keeps.
  get [SIGNATURE]() {
    if (this.#writer !== null) return this.#writer[SIGNATURE];
    return signature(this.toString(), this.#reached());
  }

  // The same canonical form, and the same one for every entity reached by the
  // same name: equal signatures, compared piece by piece from the canonical
  // forms each schema keeps.
  [SAME](other) {
    if (this.toString() !== other.toString()) return false;
    const mine = this.#reached();
    const theirs = other.#reached();
    if (mine.length !== theirs.length) return false;
    for (let i = 0; i < mine.length; i++) {
      if (mine[i][0] !== theirs[i][0] || String(mine[i][1]) !== String(theirs[i][1])) return false;
    }
    return true;
  }

  #reached() {
    if (this.#entities === null) this.#entities = referenced(this[PLAN], this.#selves);
    return this.#entities;
  }

  get [INTERNED]() {
    return this.#interned;
  }

  get [SHAPE]() {
    return this.#shape;
  }

  get [RECURSIVE]() {
    return this.#recursive;
  }

  // The same records as rows: `[[...], [...]]`, each called through this
  // schema's codec. The schema is its list's own record, not another entity.
  get list() {
    if (this.#list === null) {
      const plan = this[PLAN];
      let item;
      let itemRequired = true;
      if (plan.kind === 'scalar') {
        const { required, ...plain } = plan;
        item = plain;
        itemRequired = required;
      } else item = { ...plan, slot: slotOf(this) };
      const list = { kind: 'array', item, itemRequired, layout: 'rows' };
      const options = { ...inherited(this.#settings), [PLANNED]: { plan: list, selves: [this] } };
      this.#list = new Schema(this.name, null, options);
    }
    return this.#list;
  }

  // The entity of the snapshot this schema was read from.
  get [ENTITY]() {
    return this.#entity;
  }

  // The codec of one item of this collection, for the stream helpers; an
  // alias has the items of what it stands for.
  get [ITEMS]() {
    if (this.#items === null) {
      const plan = this[PLAN];
      if (this.#shape !== plan) this.#items = plan.slot.schema[ITEMS];
      else {
        const backend = this.backend === 'codegen' ? codegen : closures;
        this.#items = itemCodec(plan, backend, this.#settings, this.name);
      }
    }
    return this.#items;
  }

  // The options this schema was built with, for the standalone generator.
  get [SETTINGS]() {
    return this.#settings;
  }

  // What encode refuses before its codec runs: a value of the wrong shape.
  #shaped(value) {
    const { kind } = this.#shape;
    if (kind !== 'scalar' && (value === null || typeof value !== 'object')) {
      const code = kind === 'array' || kind === 'tuple' ? 'array' : 'object';
      throw boundary(new EncodeError(code), this.name, false);
    }
  }

  encode(value) {
    this.#shaped(value);
    const codec = this[CODEC];
    try {
      return this.#interned ? layouts.isolated(() => codec.encode(value)) : codec.encode(value);
    } catch (error) {
      throw boundary(error, this.name, false);
    }
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

  // The codec writes the text itself where it can (see codegen.js): never
  // for an interned payload, whose table comes first.
  stringify(value) {
    if (!this.#builder) return JSON.stringify(this.encode(value));
    this.#shaped(value);
    try {
      return this[CODEC].stringify(value);
    } catch (error) {
      throw boundary(error, this.name, false);
    }
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
  SAME,
  INTERNAL,
  inherited,
  SHAPE,
  RECURSIVE,
  each,
  iterable,
  codecOptions,
};
