// A Schema is a compiled codec: the definition is parsed into a plan once, the
// plan is compiled by the codegen backend (or by closures where code generation
// is unavailable or switched off), and the instance carries both.

const { SchemaDefinitionError, EncodeError, DecodeError } = require('./errors.js');
const { BRAND, PLAN, CODEC, compilePlan, canonical, fingerprint } = require('./plan.js');
const codegen = require('./codegen.js');
const closures = require('./closures.js');
const layouts = require('./layouts.js');

const LAYOUTS = ['rows', 'flat', 'columns'];
const OPTIONS = ['codegen', 'validate', 'sparse', 'layout', 'schemas'];

const readOptions = (options, name) => {
  const settings = {
    codegen: undefined,
    validate: true,
    sparse: false,
    layout: 'rows',
    schemas: {},
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
    if (value === undefined && OPTIONS.includes(key)) continue;
    const valid =
      key === 'layout'
        ? LAYOUTS.includes(value)
        : key === 'schemas'
          ? value !== null && typeof value === 'object'
          : OPTIONS.includes(key) && typeof value === 'boolean';
    if (!valid) {
      throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', `Invalid option "${key}"`, name);
    }
    settings[key] = value;
  }
  return settings;
};

class Schema {
  #settings;
  #id = null;
  #list = null;

  constructor(name, definition, options) {
    if (typeof name !== 'string') {
      options = definition;
      definition = name;
      name = '';
    }
    const settings = readOptions(options, name);
    const selfSlot = { codec: null };
    const plan = compilePlan(definition, { ...settings, name, selfSlot });
    const useCodegen = settings.codegen === undefined ? codegen.available : settings.codegen;
    if (useCodegen && !codegen.available) {
      throw new SchemaDefinitionError(
        'ERR_CODEGEN_UNAVAILABLE',
        'Code generation is not available in this runtime: pass { codegen: false }',
        name,
      );
    }
    const backend = useCodegen ? codegen : closures;
    const target = plan.kind === 'array' && plan.layout !== 'rows' ? plan.item : plan;
    let codec = backend.build(target, { validate: settings.validate });
    if (target !== plan) codec = layouts[plan.layout](codec, plan.item.fields.length);
    selfSlot.codec = codec;
    Object.defineProperty(this, BRAND, { value: true });
    Object.defineProperty(this, PLAN, { value: plan });
    Object.defineProperty(this, CODEC, { value: codec });
    this.name = name;
    this.definition = definition;
    this.keys = Object.freeze(plan.kind === 'struct' ? plan.keys.slice() : []);
    this.backend = useCodegen ? 'codegen' : 'closures';
    this.layout = plan.kind === 'array' ? plan.layout : plan.sparse === true ? 'sparse' : 'dense';
    this.#settings = settings;
  }

  static from(definition, options) {
    return new Schema('', definition, options);
  }

  // Keys only: every field is `json`, values travel as they are.
  static keys(keys, options) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
      throw new SchemaDefinitionError('ERR_INVALID_DEFINITION', 'Schema.keys takes a list of keys');
    }
    const definition = {};
    for (const key of keys) definition[key] = 'json';
    return new Schema('', definition, options);
  }

  // Fingerprint of the canonical form: two sides agree on the wire format when
  // their ids match, whatever names they use.
  get id() {
    if (this.#id === null) this.#id = fingerprint(this.toString());
    return this.#id;
  }

  // The same records as rows: `[[...], [...]]`.
  get list() {
    if (this.#list === null) {
      const { codegen: useCodegen, validate } = this.#settings;
      this.#list = new Schema('', { array: this }, { codegen: useCodegen, validate });
    }
    return this.#list;
  }

  encode(value) {
    if (this[PLAN].kind !== 'scalar' && (value === null || typeof value !== 'object')) {
      throw new EncodeError('object', 'Value is not an object');
    }
    return this[CODEC].encode(value);
  }

  decode(array, options) {
    return this[CODEC].decode(array, options !== undefined && options.strict === true);
  }

  stringify(value) {
    return JSON.stringify(this.encode(value));
  }

  parse(text, options) {
    let array;
    try {
      array = JSON.parse(text);
    } catch (error) {
      throw new DecodeError('json', '', '', error);
    }
    return this.decode(array, options);
  }

  toString() {
    return canonical(this[PLAN]);
  }
}

module.exports = { Schema };
