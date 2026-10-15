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
//   Schema instances from the definitions with `{ compiled }`: the full API,
//   `instanceof` the package's errors, and an error when the module is older
//   than the definition (ERR_COMPILED_MISMATCH);
// - `runtime: 'inline'` carries its own runtime instead: the source of the
//   closed kernels of errors.js, types.js, layouts.js, the browser base64 and
//   `inline` below, and exports plain objects with `encode`, `decode`,
//   `stringify`, `parse` and `check`. Nothing to import; errors are told by
//   their `name` and `code`.
//
// `runtime` is what modules of the first kind import.

const { Schema, SETTINGS, codecOptions } = require('./schema.js');
const codegen = require('./codegen.js');
const errors = require('./errors.js');
const types = require('./types.js');
const layouts = require('./layouts.js');
const base64 = require('./runtime/browser.js');
const { SchemaDefinitionError } = errors;
const { PLAN, CODEC, CHECKER, FOREIGN, isSchema } = require('./plan.js');

const invalid = (text) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', text);

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
    get checker() {
      return target()[CHECKER];
    },
  }),
};

// What an inline module defines its schemas with: Schema's work around a
// codec (the layouts, the string table, the shape of the value, the schema's
// name on its errors), no more. Closed, like the kernels it runs on.
const inline = (kernelErrors, kernelTypes, kernelLayouts) => {
  const { EncodeError, DecodeError, boundary } = kernelErrors;
  const all = { encode: true, decode: true };
  const define = (spec) => {
    const wrap = (codec, validate) => {
      let out = codec;
      if (spec.layout === 'flat' || spec.layout === 'columns') {
        out = kernelLayouts[spec.layout](out, spec.record, validate);
      }
      return spec.interned ? kernelLayouts.withTable(out, validate.decode) : out;
    };
    const codec = wrap(spec.codec, spec.validate);
    const checker = wrap(spec.checker, all);
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
      check: (value) => {
        try {
          encodeWith(checker, value, 'encode');
          return null;
        } catch (error) {
          if (error instanceof EncodeError) return error;
          throw error;
        }
      },
      toString: () => spec.canonical,
    };
    Object.defineProperty(schema, 'codec', { value: codec });
    Object.defineProperty(schema, 'checker', { value: checker });
    return schema;
  };
  const slot = (target) => ({
    get codec() {
      return target().codec;
    },
    get checker() {
      return target().checker;
    },
  });
  return { define, slot, types: kernelTypes };
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

// The schemas a plan calls through slots: embedded by value, referenced by
// name, its own name included.
const reached = (node, out) => {
  if (node === null || node.kind === 'scalar') return;
  if (node.slot !== undefined) {
    out.add(node.slot.schema);
    if (node.kind === 'ref') return;
  }
  if (node.kind === 'struct') for (const field of node.fields) reached(field.node, out);
  else if (node.kind === 'union') for (const branch of node.branches) reached(branch.node, out);
  else if (node.kind === 'tuple') for (const item of node.items) reached(item.node, out);
  else if (node.kind === 'array') reached(node.item, out);
  else if (node.kind === 'map' || node.kind === 'dict') reached(node.value, out);
};

// A definition as a literal: schemas by the names the module gives them,
// calculated fields and other functions left out (they have no position).
const literal = (value, names) => {
  if (isSchema(value)) return names.get(value);
  if (Array.isArray(value)) return `[${value.map((item) => literal(item, names)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => typeof value[key] !== 'function');
    return `{${keys.map((key) => `${JSON.stringify(key)}:${literal(value[key], names)}`).join(',')}}`;
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
};

// A helper of generated code as the expression that makes it again.
const recipeOf = (helper, names) => {
  if (Array.isArray(helper)) return JSON.stringify(helper);
  if (helper.recipe !== undefined) return helper.recipe;
  return `R.slot(()=>${names.get(helper.schema)})`;
};

// The codec of one schema as an expression: the generated function body run
// with its helpers, as codegen.build runs it.
const codecSource = (schema, checking, names) => {
  const { target, options } = codecOptions(schema[PLAN], schema[SETTINGS], checking);
  const { body, helpers } = codegen.generate(target, options);
  const recipes = helpers.map((helper) => recipeOf(helper, names)).join(',');
  return `(function(H,F,N,E){${body}})([${recipes}],F,N,E)`;
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

const importDefinition = (schema, names) => {
  const settings = schema[SETTINGS];
  const options = [];
  for (const key of ['validate', 'sparse', 'layout', 'intern', 'stringify']) {
    options.push(`${key}:${JSON.stringify(settings[key])}`);
  }
  const by = Object.keys(settings.schemas).filter((key) => isSchema(settings.schemas[key]));
  if (by.length > 0) {
    const entries = by.map((key) => `${JSON.stringify(key)}:${names.get(settings.schemas[key])}`);
    options.push(`schemas:{${entries.join(',')}}`);
  }
  const compiled = [
    `canonical:${JSON.stringify(schema.toString())}`,
    `id:${JSON.stringify(schema.id)}`,
    `codec:${codecSource(schema, false, names)}`,
    `checker:${codecSource(schema, true, names)}`,
  ];
  options.push(`compiled:{${compiled.join(',')}}`);
  const definition = literal(schema.definition, names);
  return `new Schema(${JSON.stringify(schema.name)},${definition},{${options.join(',')}})`;
};

const inlineDefinition = (schema, names) => {
  const plan = schema[PLAN];
  const settings = schema[SETTINGS];
  const { validate } = codecOptions(plan, settings, false).options;
  const spec = [
    `name:${JSON.stringify(schema.name)}`,
    `id:${JSON.stringify(schema.id)}`,
    `canonical:${JSON.stringify(schema.toString())}`,
    `kind:${JSON.stringify(plan.kind)}`,
    `keys:${JSON.stringify(schema.keys)}`,
    `layout:${JSON.stringify(schema.layout)}`,
    `interned:${codecOptions(plan, settings, false).interned}`,
    `validate:${JSON.stringify(validate)}`,
    `codec:${codecSource(schema, false, names)}`,
    `checker:${codecSource(schema, true, names)}`,
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
    if (
      schema.definition !== null &&
      typeof schema.definition === 'object' &&
      schema.definition[FOREIGN] !== undefined
    ) {
      throw invalid('A schema of a metaschema Schema: write the one fromMetaschema builds instead');
    }
    names.set(schema, `S${names.size}`);
    const settings = schema[SETTINGS];
    const deps = new Set();
    reached(plan, deps);
    for (const key of Object.keys(settings.schemas)) {
      if (isSchema(settings.schemas[key])) deps.add(settings.schemas[key]);
    }
    deps.delete(schema);
    for (const dep of deps) visit(dep);
    order.push(schema);
  };
  for (const [, schema] of entries) visit(schema);

  const esm = format === 'esm';
  const lines = [
    `// Generated by @alexify/protoarray toSource (runtime: ${kind}, format: ${format}).`,
    '// Do not edit: generate it again when a definition changes.',
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
  } else {
    lines.push(`const errors = (${errors.kernel})();`);
    lines.push(`const base64 = (${base64.kernel})();`);
    lines.push(`const T = (${types.kernel})(base64);`);
    lines.push(`const layouts = (${layouts.kernel})(errors, T);`);
    lines.push(`const R = (${inline})(errors, T, layouts);`);
    lines.push('const F = errors.fail;', 'const N = errors.nest;', 'const E = errors.refuse;');
  }
  const write = kind === 'import' ? importDefinition : inlineDefinition;
  for (const schema of order) lines.push(`const ${names.get(schema)} = ${write(schema, names)};`);
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
