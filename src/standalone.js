// The `./standalone` subpath: a schema's codec as the source of a module, for
// runtimes that forbid compiling source text (a strict CSP, Cloudflare
// Workers, Vercel Edge), where the generated code of a schema is otherwise
// replaced by the closures backend.
//
// `toSource(schemas, { runtime, format })` writes a CommonJS or ES module
// with the code codegen.js generates for each schema and every schema they
// reach, the functions it calls written as the expressions that make them
// (`recipe`s from types.js):
//
// - `runtime: 'import'` (the default) imports this package and builds real
//   Schema instances from the snapshots they were read from with `{ compiled
//   }`, the entities of one snapshot together (Schema.fromModel): the full
//   API, `instanceof` the package's errors, and an error when the module is
//   older than the schema (ERR_COMPILED_MISMATCH). metaschema is not needed;
// - `runtime: 'inline'` carries its own runtime instead: the source of the
//   closed kernels of errors.js, types.js, layouts.js, the browser base64 and
//   `inline` below, and exports plain objects with `encode`, `decode`,
//   `stringify` and `parse`. Nothing to import; errors are told by their
//   `name` and `code`.
//
// `runtime` is what modules of the first kind import.

const { Schema, SETTINGS, ENTITY, codecOptions } = require('./schema.js');
const codegen = require('./codegen.js');
const errors = require('./errors.js');
const types = require('./types.js');
const layouts = require('./layouts.js');
const base64 = require('./runtime/browser.js');
const { SchemaDefinitionError } = errors;
const { PLAN, CODEC, isSchema } = require('./plan.js');

const invalid = (text) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', text);

// A collection in a layout of its own inside a record: its record's codec in
// the layout, and the string table where the schema has one. Closed.
const nesting = (kernelLayouts) => (spec) => {
  let codec = kernelLayouts[spec.layout](spec.codec, spec.record, spec.validate);
  if (spec.interned) codec = kernelLayouts.withTable(codec, spec.validate.decode);
  return { codec };
};

// A slot over a schema of the module, read when the codec is called: a schema
// may reach one defined after it, itself included.
const runtime = {
  types,
  fail: errors.fail,
  nest: errors.nest,
  refuse: errors.refuse,
  slot: (target) => ({
    get codec() {
      return target()[CODEC];
    },
  }),
  nested: nesting(layouts),
};

