#!/usr/bin/env node
/**
 * protoarray compile <module> [--out <file>] [--format cjs|esm] [--runtime import|inline]
 *                              [--only <A,B>] [--binary]
 * protoarray snapshot <module> [--only <A,B>] [--out <file>]
 * protoarray check <module> --against <baseline.json> [--only <A,B>] [--strict] [--json]
 *
 * Every command loads a module (CommonJS or ES) and takes the schemas it
 * exports. A schema is a protoarray Schema or a metaschema Schema (built with
 * Schema.from); a metaschema Model stands for its entities, each under its
 * name. A module whose export is one schema stands for that one (as `default`
 * where a name is needed); otherwise the schemas keep their export names.
 * `--only` keeps the named ones. An option takes its value as the next word
 * or after `=`. Without `--out` the output goes to stdout; `--out` makes the
 * directory it names and never writes over the module it reads, however the
 * module was named (`./schemas` for `schemas.js`, a link to it).
 *
 * `compile` writes the module @alexify/protoarray/standalone's toSource makes
 * of the schemas: their generated code, for runtimes that forbid compiling
 * source text; `--binary` writes each schema's codec of the binary wire next to
 * its text codec (a module without it carries no bytes). The generated module
 * needs no metaschema.
 *
 * `snapshot` writes the baseline of @alexify/protoarray/evolve: the schemas as
 * JSON, to keep with the code. `check` compares the schemas of the module with
 * the ones of a baseline, by export name, and reports every place where the
 * module reads an older payload differently (one line per problem, or
 * `{ ok, schemas }` with `--json`, each schema with the ids of its two
 * versions); `--strict` fails on warnings too.
 *
 * Exit codes: 0 done (`--help` included; `check`: compatible), 1 `check`:
 * incompatible, 2 the command line is wrong, 3 the module, its schemas or the
 * baseline could not be used (as `{ ok: false, error }` on stdout with
 * `--json`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Schema } = require('../index.js');
const { toSource } = require('../standalone.js');
const { compatible, baseline, restore } = require('../evolve.js');
const { join, step } = require('../src/errors.js');

const BRAND = Symbol.for('alexify.protoarray.brand');
const FOREIGN = Symbol.for('alexify.metaschema.brand');
const isObject = (value) => value !== null && typeof value === 'object';
const isSchema = (value) => isObject(value) && value[BRAND] === true;
const isForeign = (value, brand) => isObject(value) && value[FOREIGN] === brand;

// A mistake on the command line, and what the CLI itself refuses of a module
// that loads: told from an error inside the module, whose stack is reported.
// Each has a code, as the errors of protoarray do, for the JSON of a failure.
class UsageError extends Error {
  code = 'ERR_USAGE';
}
class Refusal extends Error {
  code = 'ERR_REFUSED';
}

// A key of a record as given, `__proto__` included: an ES module may export it.
const put = (object, key, value) =>
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });

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

// The file a path names as `require` finds it (`./schemas` is `schemas.js`
// or `schemas/index.js`), through its links; a path nothing is at yet, or an
// ES module, as given.
const fileOf = (file) => {
  const full = path.resolve(file);
  let target = full;
  try {
    target = require.resolve(full);
  } catch {
    target = full;
  }
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
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
    put(out, name, schema);
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

// The names `--only` lists, each one a name.
const names = (only) => {
  const out = only.split(',').map((name) => name.trim());
  if (out.includes('')) throw new UsageError(`--only names an empty schema: ${only}`);
  return out;
};

// The schemas a module exports: itself when it is one, the entities of a
// Model it is, its schemas by name otherwise (an ES module's default export
// when it has nothing else).
const schemasOf = (loaded, only) => {
  const single = schemaOf(loaded);
  if (single !== null) return single;
  const all = isForeign(loaded, 'Model') ? { ...Schema.fromModel(loaded) } : exported(loaded);
  const keys = Object.keys(all);
  if (keys.length === 1 && keys[0] === 'default') return all.default;
  const chosen = only === undefined ? keys : names(only);
  const out = {};
  for (const name of chosen) {
    if (!Object.hasOwn(all, name)) throw new Refusal(`The module exports no schema "${name}"`);
    put(out, name, all[name]);
  }
  if (Object.keys(out).length === 0) throw new Refusal('The module exports no schema');
  return out;
};

// The schemas by name, a lone one as `default`.
const record = (schemas) => (isSchema(schemas) ? { default: schemas } : schemas);

// What a command writes: to stdout, or to the file `--out` names, which is
// never the module it reads.
const write = (args, text) => {
  if (args.out === undefined) {
    process.stdout.write(text);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, text);
};

const compile = async (args) => {
  const schemas = schemasOf(await load(args.file), args.only);
  write(
    args,
    toSource(schemas, { runtime: args.runtime, format: args.format, binary: args.binary }),
  );
};

const snapshot = async (args) => {
  const schemas = record(schemasOf(await load(args.file), args.only));
  write(args, `${JSON.stringify(baseline(schemas), null, 2)}\n`);
};

// The baseline file as JSON; what is wrong with it is told without a stack.
const readBaseline = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Refusal(`Cannot read the baseline ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Refusal(`The baseline ${file} is not JSON: ${error.message}`);
  }
};

const SEVERITIES = ['error', 'warning', 'info'];

// The ids of the two versions compared, where a schema has problems; one
// line per problem; then a summary that counts what was compared, what the
// module no longer exports and what the baseline does not have.
const formatted = (result) => {
  const lines = [];
  const counts = { error: 0, warning: 0, info: 0 };
  let compared = 0;
  let missing = 0;
  let added = 0;
  for (const name of Object.keys(result.schemas)) {
    const entry = result.schemas[name];
    const both = entry.previous !== undefined && entry.next !== undefined;
    if (both) compared += 1;
    else if (entry.next === undefined) missing += 1;
    else added += 1;
    if (both && entry.problems.length > 0) {
      lines.push(`${name}: ${entry.previous.id} → ${entry.next.id}`);
    }
    for (const problem of entry.problems) {
      counts[problem.severity] += 1;
      const where = join(step(name), problem.path);
      lines.push(`${problem.severity.padEnd(7)}  ${where}: ${problem.message} (${problem.rule})`);
    }
  }
  const found = SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => {
    const count = counts[severity];
    return `${count} ${severity}${count !== 1 && severity !== 'info' ? 's' : ''}`;
  });
  const parts = [`${compared} schema${compared === 1 ? '' : 's'} compared`];
  if (missing > 0) parts.push(`${missing} missing from the module`);
  if (added > 0) parts.push(`${added} new`);
  const problems = found.length === 0 ? 'no problems' : found.join(', ');
  lines.push(`${parts.join(', ')}: ${problems}; ${result.ok ? 'compatible' : 'incompatible'}`);
  if (compared === 0) {
    lines.push('Nothing was compared: no schema is in both the module and the baseline');
  }
  return `${lines.join('\n')}\n`;
};

// The schemas of the module against the ones of the baseline, paired by
// export name: one the module no longer exports is a warning (`missing`), a
// new one is noted (`new`). `--only` names the pairs to check, on either side.
const check = async (args, usage) => {
  if (args.against === undefined) {
    throw new UsageError(`check needs --against <baseline.json>\n${usage}`);
  }
  const strict = args.strict === true;
  const current = record(schemasOf(await load(args.file)));
  const previous = restore(readBaseline(args.against));
  const all = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const only = args.only === undefined ? [...all] : names(args.only);
  const result = { ok: true, schemas: {} };
  for (const name of only) {
    if (!all.has(name)) {
      throw new Refusal(`Neither the module nor the baseline has a schema "${name}"`);
    }
    const was = Object.hasOwn(previous, name) ? previous[name] : undefined;
    const now = Object.hasOwn(current, name) ? current[name] : undefined;
    let entry;
    if (now === undefined) {
      const message = `The module no longer exports "${name}"`;
      const problem = { path: '', rule: 'missing', severity: 'warning', message };
      entry = { ok: !strict, problems: [problem], previous: { id: was.id } };
    } else if (was === undefined) {
      const message = `"${name}" is not in the baseline: nothing to compare`;
      const problem = { path: '', rule: 'new', severity: 'info', message };
      entry = { ok: true, problems: [problem], next: { id: now.id } };
    } else {
      entry = {
        ...compatible(was, now, { strict }),
        previous: { id: was.id },
        next: { id: now.id },
      };
    }
    put(result.schemas, name, entry);
    if (!entry.ok) result.ok = false;
  }
  process.stdout.write(args.json === true ? `${JSON.stringify(result)}\n` : formatted(result));
  if (!result.ok) process.exitCode = 1;
};

// The commands: their usage, the options that take a value, the flags, and
// what they do.
const COMMANDS = {
  compile: {
    usage:
      'protoarray compile <module> [--out <file>] [--format cjs|esm] ' +
      '[--runtime import|inline] [--only <A,B>] [--binary]',
    valued: ['out', 'format', 'runtime', 'only'],
    flags: ['binary'],
    run: compile,
  },
  snapshot: {
    usage: 'protoarray snapshot <module> [--only <A,B>] [--out <file>]',
    valued: ['only', 'out'],
    flags: [],
    run: snapshot,
  },
  check: {
    usage: 'protoarray check <module> --against <baseline.json> [--only <A,B>] [--strict] [--json]',
    valued: ['against', 'only'],
    flags: ['strict', 'json'],
    run: check,
  },
};

const USAGE = `Usage: ${Object.values(COMMANDS)
  .map((command) => command.usage)
  .join('\n       ')}`;

// `--option value`, `--option=value`, `--flag`; an option's value is never
// another option.
const parseArgs = (argv) => {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [name, ...rest] = argv;
  if (!Object.hasOwn(COMMANDS, name)) throw new UsageError(USAGE);
  const command = COMMANDS[name];
  const usage = `Usage: ${command.usage}`;
  const options = {};
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      files.push(arg);
      continue;
    }
    const at = arg.indexOf('=');
    const option = at === -1 ? arg.slice(2) : arg.slice(2, at);
    if (at === -1 && command.flags.includes(option)) options[option] = true;
    else if (command.valued.includes(option)) {
      if (at !== -1) options[option] = arg.slice(at + 1);
      else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) options[option] = rest[++i];
      else throw new UsageError(`Option ${arg} needs a value\n${usage}`);
    } else throw new UsageError(`Unknown or incomplete option ${arg}\n${usage}`);
  }
  if (files.length !== 1) throw new UsageError(usage);
  return { command, usage, file: files[0], ...options };
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

// The code of a failure: the error's own, or its name (a `TypeError` of the
// module), or what was thrown when it is no error.
const codeOf = (error) =>
  error instanceof Error
    ? typeof error.code === 'string'
      ? error.code
      : error.name
    : String(error);

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (args.out !== undefined && fileOf(args.out) === fileOf(args.file)) {
    throw new UsageError(`--out names the module it reads: ${args.out}`);
  }
  try {
    await args.command.run(args, args.usage);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    // The module, its schemas or the baseline could not be used: told apart
    // from an incompatible module by the exit code, and as JSON where the
    // result would have been JSON.
    if (args.json === true) {
      const failure = { ok: false, error: { code: codeOf(error), message: report(error) } };
      process.stdout.write(`${JSON.stringify(failure)}\n`);
    } else process.stderr.write(`${report(error)}\n`);
    process.exitCode = 3;
  }
};

// What reaches here is the command line (`parseArgs`, the guard of `--out`,
// a command's own usage): everything a command runs into is reported above.
main().catch((error) => {
  process.stderr.write(`${report(error)}\n`);
  process.exitCode = 2;
});
