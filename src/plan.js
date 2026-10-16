// The plan: the tree of nodes both backends compile, read out of a metaschema
// snapshot by snapshot.js. A plan is immutable and can be shared, which is how
// a collection in a layout of its own and the list of a schema's records call
// a compiled codec through a slot. Its canonical form and fingerprint are the
// schema's `toString()` and `id`.

/**
 * The nodes of a plan, as both backends read them.
 *
 * @typedef {object} ScalarNode A type from types.js.
 * @property {'scalar'} kind
 * @property {string} type The type name; `expected` and `code` name it in errors.
 * @property {((wire: unknown) => boolean) | null} check The wire check of an identity type
 *   (null for `json`); an enum keeps one for a union's tag.
 * @property {((value: unknown) => unknown) | null} pack Null for an identity type.
 * @property {((wire: unknown) => unknown) | null} unpack Total: a stray value stays as it is.
 * @property {(value: unknown) => unknown} [checkedPack] Converts a value that must be looked up
 *   or measured (an enum for a union's tag, the items of a list of differences), undefined for
 *   one of the wrong type.
 * @property {(wire: unknown) => unknown} [checkedUnpack] Checks and converts the wire in one
 *   call; every converted type has one.
 * @property {true} [always] A list of differences: its values are checked on encode.
 * @property {true} [delta] A column of a `columns` collection written as differences.
 * @property {boolean} [required] Only on a root scalar.
 * @property {boolean} [nullable] A slot that holds null as a value (json, null): never required.
 *
 * @typedef {object} Field
 * @property {string} key
 * @property {number} index The position on the wire.
 * @property {boolean} required
 * @property {string | number | boolean | null} def The default, a decoded value.
 * @property {Node} node
 * @property {string[]} [aliases] Keys the field had in older versions (Schema.resolve).
 *
 * @typedef {object} StructNode
 * @property {'struct'} kind
 * @property {Field[]} fields
 * @property {string[]} keys
 * @property {boolean} sparse
 * @property {number} tail Where the trailing run of optional fields starts.
 * @property {{ key: string, position: number, keys: string[], values: unknown[] }} [tag] On a
 *   union's branch: the discriminator it carries as the leading tag.
 * @property {Slot} [slot] On a compiled schema reached from this plan: the codec to call.
 *
 * @typedef {object} UnionNode
 * @property {'union'} kind
 * @property {string} key The discriminator.
 * @property {ScalarNode} tag An enum over the values of every branch, in order.
 * @property {unknown[]} values
 * @property {{ node: StructNode, first: number, count: number, source: StructNode }[]} branches
 *
 * @typedef {object} ArrayNode An array, or a Set travelling as one (`container: 'set'`).
 * @property {'array'} kind
 * @property {Node} item
 * @property {boolean} itemRequired
 * @property {string} layout
 * @property {'set'} [container]
 *
 * @typedef {object} MapNode A Map: `[k0, v0, k1, v1, …]` on the wire.
 * @property {'map'} kind
 * @property {ScalarNode} key A string or a number.
 * @property {Node} value
 * @property {boolean} valueRequired
 *
 * @typedef {{ kind: 'dict', value: Node, valueRequired: boolean }} DictNode An object used as
 *   a dictionary: its keys travel, as JSON keys.
 * @typedef {{ node: Node, required: boolean, def: Field['def'] }} TupleItem
 * @typedef {{ kind: 'tuple', items: TupleItem[] }} TupleNode
 * @typedef {{ kind: 'ref', name: string, slot: Slot }} RefNode A reference to an entity.
 * @typedef {{ codec: { encode: Function, decode: Function }, schema: object }} Slot A compiled
 *   schema: its codec, and the schema itself.
 * @typedef {ScalarNode | StructNode | UnionNode | ArrayNode | MapNode | DictNode | TupleNode
 *   | RefNode} Node
 */

const BRAND = Symbol.for('alexify.protoarray.brand');
const PLAN = Symbol.for('alexify.protoarray.plan');
const CODEC = Symbol.for('alexify.protoarray.codec');
// The error that made the automatic backend choice fall back to closures.
const FALLBACK = Symbol.for('alexify.protoarray.fallback');

const isSchema = (value) => value !== null && typeof value === 'object' && value[BRAND] === true;

// metaschema's brand: its Schema, Model and field types carry it. protoarray
// tells them by it, never by requiring metaschema.
const FOREIGN = Symbol.for('alexify.metaschema.brand');

// Whether a compiled schema's payload carries a string table, its own or one
// of a schema it calls: read by the plans that call it through a slot.
const INTERNED = Symbol('interned');

// A compiled schema in a slot: the codec it runs, the schema itself, whose
// plan Schema.resolve reads, and whether it holds interned strings.
const slotOf = (schema) => ({ codec: schema[CODEC], schema, interned: schema[INTERNED] });

// A name or a value prints as itself unless it could be read as part of the
// form around it (its punctuation, a leading quote, nothing at all), and a
// string among enum values unless it reads as a number: then it prints as a
// JSON string. Two schemas that print the same are the same schema.
const UNSAFE = /[:,{}[\]()|?=@;*~<>]|^"|^$/;
const print = (text) => (UNSAFE.test(text) ? JSON.stringify(text) : text);
const enumValue = (item) =>
  typeof item === 'string' && String(Number(item)) === item
    ? JSON.stringify(item)
    : print(`${item}`);