// What an inline module defines its schemas with: Schema's work around a
// codec (the layouts, the string table, the shape of the value, the schema's
// name on its errors), no more. Closed, like the kernels it runs on, and given
// `nesting` from outside, since its source is written into the module apart.
const inline = (kernelErrors, kernelTypes, kernelLayouts, nested) => {
  const { EncodeError, DecodeError, boundary } = kernelErrors;
  const define = (spec) => {
    let codec = spec.codec;
    const { validate } = spec;
    if (spec.layout === 'flat' || spec.layout === 'columns') {
      codec = kernelLayouts[spec.layout](codec, spec.record, validate);
    }
    if (spec.interned) codec = kernelLayouts.withTable(codec, validate.decode);
    const run = (call) => (spec.interned ? kernelLayouts.isolated(call) : call());
    const encodeWith = (target, value, method) => {
      if (spec.kind !== 'scalar' && (value === null || typeof value !== 'object')) {
        const code = spec.kind === 'array' || spec.kind === 'tuple' ? 'array' : 'object';
        throw boundary(new EncodeError(code), spec.name, false);
      }
      try {
        return run(() => target[method](value));
      } catch (error) {
        throw boundary(error, spec.name, false);
      }
    };
    const schema = {
      name: spec.name,
      id: spec.id,
      keys: spec.keys,
      layout: spec.layout,
      backend: 'standalone',
      encode: (value) => encodeWith(codec, value, 'encode'),
      decode: (array, options) => {
        const strict = options != null && options.strict === true;
        try {
          return run(() => codec.decode(array, strict));
        } catch (error) {
          throw boundary(error, spec.name, true);
        }
      },
      stringify: (value) =>
        codec.stringify === undefined
          ? JSON.stringify(schema.encode(value))
          : encodeWith(codec, value, 'stringify'),
      parse: (text, options) => {
        let array;
        try {
          array = JSON.parse(text);
        } catch (error) {
          throw boundary(new DecodeError('json', '', '', error), spec.name, true);
        }
        return schema.decode(array, options);
      },
      toString: () => spec.canonical,
    };
    Object.defineProperty(schema, 'codec', { value: codec });
    return schema;
  };
  const slot = (target) => ({
    get codec() {
      return target().codec;
    },
  });
  return { define, slot, nested: nested(kernelLayouts), types: kernelTypes };
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RUNTIMES = ['import', 'inline'];
const FORMATS = ['cjs', 'esm'];

const optionsOf = (options) => {
  const source = options == null ? {} : options;
  if (typeof source !== 'object') throw invalid('Invalid options: expected an object');
  for (const key of Object.keys(source)) {
    if (key !== 'runtime' && key !== 'format') throw invalid(`Invalid option "${key}"`);
  }
  const { runtime: kind = 'import', format = 'cjs' } = source;
  if (!RUNTIMES.includes(kind)) throw invalid('Invalid option "runtime"');
  if (!FORMATS.includes(format)) throw invalid('Invalid option "format"');
  return { kind, format };
};

// The schemas to write: one as the module's default export, or several by
// the names they are exported under.
const exportsOf = (input) => {
  if (isSchema(input)) return [[null, input]];
  if (input === null || typeof input !== 'object') {
    throw new SchemaDefinitionError(
      'ERR_SCHEMA_EXPECTED',
      'A schema or a record of schemas expected',
    );
  }
  const entries = Object.entries(input);
  for (const [key, schema] of entries) {
    if (!IDENTIFIER.test(key)) throw invalid(`"${key}" is not a name a module can export`);
    if (!isSchema(schema)) {
      throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', `"${key}" is not a schema`);
    }
  }
  return entries;
};

// The schemas of the module a plan calls through slots: the entities it
// references, its own included. A collection in a layout of its own inside a
// record has no snapshot: its codec is written in place (`R.nested`).
const reached = (node, out) => {
  if (node === null || node.kind === 'scalar') return;
  if (node.slot !== undefined) {
    if (node.slot.schema.snapshot !== null) {
      out.add(node.slot.schema);
      return;
    }
    reached(node.slot.schema[PLAN].item, out);
    return;
  }
  if (node.kind === 'struct') for (const field of node.fields) reached(field.node, out);
  else if (node.kind === 'union') for (const branch of node.branches) reached(branch.node, out);
  else if (node.kind === 'tuple') for (const item of node.items) reached(item.node, out);
  else if (node.kind === 'array') reached(node.item, out);
  else if (node.kind === 'map' || node.kind === 'dict') reached(node.value, out);
};

// What the record of a flat or columns collection is for the layouts.
const recordOf = (plan) => ({
  fields: plan.item.fields.map((field) => ({
    index: field.index,
    key: field.key,
    wire: field.wire,
    node: { delta: field.node.delta === true, expected: field.node.expected },
  })),
});

// A helper of generated code as the expression that makes it again: a type
// node by its recipe, a schema of the module by its name, a nested layout in
// place.
const recipeOf = (helper, names) => {
  if (Array.isArray(helper)) return JSON.stringify(helper);
  if (helper.recipe !== undefined) return helper.recipe;
  const { schema } = helper;
  if (schema.snapshot !== null) return `R.slot(()=>${names.get(schema)})`;
  const plan = schema[PLAN];
  const { interned, options } = codecOptions(plan, schema[SETTINGS]);
  const spec = [
    `layout:${JSON.stringify(plan.layout)}`,
    `record:${JSON.stringify(recordOf(plan))}`,
    `interned:${interned}`,
    `validate:${JSON.stringify(options.validate)}`,
    `codec:${codecSource(schema, names)}`,
  ];
  return `R.nested({${spec.join(',')}})`;
};

// The codec of one schema as an expression: the generated function body run
// with its helpers, as codegen.build runs it.
const codecSource = (schema, names) => {
  const { target, options } = codecOptions(schema[PLAN], schema[SETTINGS]);
  const { body, helpers } = codegen.generate(target, options);
  const recipes = helpers.map((helper) => recipeOf(helper, names)).join(',');
  return `(function(H,F,N,E){${body}})([${recipes}],F,N,E)`;
};

// The options a schema of the module is built with again, its compiled codec
// among them. A fingerprint function has no source: the id travels instead.
const OPTIONS = ['validate', 'sparse', 'layout', 'intern', 'delta', 'stringify', 'references'];

const optionsSource = (schema, names) => {
  const settings = schema[SETTINGS];
  const options = OPTIONS.map((key) => `${key}:${JSON.stringify(settings[key])}`);
  options.push(`types:${JSON.stringify(settings.types)}`);
  const compiled = [
    `canonical:${JSON.stringify(schema.toString())}`,
    `id:${JSON.stringify(schema.id)}`,
    `codec:${codecSource(schema, names)}`,
  ];
  options.push(`compiled:{${compiled.join(',')}}`);
  return `{${options.join(',')}}`;
};

const inlineDefinition = (schema, names) => {
  const plan = schema[PLAN];
  const settings = schema[SETTINGS];
  const { interned, options } = codecOptions(plan, settings);
  const spec = [
    `name:${JSON.stringify(schema.name)}`,
    `id:${JSON.stringify(schema.id)}`,
    `canonical:${JSON.stringify(schema.toString())}`,
    `kind:${JSON.stringify(plan.kind)}`,
    `keys:${JSON.stringify(schema.keys)}`,
    `layout:${JSON.stringify(schema.layout)}`,
    `interned:${interned}`,
    `validate:${JSON.stringify(options.validate)}`,
    `codec:${codecSource(schema, names)}`,
  ];
  if (schema.layout === 'flat' || schema.layout === 'columns') {
    spec.push(`record:${JSON.stringify(recordOf(plan))}`);
  }
  return `R.define({${spec.join(',')}})`;
};

const toSource = (input, options) => {
  const { kind, format } = optionsOf(options);
  const entries = exportsOf(input);
  // Every schema reached, the ones it depends on before it.
  const names = new Map();
  const order = [];
  const visit = (schema) => {
    if (names.has(schema)) return;
    const plan = schema[PLAN];
    if (plan.text !== undefined) {
      throw invalid('A resolved schema is built at runtime: write its writer and reader instead');
    }
    if (schema.snapshot === null) {
      throw invalid('The list of a schema is built at runtime: write the schema instead');
    }
    names.set(schema, `S${names.size}`);
    const deps = new Set();
    reached(plan, deps);
    deps.delete(schema);
    for (const dep of deps) visit(dep);
    order.push(schema);
  };
  for (const [, schema] of entries) visit(schema);

  const esm = format === 'esm';
  const lines = [
    `// Generated by @alexify/protoarray toSource (runtime: ${kind}, format: ${format}).`,
    '// Do not edit: generate it again when a schema changes.',
  ];
  if (!esm) lines.push("'use strict';");
  if (kind === 'import') {
    if (esm) {
      lines.push("import { Schema } from '@alexify/protoarray';");
      lines.push("import { runtime as R } from '@alexify/protoarray/standalone';");
    } else {
      lines.push("const { Schema } = require('@alexify/protoarray');");
      lines.push("const { runtime: R } = require('@alexify/protoarray/standalone');");
    }
    lines.push(
      'const F = R.fail;',
      'const N = R.nest;',
      'const E = R.refuse;',
      'const T = R.types;',
    );
    // The entities of one snapshot are built together, so that their
    // references reach one another; one entity built twice with other options
    // is built on its own.
    const groups = new Map();
    const alone = [];
    for (const schema of order) {
      let group = groups.get(schema.snapshot);
      if (group === undefined) groups.set(schema.snapshot, (group = new Map()));
      if (group.has(schema[ENTITY])) alone.push(schema);
      else group.set(schema[ENTITY], schema);
    }
    let index = 0;
    const snapshots = new Map();
    for (const [snapshot, group] of groups) {
      const model = `M${index++}`;
      snapshots.set(snapshot, model);
      lines.push(`const ${model}$ = ${JSON.stringify(snapshot)};`);
      const entities = [];
      for (const [entity, schema] of group) {
        entities.push(`${JSON.stringify(entity)}:${optionsSource(schema, names)}`);
      }
      lines.push(
        `const ${model} = Schema.fromModel(${model}$,{entities:{${entities.join(',')}}});`,
      );
      for (const [entity, schema] of group) {
        lines.push(`const ${names.get(schema)} = ${model}[${JSON.stringify(entity)}];`);
      }
    }
    for (const schema of alone) {
      const own = optionsSource(schema, names).slice(0, -1);
      const model = snapshots.get(schema.snapshot);
      const entity = `entity:${JSON.stringify(schema[ENTITY])}`;
      const name = JSON.stringify(schema.name);
      lines.push(`const ${names.get(schema)} = new Schema(${name},${model}$,${own},${entity}});`);
    }
  } else {
    lines.push(`const errors = (${errors.kernel})();`);
    lines.push(`const base64 = (${base64.kernel})();`);
    lines.push(`const T = (${types.kernel})(base64);`);
    lines.push(`const layouts = (${layouts.kernel})(errors, T);`);
    lines.push(`const R = (${inline})(errors, T, layouts, ${nesting});`);
    lines.push('const F = errors.fail;', 'const N = errors.nest;', 'const E = errors.refuse;');
    for (const schema of order) {
      lines.push(`const ${names.get(schema)} = ${inlineDefinition(schema, names)};`);
    }
  }
  if (entries.length === 1 && entries[0][0] === null) {
    const name = names.get(entries[0][1]);
    lines.push(esm ? `export default ${name};` : `module.exports = ${name};`);
  } else {
    const list = entries.map(([key, schema]) => `${names.get(schema)} as ${key}`);
    const pairs = entries.map(([key, schema]) => `${key}: ${names.get(schema)}`);
    lines.push(
      esm ? `export { ${list.join(', ')} };` : `module.exports = { ${pairs.join(', ')} };`,
    );
  }
  return `${lines.join('\n')}\n`;
};

let registered = false;

// Adds `schema.toSource(options)`. Once per process.
const register = () => {
  if (registered) return;
  registered = true;
  Object.defineProperty(Schema.prototype, 'toSource', {
    value(options) {
      return toSource(this, options);
    },
    writable: true,
    configurable: true,
  });
};

module.exports = { toSource, runtime, register };
// The inline kernel itself, for the tests that run it in process; not
// enumerable, so not part of the subpath's exports.
Object.defineProperty(module.exports, 'inline', { value: inline });
