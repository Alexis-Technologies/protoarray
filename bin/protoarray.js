#!/usr/bin/env node
/**
 * protoarray compile <module> [--out <file>] [--format cjs|esm] [--runtime import|inline]
 *                              [--only <A,B>] [--binary]
 *
 * Loads a module (CommonJS or ES), takes the schemas it exports and writes
 * the module @alexify/protoarray/standalone's toSource makes of them: their
 * generated code, for runtimes that forbid compiling source text. A schema is
 * a protoarray Schema or a metaschema Schema (built with Schema.from); a
 * metaschema Model stands for its entities, each under its name. A module
 * whose export is one schema gives a module with that one as its default
 * export; otherwise the schemas keep their export names. `--only` keeps the
 * named ones. `--binary` writes each schema's codec of the binary wire next to
 * its text codec (a module without it carries no bytes). Without `--out` the
 * source goes to stdout; `--out` makes the directory it names and never writes
 * over the module it reads. The generated module needs no metaschema.
 *
 * Exit codes: 0 done (`--help` included), 1 the module or its schemas could
 * not be compiled, 2 the command line is wrong.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Schema } = require('../index.js');
const { toSource } = require('../standalone.js');

const USAGE =
  'Usage: protoarray compile <module> [--out <file>] [--format cjs|esm] ' +
  '[--runtime import|inline] [--only <A,B>] [--binary]';

const BRAND = Symbol.for('alexify.protoarray.brand');
const FOREIGN = Symbol.for('alexify.metaschema.brand');
const isObject = (value) => value !== null && typeof value === 'object';
const isSchema = (value) => isObject(value) && value[BRAND] === true;
const isForeign = (value, brand) => isObject(value) && value[FOREIGN] === brand;

const VALUED = new Set(['--out', '--format', '--runtime', '--only']);
const FLAGS = new Set(['--binary']);

// A mistake on the command line, and what the CLI itself refuses of a module
// that loads: told from an error inside the module, whose stack is reported.
class UsageError extends Error {}
class Refusal extends Error {}

const parseArgs = (argv) => {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [command, ...rest] = argv;
  if (command !== 'compile') throw new UsageError(USAGE);
  const options = {};
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) files.push(arg);
    else if (FLAGS.has(arg)) options[arg.slice(2)] = true;
    else if (VALUED.has(arg) && i + 1 < rest.length) options[arg.slice(2)] = rest[++i];
    else throw new UsageError(`Unknown or incomplete option ${arg}\n${USAGE}`);
  }
  if (files.length !== 1) throw new UsageError(USAGE);
  return { file: files[0], ...options };
};

// CommonJS first; an ES module through import(), which require() cannot load
// on older Node.js versions.
const load = async (file) => {
  const full = path.resolve(file);
  try {
    return require(full);
  } catch (error) {
    if (error.code !== 'ERR_REQUIRE_ESM' && error.code !== 'ERR_REQUIRE_ASYNC_MODULE') throw error;
  }
  return import(pathToFileURL(full).href);
};

// A protoarray schema of an export: itself, or the one a metaschema Schema
// builds; anything else is not a schema.
const schemaOf = (value) => {
  if (isSchema(value)) return value;
  if (isForeign(value, 'Schema')) return Schema.from(value);
  return null;
};

// The schemas a module exports by name: a metaschema Model's entities under
// their own names.
const exported = (loaded) => {
  const out = {};
  const add = (name, schema) => {
    if (Object.hasOwn(out, name)) throw new Refusal(`Two schemas are exported as "${name}"`);
    out[name] = schema;
  };
  for (const name of Object.keys(loaded)) {
    const value = loaded[name];
    if (isForeign(value, 'Model')) {
      const entities = Schema.fromModel(value);
      for (const entity of Object.keys(entities)) add(entity, entities[entity]);
    } else {
      const schema = schemaOf(value);
      if (schema !== null) add(name, schema);
    }
  }
  return out;
};

// The schemas a module exports: itself when it is one, the entities of a
// Model it is, its schemas by name otherwise (an ES module's default export
// when it has nothing else).
const schemasOf = (loaded, only) => {
  const single = schemaOf(loaded);
  if (single !== null) return single;
  const all = isForeign(loaded, 'Model') ? { ...Schema.fromModel(loaded) } : exported(loaded);
  const names = Object.keys(all);
  if (names.length === 1 && names[0] === 'default') return all.default;
  const chosen = only === undefined ? names : only.split(',').map((name) => name.trim());
  const out = {};
  for (const name of chosen) {
    if (!Object.hasOwn(all, name)) throw new Refusal(`The module exports no schema "${name}"`);
    out[name] = all[name];
  }
  if (Object.keys(out).length === 0) throw new Refusal('The module exports no schema');
  return out;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (args.out !== undefined && path.resolve(args.out) === path.resolve(args.file)) {
    throw new UsageError(`--out names the module it compiles: ${args.out}`);
  }
  const schemas = schemasOf(await load(args.file), args.only);
  const options = { runtime: args.runtime, format: args.format, binary: args.binary };
  const source = toSource(schemas, options);
  if (args.out === undefined) process.stdout.write(source);
  else {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, source);
  }
};

// What went wrong, enough to act on: an error of protoarray or metaschema with
// its code and the schema and field it names; anything else (a module that
// does not load) with its stack, which names the file and the line.
const report = (error) => {
  if (error instanceof UsageError || error instanceof Refusal) return error.message;
  if (error instanceof Error && error.name === 'SchemaDefinitionError') {
    const where = [];
    if (error.schema) where.push(`schema "${error.schema}"`);
    if (error.field) where.push(`field "${error.field}"`);
    const place = where.length === 0 ? '' : ` (${where.join(', ')})`;
    return `${error.name} ${error.code}: ${error.message}${place}`;
  }
  return error instanceof Error ? String(error.stack) : String(error);
};

main().catch((error) => {
  process.stderr.write(`${report(error)}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