// The canonical form names every position and type, so two definitions that
// put the same values in the same slots print the same and share a fingerprint.
const canonical = (node) => {
  // A plan from Schema.resolve prints as its writer: the wire it reads.
  if (node.text !== undefined) return node.text;
  if (node.kind === 'struct') {
    const fields = node.fields.map((field) => {
      const def = field.def === null ? '' : `=${JSON.stringify(field.def)}`;
      return `${print(field.key)}:${field.required ? '' : '?'}${canonical(field.node)}${def}`;
    });
    return `${node.sparse ? 'sparse' : ''}{${fields.join(',')}}`;
  }
  if (node.kind === 'array') {
    const layout = node.layout === 'rows' ? '' : node.layout;
    const container = node.container === undefined ? '' : node.container;
    return `${layout}${container}[${node.itemRequired ? '' : '?'}${canonical(node.item)}]`;
  }
  if (node.kind === 'map' || node.kind === 'dict') {
    const value = `${node.valueRequired ? '' : '?'}${canonical(node.value)}`;
    return node.kind === 'map' ? `map<${node.key.type},${value}>` : `object<${value}>`;
  }
  if (node.kind === 'tuple') {
    const items = node.items.map((item) => {
      const def = item.def === null ? '' : `=${JSON.stringify(item.def)}`;
      return (item.required ? '' : '?') + canonical(item.node) + def;
    });
    return `(${items.join(',')})`;
  }
  if (node.kind === 'ref') return `@${print(node.name)}`;
  if (node.kind === 'union') {
    const branches = node.branches.map((branch) => canonical(branch.source)).join('|');
    return `union(${print(node.key)})[${branches}]`;
  }
  if (node.type === 'deltas') {
    return `~[${node.itemRequired ? '' : '?'}${canonical(node.item)}]`;
  }
  const values = node.values || node.names;
  let type = values === undefined ? node.type : `${node.type}(${values.map(enumValue).join('|')})`;
  if (node.decimals !== undefined) type = `${type}(${node.decimals})`;
  // An interned string and a number written as differences have their own wire.
  if (node.intern === true) type = `${type}*`;
  if (node.delta === true) type = `${type}~`;
  // Only a root scalar carries its own optionality; a field's is on the field.
  return node.required === false ? `?${type}` : type;
};

// The nodes a node that is no scalar holds, in their order: what every walk
// over a plan visits. What a slot calls is its schema's plan, which each walk
// treats in its own way. A union's branch a resolved reader dropped is null.
const children = (node) => {
  if (node.kind === 'struct') return node.fields.map((field) => field.node);
  if (node.kind === 'union') return node.branches.map((branch) => branch.node);
  if (node.kind === 'tuple') return node.items.map((item) => item.node);
  if (node.kind === 'array') return [node.item];
  // A map or a dictionary.
  return [node.value];
};

// The other entities a plan reaches by reference, by name, sorted: what its
// id is computed from with its canonical form. A reference prints as the
// entity's name, so without them two versions whose referenced entity changed
// would share an id. The schemas in `selves` (the schema itself, the record of
// its list) are not other entities. A chain of references is walked as a list
// of pending plans, not as a recursion.
const referenced = (plan, selves) => {
  const entities = new Map();
  const pending = [plan];
  const walk = (node) => {
    if (node === null || node.kind === 'scalar') return;
    if (node.kind === 'ref') {
      const { schema } = node.slot;
      if (schema == null || selves.includes(schema) || entities.has(node.name)) return;
      entities.set(node.name, schema);
      pending.push(schema[PLAN]);
      return;
    }
    for (const child of children(node)) walk(child);
  };
  while (pending.length > 0) walk(pending.pop());
  const names = Array.from(entities.keys()).sort();
  return names.map((name) => [name, entities.get(name)]);
};

// The canonical form, then `;Name=<canonical form>` for every other entity
// reached. A schema that references no other entity (its own name included)
// signs with its canonical form alone.
const signature = (text, entities) => {
  let out = text;
  for (const [name, schema] of entities) out += `;${print(name)}=${schema}`;
  return out;
};

// FNV-1a, 32-bit, over UTF-16 code units: enough to tell schema versions
// apart in a handshake, and cheap enough to compute on every page load. It
// hashes a text a piece at a time, so the default id of a signature is
// computed without joining it.
const OFFSET = 0x811c9dc5;

const hashed = (hash, text) => {
  let out = hash;
  for (let i = 0; i < text.length; i++) {
    out ^= text.charCodeAt(i);
    out = Math.imul(out, 0x01000193);
  }
  return out;
};

const hex = (hash) => (hash >>> 0).toString(16).padStart(8, '0');

const fingerprint = (text) => hex(hashed(OFFSET, text));

// The id of a schema: its fingerprint function of the signature, which the
// default one hashes piece by piece.
const identify = (text, entities, hash) => {
  if (hash !== fingerprint) return hash(signature(text, entities));
  let out = hashed(OFFSET, text);
  for (const [name, schema] of entities) {
    out = hashed(hashed(hashed(out, ';'), print(name)), '=');
    out = hashed(out, String(schema));
  }
  return hex(out);
};

module.exports = {
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
};
